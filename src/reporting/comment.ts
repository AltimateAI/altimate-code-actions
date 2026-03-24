import * as core from "@actions/core";
import type {
  ReviewReport,
  SQLIssue,
  CostEstimate,
  ImpactResult,
  Severity,
  CommentMode,
} from "../analysis/types.js";
import {
  postComment,
  postReviewComments,
} from "../util/octokit.js";
import { buildInlineComments } from "./inline.js";

const MAX_COMMENT_LENGTH = 60000;
const VERSION = "0.2.0";

const SEVERITY_ORDER: Severity[] = [
  "critical",
  "error",
  "warning",
  "info",
] as Severity[];

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "\u274C", // ❌
  error: "\u274C", // ❌
  warning: "\u26A0\uFE0F", // ⚠️
  info: "\u2139\uFE0F", // ℹ️
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the PR comment markdown from a ReviewReport.
 * Returns null if no SQL files were analyzed (no SQL files changed in PR).
 */
export function buildComment(report: ReviewReport): string | null {
  if (report.filesAnalyzed === 0) {
    return null;
  }

  const sections: string[] = [];

  sections.push(buildHeader(report));
  sections.push("");
  sections.push(buildSummaryTable(report));
  sections.push("");

  if (report.issues.length > 0) {
    sections.push(buildIssuesSection(report.issues));
    sections.push("");
  }

  if (report.impact && report.impact.modifiedModels.length > 0) {
    sections.push(buildDAGSection(report.impact));
    sections.push("");
  }

  if (report.costEstimates && report.costEstimates.length > 0) {
    sections.push(
      buildCostSection(report.costEstimates, report.estimatedCostDelta),
    );
    sections.push("");
  }

  sections.push(buildFooter());

  let result = sections.join("\n");

  if (result.length > MAX_COMMENT_LENGTH) {
    result = truncateComment(result);
  }

  return result;
}

/**
 * Build an ASCII DAG from impact data, tracing paths from modified models
 * to their downstream dependents.
 */
