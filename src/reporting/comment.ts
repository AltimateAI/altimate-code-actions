import * as core from "@actions/core";
import type {
  ReviewReport,
  SQLIssue,
  CostEstimate,
  Severity,
  CommentMode,
} from "../analysis/types.js";
import { SEVERITY_WEIGHT } from "../analysis/types.js";
import {
  postComment,
  postInlineComment,
  getHeadSHA,
} from "../util/octokit.js";

const SEVERITY_ICONS: Record<string, string> = {
  info: ":information_source:",
  warning: ":warning:",
  error: ":x:",
  critical: ":rotating_light:",
};

const STATUS_ICONS = {
  pass: ":white_check_mark:",
  warn: ":warning:",
  fail: ":x:",
};

/**
 * Build the PR comment markdown from a ReviewReport.
 * This is a template-free approach using string building for reliability.
 */
export function buildComment(report: ReviewReport): string {
  const sections: string[] = [];

  // Header
  const icon = report.shouldFail
    ? STATUS_ICONS.fail
    : report.issuesFound > 0
      ? STATUS_ICONS.warn
      : STATUS_ICONS.pass;

  sections.push(`## ${icon} Altimate Code Review`);
  sections.push("");
  sections.push(buildSummaryLine(report));
  sections.push("");

  // SQL Issues section
  if (report.issues.length > 0) {
    sections.push(buildIssuesSection(report.issues));
    sections.push("");
  }

  // Impact analysis section
  if (report.impact && report.impact.modifiedModels.length > 0) {
    sections.push(buildImpactSection(report));
    sections.push("");
  }

  // Cost estimation section
  if (report.costEstimates && report.costEstimates.length > 0) {
    sections.push(buildCostSection(report.costEstimates, report.estimatedCostDelta));
    sections.push("");
  }

  // No findings message
  if (
    report.issues.length === 0 &&
    !report.impact?.modifiedModels.length &&
    !report.costEstimates?.length
  ) {
    sections.push(
      "> No SQL issues, impact concerns, or cost changes detected. :thumbsup:",
    );
    sections.push("");
  }

  // Footer
  sections.push("---");
  sections.push(
    `<sub>Analyzed ${report.filesAnalyzed} file(s) in <b>${report.mode}</b> mode` +
      ` | ${report.timestamp}</sub>`,
  );

  return sections.join("\n");
}

function buildSummaryLine(report: ReviewReport): string {
  const parts: string[] = [];

  const critCount = report.issues.filter((i) => i.severity === "critical").length;
  const errCount = report.issues.filter((i) => i.severity === "error").length;
  const warnCount = report.issues.filter((i) => i.severity === "warning").length;
  const infoCount = report.issues.filter((i) => i.severity === "info").length;

  if (report.issuesFound === 0) {
    parts.push("No SQL issues found");
  } else {
    const segments: string[] = [];
    if (critCount > 0) segments.push(`${critCount} critical`);
    if (errCount > 0) segments.push(`${errCount} error`);
    if (warnCount > 0) segments.push(`${warnCount} warning`);
    if (infoCount > 0) segments.push(`${infoCount} info`);
    parts.push(`**${report.issuesFound} issue(s):** ${segments.join(", ")}`);
  }

  if (report.impactScore !== undefined) {
    parts.push(`Impact score: **${report.impactScore}/100**`);
  }

  if (report.estimatedCostDelta !== undefined) {
    const sign = report.estimatedCostDelta >= 0 ? "+" : "";
    parts.push(
      `Cost delta: **${sign}$${report.estimatedCostDelta.toFixed(2)}/mo**`,
    );
  }

  return parts.join(" | ");
}

function buildIssuesSection(issues: SQLIssue[]): string {
  const lines: string[] = [];

  // Sort by severity descending, then by file
  const sorted = [...issues].sort((a, b) => {
    const sevDiff =
      SEVERITY_WEIGHT[b.severity as Severity] -
      SEVERITY_WEIGHT[a.severity as Severity];
    if (sevDiff !== 0) return sevDiff;
    return a.file.localeCompare(b.file);
  });

  lines.push(`### SQL Issues (${issues.length})`);
  lines.push("");
  lines.push("| Severity | File | Line | Rule | Message |");
  lines.push("|----------|------|------|------|---------|");

  for (const issue of sorted) {
    const icon = SEVERITY_ICONS[issue.severity] ?? ":grey_question:";
    const line = issue.line ? `L${issue.line}` : "-";
    const rule = issue.rule ? `\`${issue.rule}\`` : "-";
    // Escape pipe characters in message to avoid breaking the table
    const message = issue.message.replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(`| ${icon} ${issue.severity} | \`${issue.file}\` | ${line} | ${rule} | ${message} |`);
  }

  // Suggestions as a collapsible section
  const withSuggestions = sorted.filter((i) => i.suggestion);
  if (withSuggestions.length > 0) {
    lines.push("");
    lines.push("<details>");
    lines.push("<summary>Suggestions</summary>");
    lines.push("");
    for (const issue of withSuggestions) {
      lines.push(
        `- **\`${issue.file}\`${issue.line ? ` L${issue.line}` : ""}** (\`${issue.rule ?? "general"}\`): ${issue.suggestion}`,
      );
    }
    lines.push("");
    lines.push("</details>");
  }

  return lines.join("\n");
}

