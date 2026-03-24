import * as core from "@actions/core";
import * as github from "@actions/github";
import type { ChangedFile } from "../analysis/types.js";

const COMMENT_MARKER = "<!-- altimate-code-review -->";

type Octokit = ReturnType<typeof github.getOctokit>;

let _octokit: Octokit | null = null;

/** Get an authenticated Octokit instance. Uses GITHUB_TOKEN from environment. */
export function getOctokit(): Octokit {
  if (_octokit) return _octokit;

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. Provide it via the action's env or use_github_token input.",
    );
  }
  _octokit = github.getOctokit(token);
  return _octokit;
}

/** Get the owner and repo from the current GitHub context. */
export function getRepo(): { owner: string; repo: string } {
  return github.context.repo;
}

/** Get the PR number from the GitHub event context. Returns undefined if not a PR event. */
export function getPRNumber(): number | undefined {
  return github.context.payload.pull_request?.number;
}

/**
 * Fetch the list of changed files in a pull request.
 * Paginates automatically to handle PRs with many files.
 */
export async function getChangedFiles(prNumber: number): Promise<ChangedFile[]> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  const files: ChangedFile[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: perPage,
      page,
    });

    for (const file of response.data) {
      files.push({
        filename: file.filename,
        status: file.status as ChangedFile["status"],
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
      });
    }

    if (response.data.length < perPage) break;
    page++;
  }

  return files;
}

/**
 * Fetch the full content of a file at a specific git ref.
 */
export async function getFileContent(
  filePath: string,
  ref: string,
): Promise<string> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  const response = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: filePath,
    ref,
  });

  const data = response.data;
  if ("content" in data && data.encoding === "base64") {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }

  throw new Error(`Could not read file content for ${filePath} at ref ${ref}`);
}

/**
 * Post or update a sticky PR comment. If an existing comment with our marker
 * is found, it is updated in place. Otherwise a new comment is created.
 *
 * Returns the URL of the comment.
 */
export async function postComment(
  prNumber: number,
  body: string,
): Promise<string> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();
  const markedBody = `${COMMENT_MARKER}\n${body}`;

  const existingId = await findExistingCommentId(prNumber);

  if (existingId) {
    core.debug(`Updating existing comment ${existingId}`);
    const response = await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingId,
      body: markedBody,
    });
    return response.data.html_url;
  }

  core.debug("Creating new PR comment");
  const response = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: markedBody,
  });
  return response.data.html_url;
}

/**
 * Post an inline review comment on a specific file and line.
 */
export async function postInlineComment(
  prNumber: number,
  file: string,
  line: number,
  body: string,
  commitSha: string,
): Promise<void> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  await octokit.rest.pulls.createReviewComment({
    owner,
    repo,
    pull_number: prNumber,
    body,
    commit_id: commitSha,
    path: file,
    line,
    side: "RIGHT",
  });
}

/**
 * Find the ID of an existing bot comment with our marker.
 */
async function findExistingCommentId(
  prNumber: number,
): Promise<number | undefined> {
  const octokit = getOctokit();
  const { owner, repo } = getRepo();

  // Paginate through comments to find our marker
  let page = 1;
  const perPage = 50;

  while (true) {
    const response = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: prNumber,
      per_page: perPage,
      page,
    });

    for (const comment of response.data) {
      if (comment.body?.startsWith(COMMENT_MARKER)) {
        return comment.id;
      }
    }

    if (response.data.length < perPage) break;
    page++;
  }

  return undefined;
}

/** Get the head SHA of the PR. */
export function getHeadSHA(): string {
  return (
    github.context.payload.pull_request?.head?.sha ??
    github.context.sha
  );
}

/** Get the base ref (branch) of the PR. */
export function getBaseRef(): string {
  return (
    github.context.payload.pull_request?.base?.ref ?? "main"
  );
}