export function buildASCIIDAG(
  modifiedModels: string[],
  downstreamModels: string[],
  _impactResult: ImpactResult,
): string {
  if (modifiedModels.length === 0) return "";

  const lines: string[] = [];

  for (const root of modifiedModels) {
    const children = downstreamModels.filter(
      (d) => !modifiedModels.includes(d),
    );
    if (children.length === 0) {
      lines.push(root);
      continue;
    }

    if (children.length === 1) {
      lines.push(`${root} \u2500\u2500\u2192 ${children[0]}`);
    } else {
      lines.push(
        `${root} \u2500\u2500\u252C\u2500\u2500\u2192 ${children[0]}`,
      );
      for (let i = 1; i < children.length - 1; i++) {
        const pad = " ".repeat(root.length + 1);
        lines.push(
          `${pad}\u251C\u2500\u2500\u2192 ${children[i]}`,
        );
      }
      const pad = " ".repeat(root.length + 1);
      lines.push(
        `${pad}\u2514\u2500\u2500\u2192 ${children[children.length - 1]}`,
      );
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

export function buildHeader(report: ReviewReport): string {
  const critCount = report.issues.filter(
    (i) => i.severity === "critical" || i.severity === "error",
  ).length;
  const warnCount = report.issues.filter(
    (i) => i.severity === "warning",
  ).length;

  if (critCount > 0) {
    const noun = critCount === 1 ? "issue" : "issues";
    return `## \u274C Altimate Code \u2014 ${critCount} critical ${noun} found`;
  }
  if (warnCount > 0) {
    const noun = warnCount === 1 ? "warning" : "warnings";
    return `## \u26A0\uFE0F Altimate Code \u2014 ${warnCount} ${noun} found`;
  }
  return "## \u2705 Altimate Code \u2014 All checks passed";
}

export function buildSummaryTable(report: ReviewReport): string {
  const rows: string[] = [];
  rows.push("| Check | Result | Details |");
  rows.push("|:------|:------:|:--------|");

  // SQL Analysis row
  if (report.filesAnalyzed > 0) {
    const critCount = report.issues.filter(
      (i) => i.severity === "critical" || i.severity === "error",
    ).length;
    const warnCount = report.issues.filter(
      (i) => i.severity === "warning",
    ).length;

    if (critCount > 0) {
      const parts: string[] = [];
      parts.push(`${critCount} critical`);
      if (warnCount > 0) parts.push(`${warnCount} warnings`);
      rows.push(
        `| SQL Analysis | \u274C ${parts.join(", ")} | ${report.issuesFound} issues in ${report.filesAnalyzed} files |`,
      );
    } else if (warnCount > 0) {
      rows.push(
        `| SQL Analysis | \u26A0\uFE0F ${warnCount} warnings | ${report.issuesFound} issues in ${report.filesAnalyzed} files |`,
      );
    } else {
      rows.push(
        `| SQL Analysis | \u2705 Passed | 0 issues in ${report.filesAnalyzed} files |`,
      );
    }
  }

  // dbt Impact row
  if (report.impact) {
    const total =
      report.impact.modifiedModels.length +
      report.impact.downstreamModels.length;
    const directCount = report.impact.modifiedModels.length;
    const downstreamCount = report.impact.downstreamModels.length;
    rows.push(
      `| dbt Impact | \u2139\uFE0F ${total} models | ${directCount} direct, ${downstreamCount} downstream |`,
    );
  }

  // Cost Impact row
  if (
    report.estimatedCostDelta !== undefined &&
    report.estimatedCostDelta !== 0
  ) {
    const sign = report.estimatedCostDelta >= 0 ? "+" : "";
    const explanation =
      report.costEstimates?.[0]?.explanation ?? "cost changed";
    rows.push(
      `| Cost Impact | \uD83D\uDD3A ${sign}$${report.estimatedCostDelta.toFixed(2)}/mo | ${explanation} |`,
    );
  } else if (report.costEstimates && report.costEstimates.length > 0) {
    rows.push("| Cost Impact | \u2705 No change | $0.00 delta |");
  }

  return rows.join("\n");
}

export function buildIssuesSection(issues: SQLIssue[]): string {
  const lines: string[] = [];

  const grouped = new Map<string, SQLIssue[]>();
  for (const sev of SEVERITY_ORDER) {
    const matching = issues.filter((i) => i.severity === sev);
    if (matching.length > 0) {
      grouped.set(sev, matching);
    }
  }

  for (const [severity, sevIssues] of grouped) {
    const emoji = SEVERITY_EMOJI[severity] ?? "";
    const count = sevIssues.length;
    const noun =
      severity === "warning"
        ? count === 1
          ? "warning"
          : "warnings"
        : severity === "info"
          ? count === 1
            ? "info item"
            : "info items"
          : count === 1
            ? `${severity} issue`
            : `${severity} issues`;

    lines.push("<details>");
    lines.push(`<summary>${emoji} ${count} ${noun}</summary>`);
    lines.push("");
    lines.push("| File | Line | Issue | Rule |");
    lines.push("|:-----|:----:|:------|:-----|");

    const sorted = [...sevIssues].sort((a, b) => {
      const fileCmp = a.file.localeCompare(b.file);
      if (fileCmp !== 0) return fileCmp;
      return (a.line ?? 0) - (b.line ?? 0);
    });

    for (const issue of sorted) {
      const line = issue.line ? String(issue.line) : "-";
      const rule = issue.rule ? `\`${issue.rule}\`` : "-";
      const message = issue.message
        .replace(/\|/g, "\\|")
        .replace(/\n/g, " ");
      lines.push(
        `| \`${issue.file}\` | ${line} | ${message} | ${rule} |`,
      );
    }

    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function buildDAGSection(impact: ImpactResult): string {
  const totalAffected =
    impact.modifiedModels.length + impact.downstreamModels.length;
  const lines: string[] = [];

  lines.push("<details>");
  lines.push(
    `<summary>\uD83D\uDCCA DAG Impact \u2014 ${totalAffected} models affected</summary>`,
  );
  lines.push("");

  if (impact.modifiedModels.length > 0) {
    lines.push("**Modified in this PR:**");
    for (const model of impact.modifiedModels) {
      const downstreamCount = impact.downstreamModels.length;
      lines.push(
        `- \`${model}\` \u2014 ${downstreamCount} downstream dependents`,
      );
    }
    lines.push("");
  }

  if (impact.downstreamModels.length > 0) {
    lines.push("**Downstream impact:**");
    for (const model of impact.downstreamModels) {
      const dependsOn = impact.modifiedModels.join("`, `");
      lines.push(
        `- \`${model}\` \u2190 depends on \`${dependsOn}\``,
      );
    }
    lines.push("");
  }

  if (impact.affectedExposures.length > 0) {
    const exposureList = impact.affectedExposures.join(", ");
    lines.push(`**Affected exposures:** ${exposureList}`);
    lines.push("");
  }

  const asciiDAG = buildASCIIDAG(
    impact.modifiedModels,
    impact.downstreamModels,
    impact,
  );
  if (asciiDAG) {
    lines.push("```");
    lines.push(asciiDAG);
    lines.push("```");
    lines.push("");
  }

  lines.push("</details>");

  return lines.join("\n");
}

export function buildCostSection(
  estimates: CostEstimate[],
  totalDelta?: number,
): string {
  const lines: string[] = [];

  const delta =
    totalDelta ?? estimates.reduce((sum, e) => sum + e.costDelta, 0);
  const sign = delta >= 0 ? "+" : "";

  lines.push("<details>");
  lines.push(
    `<summary>\uD83D\uDCB0 Cost Impact \u2014 ${sign}$${delta.toFixed(2)}/mo estimated</summary>`,
  );
  lines.push("");
  lines.push("| Model | Before | After | Delta |");
  lines.push("|:------|-------:|------:|------:|");

  for (const est of estimates) {
    const model = est.model ?? est.file;
    const before =
      est.costBefore !== undefined
        ? `$${est.costBefore.toFixed(2)}/mo`
        : "-";
    const after =
      est.costAfter !== undefined
        ? `$${est.costAfter.toFixed(2)}/mo`
        : "-";
    const estSign = est.costDelta >= 0 ? "+" : "";
    lines.push(
      `| \`${model}\` | ${before} | ${after} | ${estSign}$${est.costDelta.toFixed(2)} |`,
    );
  }

  const explanation = estimates.find((e) => e.explanation)?.explanation;
  if (explanation) {
    lines.push("");
    lines.push(`**Cause:** ${explanation}`);
  }

  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
}

export function buildFooter(): string {
  return [
    "---",
    `<sub>\uD83D\uDD0D <a href="https://github.com/AltimateAI/altimate-code-actions">Altimate Code</a> v${VERSION} \u00B7 <a href="https://github.com/AltimateAI/altimate-code-actions/blob/main/docs/configuration.md">Configure</a> \u00B7 <a href="https://github.com/AltimateAI/altimate-code-actions/issues">Feedback</a></sub>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

function truncateComment(result: string): string {
  const footer = buildFooter();
  const truncNotice =
    "\n\n> \u26A0\uFE0F **Report truncated** \u2014 showing partial results. Run locally for the full report.\n\n";

  const available = MAX_COMMENT_LENGTH - footer.length - truncNotice.length;
  return result.slice(0, available) + truncNotice + footer;
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

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

  if (commentMode === "single" || commentMode === "both") {
    const body = buildComment(report);
    if (body === null) {
      core.info("No SQL files analyzed \u2014 skipping PR comment.");
      return undefined;
    }
    commentUrl = await postComment(prNumber, body);
    core.info(`Posted summary comment: ${commentUrl}`);
  }

  if (commentMode === "inline" || commentMode === "both") {
    const inlineComments = buildInlineComments(report.issues);

    if (inlineComments.length > 0) {
      try {
        await postReviewComments(prNumber, inlineComments);
        core.info(
          `Posted ${inlineComments.length} inline comment(s) as a single review`,
        );
      } catch (err) {
        core.warning(
          `Failed to post inline review comments: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      core.info("No issues eligible for inline comments");
    }
  }

  return commentUrl;
}
