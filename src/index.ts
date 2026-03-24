import * as core from "@actions/core";
import * as github from "@actions/github";

import {
  loadConfig as loadFileConfig,
  mergeWithInputs,
} from "./config/loader.js";
import type { AltimateConfig } from "./config/schema.js";
import {
  getPRContext,
  getChangedSQLFiles,
  getChangedDBTModels,
  isInteractiveMention,
  getMentionComment,
} from "./context/pr.js";
import { parseCommand } from "./interactive/commands.js";
import { handleCommand } from "./interactive/handler.js";
import { detectDBTProject, getManifest } from "./context/dbt.js";
import { analyzeSQLFiles } from "./analysis/sql-review.js";
import { analyzeImpact } from "./analysis/impact.js";
import { estimateCost, getTotalCostDelta } from "./analysis/cost.js";
import { postReviewComment } from "./reporting/comment.js";
import { runCLI } from "./util/cli.js";
import type {
  ActionConfig,
  ReviewReport,
  ReviewMode,
  CommentMode,
  FailOn,
  SQLIssue,
  ImpactResult,
  CostEstimate,
} from "./analysis/types.js";
import { Severity, SEVERITY_WEIGHT } from "./analysis/types.js";

async function main(): Promise<void> {
  try {
    // FIX 8: Skip closed PR events
    const eventAction = github.context.payload.action;
    if (eventAction === "closed") {
      core.info("PR is closed — skipping analysis");
      return;
    }

    // FIX 13: Mask warehouse credentials from logs
    if (process.env.WAREHOUSE_CONNECTION) {
      core.setSecret(process.env.WAREHOUSE_CONNECTION);
    }

    // FIX 5: Load .altimate.yml and merge with action inputs
    const fileConfig = loadFileConfig(".altimate.yml");
    const mergedFileConfig = mergeWithInputs(fileConfig, {
      severity_threshold: process.env.SEVERITY_THRESHOLD,
      dialect: process.env.WAREHOUSE_TYPE,
      comment_mode: process.env.COMMENT_MODE,
      max_files: process.env.MAX_FILES ? parseInt(process.env.MAX_FILES, 10) : undefined,
    });

    const config = parseConfig();
    // Attach file config for downstream consumers
    (config as ActionConfig & { fileConfig?: AltimateConfig }).fileConfig = mergedFileConfig;
    core.info(`Altimate Code Review — mode: ${config.mode}, model: ${config.model || "(none, static mode)"}`);

    // Check for interactive mention events first
    if (config.interactive && isInteractiveMention(config.mentions)) {
      await handleInteractiveMention(config);
      return;
    }

    // FIX 7: Detect fork PRs
    const isForkPR =
      github.context.payload.pull_request?.head?.repo?.fork === true;
    if (isForkPR) {
      core.warning(
        "Fork PR detected — posting comments requires write permissions. Results written to job summary only.",
      );
    }

    // Main PR review flow
    const prContext = await getPRContext();
    const sqlFiles = getChangedSQLFiles(prContext, config.maxFiles);

    if (sqlFiles.length === 0 && !config.impactAnalysis) {
      core.info("No SQL files changed and impact analysis is disabled — nothing to do");
      setOutputs({
        issues_found: "0",
        impact_score: "",
        estimated_cost_delta: "",
        comment_url: "",
        report_json: "{}",
      });
      return;
    }

    // Run analyses in parallel where possible
    const [issues, impact, costEstimates] = await runAnalyses(
      sqlFiles,
      prContext,
      config,
    );

    const totalCostDelta =
      costEstimates.length > 0 ? getTotalCostDelta(costEstimates) : undefined;

    const report: ReviewReport = {
      issues,
      impact: impact ?? undefined,
      costEstimates: costEstimates.length > 0 ? costEstimates : undefined,
      filesAnalyzed: sqlFiles.length,
      issuesFound: issues.length,
      impactScore: impact?.impactScore,
      estimatedCostDelta: totalCostDelta,
      shouldFail: shouldFail(issues, config.failOn),
      mode: config.mode,
      timestamp: new Date().toISOString(),
    };

    // Post comment (skip for fork PRs — write to job summary instead)
    let commentUrl: string | undefined;
    if (report.issuesFound > 0 || report.impact || report.costEstimates) {
      if (isForkPR) {
        const { buildComment } = await import("./reporting/comment.js");
        const body = buildComment(report);
        if (body) {
          core.summary.addRaw(body);
          await core.summary.write();
          core.info("Fork PR — results written to job summary");
        }
      } else {
        commentUrl = await postReviewComment(
          prContext.prNumber,
          report,
          config.commentMode,
        );
      }
    } else {
      core.info("No findings — skipping PR comment");
    }

    // Set outputs
    setOutputs({
      issues_found: String(report.issuesFound),
      impact_score: report.impactScore !== undefined ? String(report.impactScore) : "",
      estimated_cost_delta:
        report.estimatedCostDelta !== undefined
          ? report.estimatedCostDelta.toFixed(2)
          : "",
      comment_url: commentUrl ?? "",
      report_json: JSON.stringify(report),
    });

    // Fail the action if configured
    if (report.shouldFail) {
      core.setFailed(
        `Altimate Code Review: found issues meeting the fail_on=${config.failOn} threshold`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.setFailed(`Altimate Code Review failed: ${message}`);
  }
}

/**
 * Run all enabled analyses. Returns [issues, impact, costEstimates].
 * Analyses that are disabled return empty arrays / null.
 */
async function runAnalyses(
  sqlFiles: ReturnType<typeof getChangedSQLFiles>,
  prContext: Awaited<ReturnType<typeof getPRContext>>,
  config: ActionConfig,
): Promise<[SQLIssue[], ImpactResult | null, CostEstimate[]]> {
  const promises: [
    Promise<SQLIssue[]>,
    Promise<ImpactResult | null>,
    Promise<CostEstimate[]>,
  ] = [
    // SQL review
    config.sqlReview && (config.mode === "full" || config.mode === "static" || config.mode === "ai")
      ? analyzeSQLFiles(sqlFiles, config)
      : Promise.resolve([]),

    // Impact analysis
    (async (): Promise<ImpactResult | null> => {
      if (!config.impactAnalysis) return null;

      const dbtProjectDir = detectDBTProject(config.dbtProjectDir);
      if (!dbtProjectDir) return null;

      const dbtFiles = getChangedDBTModels(prContext, dbtProjectDir);
      if (dbtFiles.length === 0) {
        core.info("No dbt model files changed — skipping impact analysis");
        return null;
      }

      const manifest = await getManifest(dbtProjectDir, config.manifestPath);
      if (!manifest) return null;

      return analyzeImpact(dbtFiles, manifest, dbtProjectDir);
    })(),

    // Cost estimation
    config.costEstimation
      ? estimateCost(sqlFiles, config)
      : Promise.resolve([]),
  ];

  return Promise.all(promises);
}

/**
 * Handle an interactive mention by parsing the command and routing to the
 * appropriate handler. Falls back to the CLI for unstructured mentions.
 */
async function handleInteractiveMention(config: ActionConfig): Promise<void> {
  const comment = getMentionComment();
  core.info(`Interactive mention detected: "${comment.slice(0, 80)}..."`);

  const parsed = parseCommand(comment, config.mentions);

  if (parsed) {
    core.info(`Parsed command: ${parsed.command} (args: ${parsed.args.join(", ")})`);
    const prNumber =
      github.context.payload.pull_request?.number ??
      github.context.payload.issue?.number;

    if (!prNumber) {
      core.warning("Could not determine PR number from event payload");
      return;
    }

    await handleCommand(parsed, prNumber, config);
    return;
  }

  // Fallback: delegate to CLI for unstructured mentions
  const env: Record<string, string> = {
    MODEL: config.model,
  };

  if (config.useGithubToken) {
    env.USE_GITHUB_TOKEN = "true";
  }

  const result = await runCLI(["github", "run"], { env, timeout: 300_000 });

  if (result.exitCode !== 0) {
    core.warning(
      `Interactive mention handler exited with code ${result.exitCode}`,
    );
  }
}

/**
 * Determine whether the action should fail based on the fail_on setting
 * and the issues found.
 */
function shouldFail(issues: SQLIssue[], failOn: FailOn): boolean {
  if (failOn === "none") return false;

  const threshold = failOn === "error" ? Severity.Error : Severity.Critical;
  const thresholdWeight = SEVERITY_WEIGHT[threshold];

  return issues.some(
    (issue) => SEVERITY_WEIGHT[issue.severity] >= thresholdWeight,
  );
}

/**
 * Parse action configuration from environment variables.
 * Environment variables are set by the composite action's env block.
 */
function parseConfig(): ActionConfig {
  const mode = envEnum("MODE", ["full", "static", "ai"], "full") as ReviewMode;
  const model = process.env.MODEL ?? "";

  // Model is required for AI-powered modes
  if (mode !== "static" && !model) {
    throw new Error(
      `The 'model' input is required when mode is '${mode}'. Set model (e.g., anthropic/claude-sonnet-4-20250514) or use mode: static.`,
    );
  }

  let warehouseConnection: Record<string, unknown> | undefined;
  const rawConnection = process.env.WAREHOUSE_CONNECTION;
  if (rawConnection) {
    try {
      warehouseConnection = JSON.parse(rawConnection);
    } catch {
      core.warning("WAREHOUSE_CONNECTION is not valid JSON — ignoring");
    }
  }

  return {
    model,
    sqlReview: envBool("SQL_REVIEW", true),
    impactAnalysis: envBool("IMPACT_ANALYSIS", true),
    costEstimation: envBool("COST_ESTIMATION", false),
    piiCheck: envBool("PII_CHECK", true),
    mode,
    interactive: envBool("INTERACTIVE", true),
    mentions: (process.env.MENTIONS ?? "/altimate,/oc")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    dbtProjectDir: process.env.DBT_PROJECT_DIR || undefined,
    dbtVersion: process.env.DBT_VERSION || undefined,
    manifestPath: process.env.MANIFEST_PATH || undefined,
    warehouseType: process.env.WAREHOUSE_TYPE || undefined,
    warehouseConnection,
    useGithubToken: envBool("USE_GITHUB_TOKEN", false),
    maxFiles: envInt("MAX_FILES", 50),
    severityThreshold: envEnum(
      "SEVERITY_THRESHOLD",
      ["info", "warning", "error", "critical"],
      "warning",
    ) as Severity,
    commentMode: envEnum(
      "COMMENT_MODE",
      ["single", "inline", "both"],
      "single",
    ) as CommentMode,
    failOn: envEnum("FAIL_ON", ["none", "error", "critical"], "none") as FailOn,
  };
}


function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  return raw.toLowerCase() === "true" || raw === "1";
}

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function envEnum(
  name: string,
  allowed: string[],
  defaultValue: string,
): string {
  const raw = process.env[name]?.toLowerCase();
  if (!raw || !allowed.includes(raw)) return defaultValue;
  return raw;
}

function setOutputs(outputs: Record<string, string>): void {
  for (const [key, value] of Object.entries(outputs)) {
    core.setOutput(key, value);
  }
}

// Run
main();
