import * as core from "@actions/core";
import type {
  ReviewReport,
  SQLIssue,
  CostEstimate,
  ImpactResult,
  Severity,
  CommentMode,
  ValidationSummary,
  QueryProfile,
} from "../analysis/types.js";
import { postComment, postReviewComments } from "../util/octokit.js";
import { buildInlineComments } from "./inline.js";

const MAX_COMMENT_LENGTH = 60000;
const VERSION = "0.4.0";

const SEVERITY_ORDER: Severity[] = ["critical", "error", "warning", "info"] as Severity[];

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

  // Section 2: Validation table — "What We Checked | How | Result"
  sections.push(buildValidationTable(report));
  sections.push("");

  // Section 3: Query Profile (collapsible)
  if (report.queryProfiles && report.queryProfiles.length > 0) {
    sections.push(buildQueryProfile(report.queryProfiles));
    sections.push("");
  }

  // Section 4: Mermaid DAG blast radius (visible by default)
  if (report.impact && report.impact.modifiedModels.length > 0) {
    const filteredDownstream = report.impact.downstreamModels.filter(
      (d) => !/^(not_null|unique|accepted_values|relationships|dbt_utils|dbt_expectations)_/.test(d),
    );
    const visibleNodes = filteredDownstream.length + report.impact.affectedExposures.length;
    const testCount = report.impact.downstreamModels.length - filteredDownstream.length;

    if (visibleNodes > 0) {
      // Has real downstream models — show Mermaid DAG
      sections.push(buildMermaidDAG(report.impact));
      sections.push("");
    } else if (testCount > 0) {
      // Only test nodes downstream — show text summary instead of empty graph
      sections.push(
        `### \uD83D\uDCCA Impact — ${report.impact.modifiedModels.join(", ")} (\uD83E\uDDEA ${testCount} tests depend on this model)`,
      );
      sections.push("");
    }
  }

  // Section 5: SQL issues (critical auto-expanded, rest collapsible)
  if (report.issues.length > 0) {
    sections.push(buildIssuesSection(report.issues));
    sections.push("");
  }

  // Section 6: Cost before/after (collapsible)
  if (report.costEstimates && report.costEstimates.length > 0) {
    sections.push(buildCostSection(report.costEstimates, report.estimatedCostDelta));
    sections.push("");
  }

  // Section 7: Footer
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
 *
 * Clean PR: ## ✅ Altimate Code — `N models` validated · `M downstream` safe · no issues
 * With issues: ## ⚠️ Altimate Code — `N models` validated · `M downstream` · K findings
 */
