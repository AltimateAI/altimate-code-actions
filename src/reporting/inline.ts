import type { SQLIssue, InlineComment } from "../analysis/types.js";

/**
 * Format a single issue as an inline review comment body.
 */
export function formatInlineComment(issue: SQLIssue): string {
  const severityIcon =
    issue.severity === "critical"
      ? ":rotating_light:"
      : issue.severity === "error"
        ? ":x:"
        : ":warning:";

  let body = `${severityIcon} **[${issue.rule ?? "issue"}] ${issue.message}**`;

  if (issue.suggestion) {
    body += `\n\n:bulb: **Suggestion:** ${issue.suggestion}`;
  }

  return body;
}

/**
 * Select issues eligible for inline commenting.
 *
 * Rules:
 * - Critical and error issues: always included
 * - Warnings: included only if there are 5 or fewer total warnings
 * - Info/style: never included
 * - Issues without a line number are excluded
 * - Capped at 10 comments total
 */
export function selectInlineIssues(issues: SQLIssue[]): SQLIssue[] {
  const critical = issues.filter((i) => i.severity === "critical" || i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  let selected = [...critical];
  if (warnings.length <= 5) {
    selected.push(...warnings);
  }

  // Only include issues with a defined line number
  selected = selected.filter((i) => i.line !== undefined);

  // Cap at 10
  return selected.slice(0, 10);
}

/**
 * Build InlineComment objects from selected issues.
 */
export function buildInlineComments(issues: SQLIssue[]): InlineComment[] {
  const selected = selectInlineIssues(issues);
  return selected.map((issue) => ({
    path: issue.file,
    line: issue.line!,
    body: formatInlineComment(issue),
  }));
}
