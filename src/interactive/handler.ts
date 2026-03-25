import * as core from "@actions/core";
import * as github from "@actions/github";

import type { ParsedCommand } from "./commands.js";
import type { ActionConfig } from "../analysis/types.js";
import { getPRContext, getChangedSQLFiles, getChangedDBTModels } from "../context/pr.js";
import { analyzeSQLFiles } from "../analysis/sql-review.js";
import { analyzeImpact } from "../analysis/impact.js";
import { detectDBTProject, getManifest } from "../context/dbt.js";
import { estimateCost, getTotalCostDelta } from "../analysis/cost.js";
import { getOctokit, getRepo } from "../util/octokit.js";

const HELP_MESSAGE = `### Altimate Code Commands

| Command | Description |
|:--------|:------------|
| \`/altimate review\` | Run full SQL/dbt review on this PR |
| \`/altimate review <file>\` | Review a specific file |
| \`/altimate impact\` | Show dbt DAG impact analysis |
| \`/altimate cost\` | Show query cost estimation |
| \`/altimate help\` | Show this help message |

[Documentation](https://github.com/AltimateAI/altimate-code-actions/blob/main/docs/configuration.md)`;

/**
 * Handle a parsed interactive command by running the appropriate analysis
 * and posting results as a new PR comment.
 */
export async function handleCommand(
  command: ParsedCommand,
  prNumber: number,
  config: ActionConfig,
): Promise<void> {
  // Acknowledge the command with an "eyes" reaction
  await addReaction(prNumber, "eyes");

  switch (command.command) {
    case "review":
      await handleReview(command, prNumber, config);
      break;
    case "impact":
      await handleImpact(prNumber, config);
      break;
    case "cost":
      await handleCost(prNumber, config);
      break;
    case "help":
      await postNewComment(prNumber, HELP_MESSAGE);
      break;
    case "unknown":
      await postNewComment(
        prNumber,
        `Unknown command: \`${command.args[0] ?? ""}\`. Try \`/altimate help\` for available commands.`,
      );
      break;
  }
}

async function handleReview(
  command: ParsedCommand,
  prNumber: number,
  config: ActionConfig,
): Promise<void> {
  const prContext = await getPRContext();
  let sqlFiles = getChangedSQLFiles(prContext, config.maxFiles);

  // Filter to specific file if requested
  if (command.file) {
    sqlFiles = sqlFiles.filter((f) => f.filename === command.file);
    if (sqlFiles.length === 0) {
      await postNewComment(
        prNumber,
        `No matching SQL file found for \`${command.file}\`. Check the file path and ensure it was changed in this PR.`,
      );
      return;
    }
  }

  if (sqlFiles.length === 0) {
    await postNewComment(prNumber, "No SQL files changed in this PR.");
    return;
  }

  core.info(`Interactive review: analyzing ${sqlFiles.length} file(s)`);
  const issues = await analyzeSQLFiles(sqlFiles, config);

  if (issues.length === 0) {
    await postNewComment(prNumber, `No issues found across ${sqlFiles.length} SQL file(s).`);
    return;
  }

  const { buildComment } = await import("../reporting/comment.js");
  const report = {
    issues,
    filesAnalyzed: sqlFiles.length,
    issuesFound: issues.length,
    shouldFail: false,
    mode: config.mode,
    timestamp: new Date().toISOString(),
  };
  const body = buildComment(report);
  if (body) {
    await postNewComment(prNumber, body);
  }
}

async function handleImpact(prNumber: number, config: ActionConfig): Promise<void> {
  const dbtProjectDir = detectDBTProject(config.dbtProjectDir);
  if (!dbtProjectDir) {
    await postNewComment(
      prNumber,
      "No dbt project detected. Ensure a `dbt_project.yml` exists in the repository or set `dbt_project_dir`.",
    );
    return;
  }

  const prContext = await getPRContext();
  const dbtFiles = getChangedDBTModels(prContext, dbtProjectDir);
  if (dbtFiles.length === 0) {
    await postNewComment(prNumber, "No dbt model files changed in this PR.");
    return;
  }

  const manifest = await getManifest(dbtProjectDir, config.manifestPath);
  if (!manifest) {
    await postNewComment(
      prNumber,
      "Could not load dbt manifest. Run `dbt compile` or provide `manifest_path`.",
    );
    return;
  }

  const impact = await analyzeImpact(dbtFiles, manifest, dbtProjectDir);
  const lines = [
    "### DAG Impact Analysis",
    "",
    `**Impact score:** ${impact.impactScore}/100`,
    "",
    `**Modified models:** ${impact.modifiedModels.join(", ") || "none"}`,
    `**Downstream models:** ${impact.downstreamModels.join(", ") || "none"}`,
    `**Affected exposures:** ${impact.affectedExposures.join(", ") || "none"}`,
    `**Affected tests:** ${impact.affectedTests.join(", ") || "none"}`,
  ];
  await postNewComment(prNumber, lines.join("\n"));
}

async function handleCost(prNumber: number, config: ActionConfig): Promise<void> {
  const prContext = await getPRContext();
  const sqlFiles = getChangedSQLFiles(prContext, config.maxFiles);

  if (sqlFiles.length === 0) {
    await postNewComment(prNumber, "No SQL files changed in this PR.");
    return;
  }

  const estimates = await estimateCost(sqlFiles, config);
  if (estimates.length === 0) {
    await postNewComment(prNumber, "No cost estimates available.");
    return;
  }

  const totalDelta = getTotalCostDelta(estimates);
  const sign = totalDelta >= 0 ? "+" : "";
  const lines = [
    "### Cost Estimation",
    "",
    `**Total monthly delta:** ${sign}$${totalDelta.toFixed(2)} USD`,
    "",
    "| File | Delta |",
    "|:-----|------:|",
    ...estimates.map(
      (e) => `| \`${e.file}\` | ${e.costDelta >= 0 ? "+" : ""}$${e.costDelta.toFixed(2)} |`,
    ),
  ];
  await postNewComment(prNumber, lines.join("\n"));
}

/**
 * Add a reaction to the triggering comment.
 */
async function addReaction(
  _prNumber: number,
  reaction: "+1" | "-1" | "laugh" | "confused" | "heart" | "hooray" | "rocket" | "eyes",
): Promise<void> {
  try {
    const commentId = github.context.payload.comment?.id;
    if (!commentId) return;

    const octokit = getOctokit();
    const { owner, repo } = getRepo();

    await octokit.rest.reactions.createForIssueComment({
      owner,
      repo,
      comment_id: commentId,
      content: reaction,
    });
  } catch (err) {
    // Non-critical — log and continue
    core.debug(`Failed to add reaction: ${err}`);
  }
}

/**
 * Post a new comment on the PR (not updating the sticky summary comment).
 */
async function postNewComment(prNumber: number, body: string): Promise<string> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  const response = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
  return response.data.html_url;
}
