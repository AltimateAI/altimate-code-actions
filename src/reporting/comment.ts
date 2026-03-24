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
const VERSION = "0.3.0";

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

  // Line 1: Executive one-line summary (always visible)
  sections.push(buildExecutiveLine(report));
  sections.push("");

  // Section 2: Summary table (always visible)
  sections.push(buildSummaryTable(report));
  sections.push("");

  // Section 3: Mermaid DAG blast radius (collapsible)
  if (report.impact && report.impact.modifiedModels.length > 0) {
    const totalDownstream =
      report.impact.downstreamModels.length +
      report.impact.affectedExposures.length;
    if (totalDownstream > 0) {
      sections.push(buildMermaidDAG(report.impact));
      sections.push("");
    }
  }

  // Section 4: SQL issues (critical auto-expanded, rest collapsible)
  if (report.issues.length > 0) {
    sections.push(buildIssuesSection(report.issues));
    sections.push("");
  }

  // Section 5: Cost before/after (collapsible)
  if (report.costEstimates && report.costEstimates.length > 0) {
    sections.push(
      buildCostSection(report.costEstimates, report.estimatedCostDelta),
    );
    sections.push("");
  }

  // Section 6: Footer
  sections.push(buildFooter());

  let result = sections.join("\n");

  if (result.length > MAX_COMMENT_LENGTH) {
    result = truncateComment(result);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/**
 * Build the executive one-line summary.
 * Format: ## {emoji} Altimate Code — `N models` modified · `M downstream` · status
 */
export function buildExecutiveLine(report: ReviewReport): string {
  const parts: string[] = [];

  // Model counts
  const modifiedCount = report.impact?.modifiedModels.length ?? 0;
  const downstreamCount = report.impact?.downstreamModels.length ?? 0;
  const exposureCount = report.impact?.affectedExposures.length ?? 0;

  if (modifiedCount > 0) {
    parts.push(
      `\`${modifiedCount} ${modifiedCount === 1 ? "model" : "models"}\` modified`,
    );
  }

  if (downstreamCount > 0) {
    parts.push(`\`${downstreamCount} downstream\``);
  }

  if (exposureCount > 0) {
    parts.push(
      `\`${exposureCount} ${exposureCount === 1 ? "exposure" : "exposures"}\` at risk`,
    );
  }

  // Issue counts
  const critCount = report.issues.filter(
    (i) => i.severity === "critical" || i.severity === "error",
  ).length;
  const warnCount = report.issues.filter(
    (i) => i.severity === "warning",
  ).length;

  if (critCount > 0) {
    parts.push(`\`${critCount} critical\``);
  }
  if (warnCount > 0) {
    parts.push(
      `\`${warnCount} ${warnCount === 1 ? "warning" : "warnings"}\``,
    );
  }

  // Cost delta
  if (
    report.estimatedCostDelta !== undefined &&
    report.estimatedCostDelta !== 0
  ) {
    const sign = report.estimatedCostDelta >= 0 ? "+" : "";
    parts.push(`\`${sign}$${report.estimatedCostDelta.toFixed(2)}/mo\``);
  }

  // Rules summary
  const rulesCount = report.filesAnalyzed;
  if (critCount === 0 && warnCount === 0 && rulesCount > 0) {
    parts.push("all checks passed");
  }

  // Pick emoji based on severity
  let emoji: string;
  if (critCount > 0) {
    emoji = "\u274C"; // ❌
  } else if (warnCount > 0) {
    emoji = "\u26A0\uFE0F"; // ⚠️
  } else {
    emoji = "\u2705"; // ✅
  }

  const summary = parts.length > 0 ? parts.join(" \u00B7 ") : "all checks passed";
  return `## ${emoji} Altimate Code \u2014 ${summary}`;
}

/**
 * Build the compact summary check table (always visible).
 */
export function buildSummaryTable(report: ReviewReport): string {
  const rows: string[] = [];
  rows.push("| Check | Result | Details |");
  rows.push("|:------|:------:|:--------|");

  // SQL Quality row
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
        `| SQL Quality | \u274C ${parts.join(", ")} | ${report.issuesFound} issues in ${report.filesAnalyzed} files |`,
      );
    } else if (warnCount > 0) {
      rows.push(
        `| SQL Quality | \u26A0\uFE0F ${warnCount} ${warnCount === 1 ? "warning" : "warnings"} | ${report.issuesFound} issues in ${report.filesAnalyzed} files |`,
      );
    } else {
      rows.push(
        `| SQL Quality | \u2705 0 issues | ${report.filesAnalyzed} files analyzed |`,
      );
    }
  }

  // dbt Impact row
  if (report.impact) {
    const directCount = report.impact.modifiedModels.length;
    const downstreamCount = report.impact.downstreamModels.length;
    const exposureCount = report.impact.affectedExposures.length;
    const total = directCount + downstreamCount;

    let details = `${directCount} modified`;
    if (downstreamCount > 0) {
      details += ` \u2192 ${downstreamCount} downstream`;
    }
    if (exposureCount > 0) {
      details += `, ${exposureCount} ${exposureCount === 1 ? "exposure" : "exposures"}`;
    }

    rows.push(
      `| dbt Impact | \uD83D\uDCCA ${total} models | ${details} |`,
    );
  }

  // Cost row
  if (
    report.estimatedCostDelta !== undefined &&
    report.estimatedCostDelta !== 0
  ) {
    const sign = report.estimatedCostDelta >= 0 ? "+" : "";
    const explanation =
      report.costEstimates?.[0]?.explanation ?? "cost changed";
    rows.push(
      `| Cost | \uD83D\uDD3A ${sign}$${report.estimatedCostDelta.toFixed(2)}/mo | ${explanation} |`,
    );
  } else if (report.costEstimates && report.costEstimates.length > 0) {
    rows.push("| Cost | \u2705 No change | $0.00 delta |");
  }

  return rows.join("\n");
}