function buildImpactSection(report: ReviewReport): string {
  const impact = report.impact!;
  const lines: string[] = [];

  lines.push("### Impact Analysis");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(
    `| Modified Models | ${impact.modifiedModels.join(", ") || "None"} |`,
  );
  lines.push(`| Downstream Models | ${impact.downstreamModels.length} |`);
  lines.push(`| Affected Exposures | ${impact.affectedExposures.length} |`);
  lines.push(`| Affected Tests | ${impact.affectedTests.length} |`);
  lines.push(`| **Impact Score** | **${impact.impactScore}/100** |`);

  // Downstream details
  if (impact.downstreamModels.length > 0) {
    lines.push("");
    lines.push("<details>");
    lines.push(
      `<summary>Downstream models (${impact.downstreamModels.length})</summary>`,
    );
    lines.push("");
    for (const model of impact.downstreamModels) {
      lines.push(`- \`${model}\``);
    }
    lines.push("");
    lines.push("</details>");
  }

  // Exposure warning
  if (impact.affectedExposures.length > 0) {
    lines.push("");
    const exposureList = impact.affectedExposures
      .map((e) => `\`${e}\``)
      .join(", ");
    lines.push(
      `> :warning: **Warning:** This change affects ${impact.affectedExposures.length} exposure(s): ${exposureList}`,
    );
  }

  return lines.join("\n");
}

function buildCostSection(
  estimates: CostEstimate[],
  totalDelta?: number,
): string {
  const lines: string[] = [];

  lines.push("### Cost Estimation");
  lines.push("");
  lines.push("| File | Delta (USD/month) | Explanation |");
  lines.push("|------|--------------------|-------------|");

  for (const est of estimates) {
    const sign = est.costDelta >= 0 ? "+" : "";
    const explanation = est.explanation?.replace(/\|/g, "\\|").replace(/\n/g, " ") ?? "-";
    lines.push(
      `| \`${est.file}\` | ${sign}$${est.costDelta.toFixed(2)} | ${explanation} |`,
    );
  }

  if (totalDelta !== undefined) {
    const sign = totalDelta >= 0 ? "+" : "";
    lines.push("");
    lines.push(`**Total monthly delta:** ${sign}$${totalDelta.toFixed(2)}`);
  }

  return lines.join("\n");
}

/**
 * Post the review report as a PR comment. Handles both single-comment
 * and inline-comment modes.
 */
export async function postReviewComment(
  prNumber: number,
  report: ReviewReport,
  commentMode: CommentMode,
): Promise<string | undefined> {
  let commentUrl: string | undefined;

  // Post summary comment (single or both modes)
  if (commentMode === "single" || commentMode === "both") {
    const body = buildComment(report);
    commentUrl = await postComment(prNumber, body);
    core.info(`Posted summary comment: ${commentUrl}`);
  }

  // Post inline comments (inline or both modes)
  if (commentMode === "inline" || commentMode === "both") {
    const headSHA = getHeadSHA();
    let inlineCount = 0;

    for (const issue of report.issues) {
      if (!issue.line) continue;

      try {
        const icon = SEVERITY_ICONS[issue.severity] ?? "";
        const body =
          `${icon} **${issue.severity}**${issue.rule ? ` (\`${issue.rule}\`)` : ""}: ${issue.message}` +
          (issue.suggestion ? `\n\n**Suggestion:** ${issue.suggestion}` : "");

        await postInlineComment(
          prNumber,
          issue.file,
          issue.line,
          body,
          headSHA,
        );
        inlineCount++;
      } catch (err) {
        // Inline comments can fail if the line isn't in the diff range
        core.debug(
          `Could not post inline comment on ${issue.file}:${issue.line}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    core.info(`Posted ${inlineCount} inline comment(s)`);
  }

  return commentUrl;
}
