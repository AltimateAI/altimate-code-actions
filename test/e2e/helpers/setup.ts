import { resolve } from "node:path";

const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures");

/** Original env snapshot so we can restore after tests. */
let envSnapshot: Record<string, string | undefined> = {};

export interface MockPRPayloadOptions {
  owner?: string;
  repo?: string;
  prNumber?: number;
  action?: string;
  baseBranch?: string;
  headBranch?: string;
  title?: string;
  body?: string;
  changedFiles?: Array<{
    filename: string;
    status: "added" | "modified" | "removed" | "renamed";
    additions?: number;
    deletions?: number;
  }>;
}

export interface MockCommentPayloadOptions {
  owner?: string;
  repo?: string;
  issueNumber?: number;
  commentBody?: string;
  commentUser?: string;
  action?: string;
}

/**
 * Set up environment variables for testing. Captures the current env state
 * so `cleanupTestEnv()` can restore it later.
 */
export function setupTestEnv(overrides: Record<string, string> = {}): void {
  const defaults: Record<string, string> = {
    GITHUB_TOKEN: "ghp_test_token_0000000000000000000000000000000000",
    GITHUB_REPOSITORY: "test-owner/test-repo",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_REF: "refs/pull/42/merge",
    GITHUB_SHA: "abc123def456789",
    GITHUB_WORKSPACE: FIXTURES_DIR,
    GITHUB_ACTION: "altimate-code-review",
    RUNNER_TEMP: "/tmp/altimate-test",
    INPUT_MODEL: "claude-sonnet-4-20250514",
    INPUT_SQL_REVIEW: "true",
    INPUT_IMPACT_ANALYSIS: "false",
    INPUT_COST_ESTIMATION: "false",
    INPUT_PII_CHECK: "false",
    INPUT_MODE: "static",
    INPUT_SEVERITY_THRESHOLD: "warning",
    INPUT_FAIL_ON: "none",
    INPUT_COMMENT_MODE: "single",
    INPUT_MAX_FILES: "50",
  };

  const env = { ...defaults, ...overrides };

  // Snapshot current values so we can restore them
  envSnapshot = {};
  for (const key of Object.keys(env)) {
    envSnapshot[key] = process.env[key];
  }

  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
}

/**
 * Create a realistic pull_request webhook payload.
 */
export function createMockPRPayload(opts: MockPRPayloadOptions = {}): object {
  const {
    owner = "test-owner",
    repo = "test-repo",
    prNumber = 42,
    action = "opened",
    baseBranch = "main",
    headBranch = "feature/sql-improvements",
    title = "Improve SQL queries",
    body = "This PR improves SQL queries in the staging layer.",
    changedFiles = [
      {
        filename: "models/staging/stg_orders.sql",
        status: "modified" as const,
        additions: 5,
        deletions: 2,
      },
    ],
  } = opts;

  return {
    action,
    number: prNumber,
    pull_request: {
      number: prNumber,
      title,
      body,
      state: "open",
      head: {
        ref: headBranch,
        sha: "abc123def456789",
        repo: { full_name: `${owner}/${repo}` },
      },
      base: {
        ref: baseBranch,
        sha: "000111222333444",
        repo: { full_name: `${owner}/${repo}` },
      },
      changed_files: changedFiles.length,
      additions: changedFiles.reduce((s, f) => s + (f.additions ?? 0), 0),
      deletions: changedFiles.reduce((s, f) => s + (f.deletions ?? 0), 0),
      user: { login: "test-user" },
      html_url: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
    },
    repository: {
      full_name: `${owner}/${repo}`,
      owner: { login: owner },
      name: repo,
    },
  };
}

/**
 * Create a realistic issue_comment webhook payload.
 */
export function createMockCommentPayload(opts: MockCommentPayloadOptions = {}): object {
  const {
    owner = "test-owner",
    repo = "test-repo",
    issueNumber = 42,
    commentBody = "/altimate review",
    commentUser = "test-user",
    action = "created",
  } = opts;

  return {
    action,
    issue: {
      number: issueNumber,
      pull_request: {
        url: `https://api.github.com/repos/${owner}/${repo}/pulls/${issueNumber}`,
      },
    },
    comment: {
      id: 12345,
      body: commentBody,
      user: { login: commentUser },
      created_at: new Date().toISOString(),
    },
    repository: {
      full_name: `${owner}/${repo}`,
      owner: { login: owner },
      name: repo,
    },
  };
}

/**
 * Restore all environment variables to their pre-test values.
 */
export function cleanupTestEnv(): void {
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  envSnapshot = {};
}

/** Absolute path to the fixtures directory. */
export const FIXTURES = FIXTURES_DIR;

/** Resolve a path relative to the fixtures directory. */
export function fixture(...segments: string[]): string {
  return resolve(FIXTURES_DIR, ...segments);
}