/**
 * Build a Mermaid DAG blast radius diagram.
 * Modified models get red, downstream get yellow, exposures get purple.
 */
export function buildMermaidDAG(impact: ImpactResult): string {
  const totalDownstream =
    impact.downstreamModels.length + impact.affectedExposures.length;
  const lines: string[] = [];

  lines.push("<details>");
  lines.push(
    `<summary>\uD83D\uDCCA Blast Radius \u2014 ${totalDownstream} downstream ${totalDownstream === 1 ? "model" : "models"}</summary>`,
  );
  lines.push("");
  lines.push("```mermaid");
  lines.push("graph LR");
  lines.push(
    "    classDef modified fill:#ff6b6b,stroke:#333,color:#fff",
  );
  lines.push("    classDef downstream fill:#ffd93d,stroke:#333");
  lines.push(
    "    classDef exposure fill:#845ef7,stroke:#333,color:#fff",
  );
  lines.push("");

  // Sanitize node IDs for mermaid (replace non-alphanum with _)
  const sanitize = (name: string): string =>
    name.replace(/[^a-zA-Z0-9_]/g, "_");

  const modifiedSet = new Set(impact.modifiedModels);
  const downstreamSet = new Set(impact.downstreamModels);
  const exposureSet = new Set(impact.affectedExposures);

  // Use explicit edges if available (from lightweight DAG), otherwise
  // fall back to the cartesian product approach (modified → downstream).
  if (impact.edges && impact.edges.length > 0) {
    for (const edge of impact.edges) {
      const fromId = sanitize(edge.from);
      const toId = sanitize(edge.to);
      const fromClass = modifiedSet.has(edge.from) ? "modified" : "downstream";
      const toClass = exposureSet.has(edge.to)
        ? "exposure"
        : downstreamSet.has(edge.to)
          ? "downstream"
          : modifiedSet.has(edge.to)
            ? "modified"
            : "downstream";
      lines.push(`    ${fromId}:::${fromClass} --> ${toId}:::${toClass}`);
    }
  } else {
    // Legacy: cartesian product of modified → downstream
    for (const mod of impact.modifiedModels) {
      const modId = sanitize(mod);
      for (const ds of impact.downstreamModels) {
        const dsId = sanitize(ds);
        lines.push(`    ${modId}:::modified --> ${dsId}:::downstream`);
      }
      for (const exp of impact.affectedExposures) {
        const expId = sanitize(exp);
        lines.push(`    ${modId}:::modified --> ${expId}:::exposure`);
      }
    }

    if (
      impact.downstreamModels.length > 0 &&
      impact.affectedExposures.length > 0
    ) {
      for (const ds of impact.downstreamModels) {
        const dsId = sanitize(ds);
        for (const exp of impact.affectedExposures) {
          const expId = sanitize(exp);
          lines.push(`    ${dsId}:::downstream --> ${expId}:::exposure`);
        }
      }
    }
  }

  lines.push("```");
  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
}

