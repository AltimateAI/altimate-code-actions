import * as core from "@actions/core";
import * as github from "@actions/github";
import { getChangedFiles, getPRNumber, getHeadSHA, getBaseRef } from "../util/octokit.js";
import { isSQLFile, isDBTFile } from "../util/diff-parser.js";
import type { ChangedFile } from "../analysis/types.js";

export interface PRContext {
  /** PR number. */
  prNumber: number;
  /** Head commit SHA. */
  headSHA: string;
  /** Base branch ref (e.g. "main"). */
  baseRef: string;
  /** Title of the PR. */
  title: string;
  /** Body/description of the PR. */
  body: string;
  /** All changed files in the PR. */
  changedFiles: ChangedFile[];
  /** Only the .sql / .sqlx files that changed. */
  sqlFiles: ChangedFile[];
  /** Files that are dbt-related (.sql, .yml, .yaml, .py in model paths). */
  dbtFiles: ChangedFile[];
  /** The GitHub event name (pull_request, issue_comment, etc.). */
  eventName: string;
}

/**
 * Build the full PR context by reading the GitHub event payload and fetching
 * changed files from the API. Throws if the event is not associated with a PR.
 */
export async function getPRContext(): Promise<PRContext> {
  const prNumber = getPRNumber();
  if (!prNumber) {
    throw new Error(
      `No pull request found in the GitHub event. Event: ${github.context.eventName}`,
    );
  }

  core.info(`Fetching PR #${prNumber} context...`);

  const headSHA = getHeadSHA();
  const baseRef = getBaseRef();
  const payload = github.context.payload.pull_request;
  const title = payload?.title ?? "";
  const body = payload?.body ?? "";

  const changedFiles = await getChangedFiles(prNumber);
  core.info(`PR has ${changedFiles.length} changed file(s)`);

  const sqlFiles = changedFiles.filter((f) => f.status !== "removed" && isSQLFile(f.filename));
  const dbtFiles = changedFiles.filter((f) => f.status !== "removed" && isDBTFile(f.filename));

  core.info(`Found ${sqlFiles.length} SQL file(s) and ${dbtFiles.length} dbt-related file(s)`);

  return {
    prNumber,
    headSHA,
    baseRef,
    title,
    body,
    changedFiles,
    sqlFiles,
    dbtFiles,
    eventName: github.context.eventName,
  };
}

/**
 * Get the SQL files from the PR context, respecting the maxFiles limit.
 * Files are sorted by additions descending so the most-changed files are
 * analyzed first if the limit is hit.
 */
export function getChangedSQLFiles(ctx: PRContext, maxFiles: number): ChangedFile[] {
  const sorted = [...ctx.sqlFiles].sort((a, b) => b.additions - a.additions);
  if (maxFiles > 0 && sorted.length > maxFiles) {
    core.warning(
      `PR has ${sorted.length} SQL files but max_files is ${maxFiles}. ` +
        `Analyzing the ${maxFiles} most-changed files only.`,
    );
    return sorted.slice(0, maxFiles);
  }
  return sorted;
}

/**
 * Get the dbt model files from the PR context. Returns .sql files that live
 * within the dbt project directory (or all .sql files if no project dir is
 * specified).
 */
export function getChangedDBTModels(ctx: PRContext, dbtProjectDir?: string): ChangedFile[] {
  if (!dbtProjectDir) return ctx.dbtFiles;

  // dbtProjectDir is absolute, filenames are relative — convert to relative
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  let relativeDir = dbtProjectDir;
  if (dbtProjectDir.startsWith(workspace)) {
    relativeDir = dbtProjectDir.slice(workspace.length).replace(/^\//, "");
  }

  // If dbt project is at repo root, all dbt files match
  if (!relativeDir || relativeDir === "." || relativeDir === "./") {
    return ctx.dbtFiles;
  }

  const prefix = relativeDir.endsWith("/") ? relativeDir : `${relativeDir}/`;
  return ctx.dbtFiles.filter((f) => f.filename.startsWith(prefix));
}

/**
 * Check if the current event is an interactive mention (issue_comment with a
 * trigger phrase).
 */
export function isInteractiveMention(triggers: string[]): boolean {
  if (github.context.eventName !== "issue_comment") return false;

  const comment = github.context.payload.comment?.body ?? "";
  const lowerComment = comment.toLowerCase().trim();

  return triggers.some((trigger) => lowerComment.startsWith(trigger.toLowerCase().trim()));
}

/**
 * Get the comment body for interactive mention events.
 */
export function getMentionComment(): string {
  return github.context.payload.comment?.body ?? "";
}