export function buildExecutiveLine(report: ReviewReport): string {
  const parts: string[] = [];

  // Model/file counts — use "validated" instead of "modified"
  const modifiedCount = report.impact?.modifiedModels.length ?? 0;
  const downstreamCount = report.impact?.downstreamModels.length ?? 0;
  const exposureCount = report.impact?.affectedExposures.length ?? 0;
  const fileCount = report.filesAnalyzed;

  // Show model count if impact data exists, otherwise show file count
  if (modifiedCount > 0) {
    parts.push(`\`${modifiedCount} ${modifiedCount === 1 ? "model" : "models"}\` validated`);
  } else if (fileCount > 0) {
    parts.push(`\`${fileCount} ${fileCount === 1 ? "file" : "files"}\` validated`);
  }

  // Downstream — "safe" when no issues, plain count when issues exist
  if (downstreamCount > 0) {
    const critCount = report.issues.filter(
      (i) => i.severity === "critical" || i.severity === "error",
    ).length;
    const warnCount = report.issues.filter((i) => i.severity === "warning").length;
    const hasIssues = critCount > 0 || warnCount > 0;
    parts.push(`\`${downstreamCount} downstream\`${hasIssues ? "" : " safe"}`);
  }

  if (exposureCount > 0) {
    parts.push(`\`${exposureCount} ${exposureCount === 1 ? "exposure" : "exposures"}\` at risk`);
  }

  // Issue counts
  const critCount = report.issues.filter(
    (i) => i.severity === "critical" || i.severity === "error",
  ).length;
  const warnCount = report.issues.filter((i) => i.severity === "warning").length;
  const totalFindings = critCount + warnCount;

  if (totalFindings > 0) {
    parts.push(`${totalFindings} ${totalFindings === 1 ? "finding" : "findings"}`);
  }

  // Cost delta
  if (report.estimatedCostDelta !== undefined && report.estimatedCostDelta !== 0) {
    const sign = report.estimatedCostDelta >= 0 ? "+" : "";
    parts.push(`\`${sign}$${report.estimatedCostDelta.toFixed(2)}/mo\``);
  }

  // "no issues" when clean
  if (totalFindings === 0 && fileCount > 0 && downstreamCount === 0) {
    parts.push("no issues");
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

  const summary = parts.length > 0 ? parts.join(" \u00B7 ") : "no issues";
  return `## ${emoji} Altimate Code \u2014 ${summary}`;
}

/**
 * Build the validation table showing What We Checked | How | Result.
 *
 * When a `validationSummary` is present on the report, uses the rich
 * category metadata. Otherwise falls back to the legacy summary table format.
 */
export function buildValidationTable(report: ReviewReport): string {
  if (report.validationSummary) {
    return buildRichValidationTable(report.validationSummary, report);
  }
  return buildLegacySummaryTable(report);
}

/**
 * Build the rich 3-column validation table from ValidationSummary metadata.
 * Columns: What We Checked | How | Result
 */
function buildRichValidationTable(summary: ValidationSummary, report: ReviewReport): string {
  const rows: string[] = [];
  rows.push("| What We Checked | How | Result |");
  rows.push("|:----------------|:----|:------:|");

  // Render categories in a stable order
  const categoryOrder = ["validate", "lint", "safety", "pii", "policy", "semantic", "grade"];
  const renderedCategories = new Set<string>();

  for (const cat of categoryOrder) {
    if (summary.categories[cat]) {
      rows.push(buildValidationRow(cat, summary.categories[cat]));
      renderedCategories.add(cat);
    }
  }
  // Render any remaining categories not in the known order
  for (const [cat, catSummary] of Object.entries(summary.categories)) {
    if (!renderedCategories.has(cat)) {
      rows.push(buildValidationRow(cat, catSummary));
    }
  }

  // Breaking Changes row from impact data
  if (report.impact) {
    const downstreamCount = report.impact.downstreamModels.length;
    const passed =
      report.issues.filter((i) => i.severity === "critical" || i.severity === "error").length === 0;
    const resultEmoji = passed ? "\u2705 Compatible" : "\u274C Breaking";
    rows.push(
      `| Breaking Changes | Schema compatibility against ${downstreamCount} downstream models | ${resultEmoji} |`,
    );
  }

  return rows.join("\n");
}

/** Build a single row of the validation table for a check category. */
function buildValidationRow(
  _category: string,
  catSummary: { label: string; method: string; findingsCount: number; passed: boolean },
): string {
  let resultText: string;
  if (catSummary.passed) {
    // Pick a contextually appropriate label
    if (_category === "validate") resultText = "\u2705 Valid";
    else if (_category === "safety") resultText = "\u2705 Safe";
    else if (_category === "pii") resultText = "\u2705 No exposure";
    else resultText = "\u2705 Clean";
  } else {
    const count = catSummary.findingsCount;
    resultText = `\u26A0\uFE0F ${count} ${count === 1 ? "warning" : "warnings"}`;
  }

  return `| ${catSummary.label} | ${catSummary.method} | ${resultText} |`;
}

/**
 * Build the legacy summary table format (used when no ValidationSummary
 * is available — e.g. when using the regex rule engine fallback).
 *
 * This preserves backward compatibility with the old "Check | Result | Details"
 * format but still shows value by listing what was checked.
 */
export function buildLegacySummaryTable(report: ReviewReport): string {
  const rows: string[] = [];
  rows.push("| What We Checked | How | Result |");
  rows.push("|:----------------|:----|:------:|");

  // SQL Quality row
  if (report.filesAnalyzed > 0) {
    const critCount = report.issues.filter(
      (i) => i.severity === "critical" || i.severity === "error",
    ).length;
    const warnCount = report.issues.filter((i) => i.severity === "warning").length;

    if (critCount > 0) {
      const parts: string[] = [];
      parts.push(`${critCount} critical`);
      if (warnCount > 0) parts.push(`${warnCount} warnings`);
      rows.push(
        `| SQL Quality | Static analysis on ${report.filesAnalyzed} files | \u274C ${parts.join(", ")} |`,
      );
    } else if (warnCount > 0) {
      rows.push(
        `| SQL Quality | Static analysis on ${report.filesAnalyzed} files | \u26A0\uFE0F ${warnCount} ${warnCount === 1 ? "warning" : "warnings"} |`,
      );
    } else {
      rows.push(
        `| SQL Quality | Static analysis on ${report.filesAnalyzed} files | \u2705 Clean |`,
      );
    }
  }

  // dbt Impact row
  if (report.impact) {
    const downstreamCount = report.impact.downstreamModels.length;
    const exposureCount = report.impact.affectedExposures.length;

    let details = `DAG analysis against ${downstreamCount} downstream models`;
    if (exposureCount > 0) {
      details += `, ${exposureCount} ${exposureCount === 1 ? "exposure" : "exposures"}`;
    }
    rows.push(`| Breaking Changes | ${details} | \u2705 Compatible |`);
  }

  // Cost row
  if (report.estimatedCostDelta !== undefined && report.estimatedCostDelta !== 0) {
    const sign = report.estimatedCostDelta >= 0 ? "+" : "";
    rows.push(
      `| Cost | Warehouse cost estimation | \uD83D\uDD3A ${sign}$${report.estimatedCostDelta.toFixed(2)}/mo |`,
    );
  } else if (report.costEstimates && report.costEstimates.length > 0) {
    rows.push("| Cost | Warehouse cost estimation | \u2705 No change |");
  }

  return rows.join("\n");
}

/**
 * Build a collapsible Query Profile section showing SQL structure metadata.
 */
export function buildQueryProfile(profiles: QueryProfile[]): string {
  const lines: string[] = [];

  lines.push("<details>");
  lines.push(`<summary>\uD83D\uDCCB Query Profile</summary>`);
  lines.push("");

  // Build a table with one column per file
  const fileNames = profiles.map((p) => {
    const parts = p.file.split("/");
    return `\`${parts[parts.length - 1]}\``;
  });

  lines.push(`| | ${fileNames.join(" | ")} |`);
  lines.push(`|:--|${fileNames.map(() => ":-:").join("|")}|`);

  // Complexity row
  lines.push(`| Complexity | ${profiles.map((p) => p.complexity).join(" | ")} |`);

  // Tables row
  lines.push(`| Tables | ${profiles.map((p) => String(p.tablesReferenced)).join(" | ")} |`);

  // JOINs row
  lines.push(
    `| JOINs | ${profiles.map((p) => (p.joinCount > 0 ? `${p.joinCount} (${p.joinTypes.join(", ")})` : "0")).join(" | ")} |`,
  );

  // CTEs row
  lines.push(`| CTEs | ${profiles.map((p) => (p.hasCTE ? "Yes" : "No")).join(" | ")} |`);

  // Subqueries row
  lines.push(`| Subqueries | ${profiles.map((p) => (p.hasSubquery ? "Yes" : "No")).join(" | ")} |`);

  // Window Functions row
  lines.push(
    `| Window Functions | ${profiles.map((p) => (p.hasWindowFunction ? "Yes" : "No")).join(" | ")} |`,
  );

  // Aggregation row
  lines.push(
    `| Aggregation | ${profiles.map((p) => (p.hasAggregation ? "Yes" : "No")).join(" | ")} |`,
  );

  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
}

/**
 * Check if a node name looks like a dbt test (not a model/snapshot/exposure).
 * Test nodes follow patterns like: not_null_model_col, unique_model_col,
 * accepted_values_model_col__val1__val2, relationships_model_col__ref_other_
 */
function isTestNode(name: string): boolean {
  // Standard dbt generic tests
  if (/^(not_null|unique|accepted_values|relationships|dbt_utils|dbt_expectations)_/.test(name)) return true;
  // Singular tests (typically start with "assert_" or "test_")
  if (/^(assert|test)_/.test(name)) return true;
  return false;
}

/**
 * Build a Mermaid DAG blast radius diagram.
 * - Modified models: red
 * - Downstream models: yellow
 * - Exposures: purple
 * - Test nodes are FILTERED OUT (too noisy)
 * - DAG is NOT collapsed — it's the visual differentiator
 */
export function buildMermaidDAG(impact: ImpactResult): string {
  // Filter out test nodes from downstream
  const filteredDownstream = impact.downstreamModels.filter((d) => !isTestNode(d));
  const filteredExposures = impact.affectedExposures;
  const totalVisible = filteredDownstream.length + filteredExposures.length;

  // Count how many tests were filtered
  const testCount = impact.downstreamModels.length - filteredDownstream.length;

  const lines: string[] = [];

  // NOT in <details> — visible by default for maximum impact
  lines.push(
    `### \uD83D\uDCCA Blast Radius \u2014 ${totalVisible} downstream ${totalVisible === 1 ? "model" : "models"}${testCount > 0 ? ` (${testCount} tests affected)` : ""}`,
  );
  lines.push("");
  lines.push("```mermaid");
  lines.push("graph LR");
  lines.push("    classDef modified fill:#ff6b6b,stroke:#c92a2a,color:#fff,stroke-width:2px");
  lines.push("    classDef downstream fill:#ffd43b,stroke:#e67700,color:#333,stroke-width:1px");
  lines.push("    classDef exposure fill:#845ef7,stroke:#5f3dc4,color:#fff,stroke-width:2px");
  lines.push("");

  const sanitize = (name: string): string => name.replace(/[^a-zA-Z0-9_]/g, "_");

  const modifiedSet = new Set(impact.modifiedModels);
  const exposureSet = new Set(filteredExposures);
  const visibleNodes = new Set([
    ...impact.modifiedModels,
    ...filteredDownstream,
    ...filteredExposures,
  ]);

  const edgesAdded = new Set<string>();
  const addEdge = (from: string, to: string) => {
    const key = `${from}-->${to}`;
    if (edgesAdded.has(key)) return;
    edgesAdded.add(key);

    const fromId = sanitize(from);
    const toId = sanitize(to);
    const fromClass = modifiedSet.has(from)
      ? "modified"
      : exposureSet.has(from)
        ? "exposure"
        : "downstream";
    const toClass = exposureSet.has(to)
      ? "exposure"
      : modifiedSet.has(to)
        ? "modified"
        : "downstream";

    // Use display-friendly labels (strip prefixes for readability)
    const fromLabel = from.replace(/^(stg_|int_|fct_|dim_|rpt_)/, (m) => m);
    const toLabel = to.replace(/^(stg_|int_|fct_|dim_|rpt_)/, (m) => m);

    lines.push(
      `    ${fromId}["${fromLabel}"]:::${fromClass} --> ${toId}["${toLabel}"]:::${toClass}`,
    );
  };

  if (impact.edges && impact.edges.length > 0) {
    // Use explicit edges, filtering out test nodes
    for (const edge of impact.edges) {
      if (!visibleNodes.has(edge.from) || !visibleNodes.has(edge.to)) continue;
      addEdge(edge.from, edge.to);
    }
  } else {
    // Fallback: connect modified -> downstream, downstream -> exposures
    for (const mod of impact.modifiedModels) {
      for (const ds of filteredDownstream) {
        addEdge(mod, ds);
      }
    }
    for (const ds of filteredDownstream) {
      for (const exp of filteredExposures) {
        addEdge(ds, exp);
      }
    }
  }

  lines.push("```");
  lines.push("");

  // Legend
  lines.push(
    `> \uD83D\uDD34 Modified \u00A0\u00A0 \uD83D\uDFE1 Downstream \u00A0\u00A0 \uD83D\uDFE3 Exposure${testCount > 0 ? ` \u00A0\u00A0 \uD83E\uDDEA ${testCount} tests also affected` : ""}`,
  );

  return lines.join("\n");
}

/** Display names for check category prefixes. */
const CATEGORY_LABELS: Record<string, string> = {
  lint: "Lint",
  safety: "Safety",
  validate: "Validation",
  policy: "Policy",
  pii: "PII",
  semantic: "Semantic",
  grade: "Grade",
};

/**
 * Extract the category prefix from a rule ID (e.g. `lint/L001` -> `lint`).
 * Returns `undefined` if the rule has no slash-delimited prefix.
 */
function extractCategory(rule?: string): string | undefined {
  if (!rule) return undefined;
  const slashIndex = rule.indexOf("/");
  return slashIndex > 0 ? rule.slice(0, slashIndex) : undefined;
}

/**
 * Build the SQL issues section, grouped first by check category (if
 * present), then by severity within each group.
 *
 * When issues come from `altimate-code check`, their `rule` field is
 * prefixed with the category (e.g. `lint/L001`, `safety/injection`).
 * Each category gets its own subsection. Issues without a category prefix
 * (from the regex rule engine) are grouped under a generic "SQL Quality"
 * heading.
 *
 * Critical/error issues are NOT collapsible (auto-expanded).
 * Warning/info issues are collapsible.
 */
export function buildIssuesSection(issues: SQLIssue[]): string {
  // Group by category prefix
  const byCategory = new Map<string, SQLIssue[]>();
  for (const issue of issues) {
    const cat = extractCategory(issue.rule) ?? "_default";
    const bucket = byCategory.get(cat) ?? [];
    bucket.push(issue);
    byCategory.set(cat, bucket);
  }

  // Render order: known categories first, then default
  const categoryOrder = [
    "lint",
    "safety",
    "validate",
    "policy",
    "pii",
    "semantic",
    "grade",
    "_default",
  ];
  const sortedCategories = [...byCategory.keys()].sort(
    (a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b),
  );

  const sections: string[] = [];

  for (const cat of sortedCategories) {
    const catIssues = byCategory.get(cat)!;
    const label = cat === "_default" ? "SQL Quality" : (CATEGORY_LABELS[cat] ?? cat);

    // If there are multiple categories, add a subsection header
    if (byCategory.size > 1) {
      sections.push(`#### ${label}`);
      sections.push("");
    }

    sections.push(buildSeverityGroupedTable(catIssues));
  }

  return sections.join("\n").trimEnd();
}

/**
 * Render a severity-grouped issues table. Critical/error auto-expanded,
 * warning/info collapsible.
 */
function buildSeverityGroupedTable(issues: SQLIssue[]): string {
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
      lines.push(`### ${emoji} ${count} ${noun}`);
      lines.push("");
    } else {
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
      const message = issue.message.replace(/\|/g, "\\|").replace(/\n/g, " ");
      const fix = issue.suggestion
        ? issue.suggestion.replace(/\|/g, "\\|").replace(/\n/g, " ")
        : "-";
      lines.push(`| ${i + 1} | \`${issue.file}\` | ${line} | ${message} | ${fix} |`);
    }

    lines.push("");

    if (!isCritical) {
      lines.push("</details>");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Build the cost before/after/delta table (collapsible).
 */
export function buildCostSection(estimates: CostEstimate[], totalDelta?: number): string {
  const lines: string[] = [];

  const delta = totalDelta ?? estimates.reduce((sum, e) => sum + e.costDelta, 0);
  const sign = delta >= 0 ? "+" : "";

  lines.push("<details>");
  lines.push(`<summary>\uD83D\uDCB0 Cost Impact \u2014 ${sign}$${delta.toFixed(2)}/mo</summary>`);
  lines.push("");
  lines.push("| Model | Before | After | Delta | Cause |");
  lines.push("|:------|-------:|------:|------:|:------|");

  for (const est of estimates) {
    const model = est.model ?? est.file;
    const before = est.costBefore !== undefined ? `$${est.costBefore.toFixed(2)}/mo` : "-";
    const after = est.costAfter !== undefined ? `$${est.costAfter.toFixed(2)}/mo` : "-";
    const estSign = est.costDelta >= 0 ? "+" : "";
    const cause = est.explanation ? est.explanation.replace(/\|/g, "\\|").replace(/\n/g, " ") : "-";
    lines.push(
      `| \`${model}\` | ${before} | ${after} | ${estSign}$${est.costDelta.toFixed(2)} | ${cause} |`,
    );
  }

  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
}

/**
 * Build the footer with version, zero-cost callout, and links.
 */
export function buildFooter(): string {
  return [
    "---",
    `<sub>\uD83D\uDD0D <a href="https://github.com/AltimateAI/altimate-code-actions">Altimate Code</a> v${VERSION} \u00B7 Validated without hitting your warehouse \u00B7 <a href="https://github.com/AltimateAI/altimate-code-actions/blob/main/docs/configuration.md">Configure</a> \u00B7 <a href="https://github.com/AltimateAI/altimate-code-actions/issues">Feedback</a></sub>`,
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
    const children = downstreamModels.filter((d) => !modifiedModels.includes(d));
    if (children.length === 0) {
      lines.push(root);
      continue;
    }

    if (children.length === 1) {
      lines.push(`${root} \u2500\u2500\u2192 ${children[0]}`);
    } else {
      lines.push(`${root} \u2500\u2500\u252C\u2500\u2500\u2192 ${children[0]}`);
      for (let i = 1; i < children.length - 1; i++) {
        const pad = " ".repeat(root.length + 1);
        lines.push(`${pad}\u251C\u2500\u2500\u2192 ${children[i]}`);
      }
      const pad = " ".repeat(root.length + 1);
      lines.push(`${pad}\u2514\u2500\u2500\u2192 ${children[children.length - 1]}`);
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
        core.info(`Posted ${inlineComments.length} inline comment(s) as a single review`);
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