/**
 * Build the SQL issues section, grouped by severity.
 * Critical/error issues are NOT collapsible (auto-expanded).
 * Warning/info issues are collapsible.
 */
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

    const isCritical = severity === "critical" || severity === "error";

    if (isCritical) {
      // Critical/error: NOT collapsible, auto-expanded
      lines.push(`### ${emoji} ${count} ${noun}`);
      lines.push("");
    } else {
      // Warning/info: collapsible
      lines.push("<details>");
      lines.push(`<summary>${emoji} ${count} ${noun}</summary>`);
      lines.push("");
    }

    lines.push("| # | File | Line | Issue | Fix |");
    lines.push("|:-:|:-----|:----:|:------|:----|");

    const sorted = [...sevIssues].sort((a, b) => {
      const fileCmp = a.file.localeCompare(b.file);
      if (fileCmp !== 0) return fileCmp;
      return (a.line ?? 0) - (b.line ?? 0);
    });

    for (let i = 0; i < sorted.length; i++) {
      const issue = sorted[i];
      const line = issue.line ? String(issue.line) : "-";
      const message = issue.message
        .replace(/\|/g, "\\|")
        .replace(/\n/g, " ");
      const fix = issue.suggestion
        ? issue.suggestion.replace(/\|/g, "\\|").replace(/\n/g, " ")
        : "-";
      lines.push(
        `| ${i + 1} | \`${issue.file}\` | ${line} | ${message} | ${fix} |`,
      );
    }

    lines.push("");

    if (!isCritical) {
      lines.push("</details>");
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}

/**
 * Build the cost before/after/delta table (collapsible).
 */
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
    `<summary>\uD83D\uDCB0 Cost Impact \u2014 ${sign}$${delta.toFixed(2)}/mo</summary>`,
  );
  lines.push("");
  lines.push("| Model | Before | After | Delta | Cause |");
  lines.push("|:------|-------:|------:|------:|:------|");

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
    const cause = est.explanation
      ? est.explanation.replace(/\|/g, "\\|").replace(/\n/g, " ")
      : "-";
    lines.push(
      `| \`${model}\` | ${before} | ${after} | ${estSign}$${est.costDelta.toFixed(2)} | ${cause} |`,
    );
  }

  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
}

/**
 * Build the minimal HTML footer with version, rule count, and links.
 */
export function buildFooter(): string {
  return [
    "---",
    `<sub>\uD83D\uDD0D <a href="https://github.com/AltimateAI/altimate-code-actions">Altimate Code</a> v${VERSION} \u00B7 <a href="https://github.com/AltimateAI/altimate-code-actions/blob/main/docs/configuration.md">Configure</a> \u00B7 <a href="https://github.com/AltimateAI/altimate-code-actions/issues">Feedback</a></sub>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Legacy — kept for backward compatibility
// ---------------------------------------------------------------------------

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
