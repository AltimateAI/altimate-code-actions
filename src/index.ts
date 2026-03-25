import * as core from "@actions/core";
import * as github from "@actions/github";

import { loadConfig as loadFileConfig, mergeWithInputs } from "./config/loader.js";
import {
  buildCheckOptionsFromV2,
  type AltimateConfig,
  type AltimateConfigV2,
} from "./config/schema.js";
import { isCheckCommandAvailable, runCheckCommand } from "./analysis/cli-check.js";
import { extractQueryProfile } from "./analysis/query-profile.js";
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
import {
  Severity,
  SEVERITY_WEIGHT,
  type ActionConfig,
  type ReviewReport,
  type ReviewMode,
  type CommentMode,
  type FailOn,
  type SQLIssue,
  type ImpactResult,
  type CostEstimate,
  type ValidationSummary,
  type QueryProfile,
} from "./analysis/types.js";

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
    core.info(
      `Altimate Code Review — mode: ${config.mode}, model: ${config.model || "(none, static mode)"}`,
    );

    // Check for interactive mention events first
    if (config.interactive && isInteractiveMention(config.mentions)) {
      await handleInteractiveMention(config);
      return;
    }

    // FIX 7: Detect fork PRs
    const isForkPR = github.context.payload.pull_request?.head?.repo?.fork === true;
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
    const [analysisResult, impact, costEstimates] = await runAnalyses(sqlFiles, prContext, config);

    const { issues, validationSummary } = analysisResult;
    const totalCostDelta = costEstimates.length > 0 ? getTotalCostDelta(costEstimates) : undefined;

    // Extract query profiles from SQL file content
    const queryProfiles = await extractQueryProfiles(sqlFiles);

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
      validationSummary,
      queryProfiles: queryProfiles.length > 0 ? queryProfiles : undefined,
    };

    // Always post comment when files were analyzed (shows validation value
    // even on clean PRs). Skip only when literally nothing was analyzed.
    let commentUrl: string | undefined;
    if (report.filesAnalyzed > 0) {
      if (isForkPR) {
        const { buildComment } = await import("./reporting/comment.js");
        const body = buildComment(report);
        if (body) {
          core.summary.addRaw(body);
          await core.summary.write();
          core.info("Fork PR — results written to job summary");
        }
      } else {
        commentUrl = await postReviewComment(prContext.prNumber, report, config.commentMode);
      }
    } else {
      core.info("No SQL files analyzed — skipping PR comment");
    }

    // Set outputs
    setOutputs({
      issues_found: String(report.issuesFound),
      impact_score: report.impactScore !== undefined ? String(report.impactScore) : "",
      estimated_cost_delta:
        report.estimatedCostDelta !== undefined ? report.estimatedCostDelta.toFixed(2) : "",
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

/** Analysis result combining issues with validation metadata. */
interface AnalysisResult {
  issues: SQLIssue[];
  validationSummary?: ValidationSummary;
}

/**
 * Run all enabled analyses. Returns [analysisResult, impact, costEstimates].
 * Analyses that are disabled return empty arrays / null.
 *
 * When a v2 config is detected and the `altimate-code` CLI supports the
 * `check` subcommand, all enabled checks are delegated to a single CLI
 * invocation instead of the per-file regex engine.
 */
async function runAnalyses(
  sqlFiles: ReturnType<typeof getChangedSQLFiles>,
  prContext: Awaited<ReturnType<typeof getPRContext>>,
  config: ActionConfig,
): Promise<[AnalysisResult, ImpactResult | null, CostEstimate[]]> {
  // Always try `altimate-code check` first (deterministic, no LLM).
  // Falls back to regex rules if CLI unavailable.
  const fileConfig = (config as ActionConfig & { fileConfig?: AltimateConfig }).fileConfig;
  const v2Config =
    fileConfig && (fileConfig as unknown as { version: number }).version === 2
      ? (fileConfig as unknown as AltimateConfigV2)
      : null;

  const promises: [Promise<AnalysisResult>, Promise<ImpactResult | null>, Promise<CostEstimate[]>] =
    [
      // SQL review — try CLI check first, fall back to regex
      config.sqlReview &&
      (config.mode === "full" || config.mode === "static" || config.mode === "ai")
        ? runAnalysisWithCLIFallback(sqlFiles, config, v2Config)
        : Promise.resolve({ issues: [] }),

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
        if (manifest) {
          return analyzeImpact(dbtFiles, manifest, dbtProjectDir);
        }

        // Fallback: use altimate-code CLI for impact analysis (deterministic, no LLM needed)
        core.info("No manifest — attempting impact analysis via altimate-code CLI");
        try {
          const modelNames = dbtFiles.map(
            (f) =>
              f.filename
                .replace(/\.sql$/, "")
                .split("/")
                .pop()!,
          );
          const prompt = `Run impact_analysis for the following dbt models: ${modelNames.join(", ")}. Return a JSON object with: modifiedModels (string[]), downstreamModels (string[]), affectedExposures (string[]), affectedTests (string[]), impactScore (number 0-100).`;
          const result = await runCLI(["run", "--format", "json", "--prompt", prompt], {
            cwd: dbtProjectDir,
            timeout: 120_000,
            env: {},
          });
          if (result.json && typeof result.json === "object") {
            const data = result.json as Record<string, unknown>;
            return {
              modifiedModels: (data.modifiedModels as string[]) ?? modelNames,
              downstreamModels: (data.downstreamModels as string[]) ?? [],
              affectedExposures: (data.affectedExposures as string[]) ?? [],
              affectedTests: (data.affectedTests as string[]) ?? [],
              impactScore: typeof data.impactScore === "number" ? data.impactScore : 0,
            };
          }
        } catch (err) {
          core.warning(
            `CLI impact analysis failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        core.info("Impact analysis unavailable — no manifest and CLI fallback failed");
        return null;
      })(),

      // Cost estimation
      config.costEstimation ? estimateCost(sqlFiles, config) : Promise.resolve([]),
    ];

  return Promise.all(promises);
}

/**
 * Run analysis via `altimate-code check` using a v2 config. All enabled
 * checks are collected and sent as a single CLI invocation. Falls back to
 * the standard `analyzeSQLFiles` path if the CLI is not available.
 */
/**
 * Try `altimate-code check` first (real AST-based analysis), fall back to
 * regex rules if the CLI is unavailable.
 */
async function runAnalysisWithCLIFallback(
  sqlFiles: ReturnType<typeof getChangedSQLFiles>,
  config: ActionConfig,
  v2Config: AltimateConfigV2 | null,
): Promise<AnalysisResult> {
  // Try CLI check
  const cliReady = await isCheckCommandAvailable();
  if (cliReady) {
    core.info("altimate-code check command available — using AST-based analysis");
    if (v2Config) {
      return runV2CheckAnalysis(sqlFiles, v2Config);
    }
    // No v2 config — use default checks (lint + safety)
    const result = await runCheckCommand(sqlFiles, { checks: ["lint", "safety"] });
    return { issues: result.issues, validationSummary: result.validationSummary };
  }

  // CLI not available — fall back to regex
  core.info("altimate-code check not available — using regex rule engine");
  const issues = await analyzeSQLFiles(sqlFiles, config);
  return { issues };
}

async function runV2CheckAnalysis(
  sqlFiles: ReturnType<typeof getChangedSQLFiles>,
  v2Config: AltimateConfigV2,
): Promise<AnalysisResult> {
  const cliReady = await isCheckCommandAvailable();
  if (!cliReady) {
    core.warning(
      "v2 config detected but altimate-code CLI unavailable — falling back to built-in rules",
    );
    const issues = await analyzeSQLFiles(sqlFiles, { mode: "static" } as ActionConfig);
    return { issues };
  }

  const options = buildCheckOptionsFromV2(v2Config);
  if (options.checks.length === 0) {
    core.info("All checks disabled in v2 config — skipping");
    return { issues: [] };
  }

  core.info(`Running altimate-code check with: ${options.checks.join(", ")}`);
  const result = await runCheckCommand(sqlFiles, options);
  return { issues: result.issues, validationSummary: result.validationSummary };
}

/**
 * Extract query profiles from SQL file content. Reads file content from
 * the working directory and extracts structural metadata.
 */
async function extractQueryProfiles(
  sqlFiles: ReturnType<typeof getChangedSQLFiles>,
): Promise<QueryProfile[]> {
  const profiles: QueryProfile[] = [];
  const fs = await import("fs/promises");

  for (const file of sqlFiles) {
    try {
      const content = await fs.readFile(file.filename, "utf-8");
      profiles.push(extractQueryProfile(file.filename, content));
    } catch {
      // File might not exist locally (e.g. deleted file) — skip
    }
  }

  return profiles;
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
      github.context.payload.pull_request?.number ?? github.context.payload.issue?.number;

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
    core.warning(`Interactive mention handler exited with code ${result.exitCode}`);
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

  return issues.some((issue) => SEVERITY_WEIGHT[issue.severity] >= thresholdWeight);
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
    commentMode: envEnum("COMMENT_MODE", ["single", "inline", "both"], "single") as CommentMode,
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

function envEnum(name: string, allowed: string[], defaultValue: string): string {
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
