import { expect } from "bun:test";

/** Known section headings in generated PR comments. */
const KNOWN_SECTIONS = [
  "SQL Quality",
  "Impact Analysis",
  "Cost Estimation",
  "PII Detection",
  "Summary",
] as const;

type KnownSection = (typeof KNOWN_SECTIONS)[number];

/**
 * Assert that a PR comment body contains a specific markdown section header.
 * Sections are expected as `## Section Name` or `### Section Name`.
 */
export function assertCommentHasSection(
  comment: string,
  section: KnownSection | string,
): void {
  const pattern = new RegExp(`^#{2,3}\\s+${escapeRegex(section)}`, "m");
  expect(comment).toMatch(pattern);
}

/**
 * Assert that a PR comment mentions a specific SQL issue by keyword or rule ID.
 */
export function assertCommentHasIssue(
  comment: string,
  issue: string,
): void {
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
    info: ["info", "informational", "note"],
    warning: ["warning", "warn", "caution"],
    error: ["error", "err"],
    critical: ["critical", "fatal", "blocker"],
  };

  const lower = comment.toLowerCase();
  const found = markers[severity].some((m) => lower.includes(m));
  expect(found).toBe(true);
}

/**
 * Validate the overall markdown structure of a generated PR comment.
 * Checks for:
 * - Non-empty content
 * - At least one section heading
 * - Reasonable length (within GitHub's 65536 char limit)
 * - UTF-8 clean (no broken characters)
 */
export function assertCommentFormat(comment: string): void {
  // Non-empty
  expect(comment.trim().length).toBeGreaterThan(0);

  // Contains at least one markdown heading
  expect(comment).toMatch(/^#{1,6}\s+.+/m);

  // Within GitHub comment limit
  expect(comment.length).toBeLessThanOrEqual(65536);

  // No null bytes or broken encoding
  expect(comment).not.toContain("\0");

  // Should not contain raw HTML error dumps
  expect(comment).not.toMatch(/<pre>Error:/i);
}

/**
 * Assert that a comment does NOT contain a section.
 */
export function assertCommentMissingSection(
  comment: string,
  section: KnownSection | string,
): void {
  const pattern = new RegExp(`^#{2,3}\\s+${escapeRegex(section)}`, "m");
  expect(comment).not.toMatch(pattern);
}

/**
 * Count the number of issues reported in a comment by counting severity markers.
 */
export function countIssuesInComment(comment: string): number {
  // Count lines that start with severity markers (typical format: - **Warning**: ...)
  const issueLines = comment.match(
    /^[\s-]*\*?\*?(info|warning|error|critical)\*?\*?\s*[:\-]/gim,
  );
  return issueLines?.length ?? 0;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
