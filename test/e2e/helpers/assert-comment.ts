import { expect } from "bun:test";

/**
 * Assert that a PR comment body contains a specific section.
 * Matches `<summary>` tags, `##`/`###` headings, and `**Bold**` labels.
 */
export function assertCommentHasSection(comment: string, section: string): void {
  const escaped = escapeRegex(section);
  // Match in headings, summary tags, or bold labels
  const pattern = new RegExp(
    `(#{2,3}\\s+.*${escaped}|<summary>.*${escaped}|\\*\\*${escaped}\\*\\*)`,
    "mi",
  );
  expect(comment).toMatch(pattern);
}

/**
 * Assert that a PR comment mentions a specific SQL issue by keyword or rule ID.
 */
export function assertCommentHasIssue(comment: string, issue: string): void {
  const lower = comment.toLowerCase();
  const issueLower = issue.toLowerCase();
  expect(lower).toContain(issueLower);
}

/**
 * Assert that a PR comment contains a severity marker (emoji or label).
 */
export function assertCommentHasSeverity(
  comment: string,
  severity: "info" | "warning" | "error" | "critical",
): void {
  const markers: Record<string, string[]> = {
    info: ["info", "\u2139\uFE0F"],
    warning: ["warning", "\u26A0\uFE0F"],
    error: ["error", "\u274C"],
    critical: ["critical", "\u274C"],
  };

  const lower = comment.toLowerCase();
  const found = markers[severity].some((m) => lower.includes(m.toLowerCase()));
  expect(found).toBe(true);
}

/**
 * Validate the overall markdown structure of a generated PR comment.
 */
export function assertCommentFormat(comment: string): void {
  expect(comment.trim().length).toBeGreaterThan(0);
  expect(comment).toMatch(/^#{1,6}\s+.+/m);
  expect(comment.length).toBeLessThanOrEqual(65536);
  expect(comment).not.toContain("\0");
  expect(comment).not.toMatch(/<pre>Error:/i);
}

/**
 * Assert that a comment does NOT contain a section.
 */
export function assertCommentMissingSection(comment: string, section: string): void {
  const escaped = escapeRegex(section);
  const pattern = new RegExp(`(#{2,3}\\s+.*${escaped}|<summary>.*${escaped})`, "mi");
  expect(comment).not.toMatch(pattern);
}

/**
 * Count the number of issue rows in the comment (table rows with file references).
 */
export function countIssuesInComment(comment: string): number {
  const issueRows = comment.match(/^\|\s*`[^`]+`\s*\|/gm);
  return issueRows?.length ?? 0;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
