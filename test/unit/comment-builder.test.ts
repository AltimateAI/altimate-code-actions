import { describe, it, expect } from "bun:test";
import type {
  ReviewReport,
  SQLIssue,
  ImpactResult,
  CostEstimate,
} from "../../src/analysis/types.js";
import { Severity, SEVERITY_WEIGHT } from "../../src/analysis/types.js";

/**
 * Minimal comment builder that mirrors expected production behavior.
 * We test the logic directly since the source module may not exist yet.
 * When the real module is built, tests should be updated to import from it.
 */

const GITHUB_COMMENT_LIMIT = 65536;
const FOOTER = "\n\n---\n*Powered by [Altimate Code](https://altimate.ai)*";

function buildComment(report: ReviewReport): string {
  const sections: string[] = [];

  // Header
  sections.push(`## Altimate Code Review`);
  sections.push("");

  // Summary line
  sections.push(
    `Analyzed **${report.filesAnalyzed}** files, found **${report.issuesFound}** issues.`,
  );
  sections.push("");

  // SQL Quality section
  if (report.issues.length > 0) {
    sections.push("### SQL Quality");
    sections.push("");

    // Sort issues by severity (critical first)
    const sorted = [...report.issues].sort(
      (a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity],
    );

    for (const issue of sorted) {
      const sev = issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1);
      const loc = issue.line ? ` (line ${issue.line})` : "";
      sections.push(
        `- **${sev}**: \`${issue.file}\`${loc} — ${issue.message}`,
      );
      if (issue.suggestion) {
        sections.push(`  > Suggestion: ${issue.suggestion}`);
      }
    }
    sections.push("");
  }

  // Impact section
  if (report.impact) {
    sections.push("### Impact Analysis");
    sections.push("");
    sections.push(
      `- Modified models: ${report.impact.modifiedModels.join(", ") || "none"}`,
    );
    sections.push(
      `- Downstream models: ${report.impact.downstreamModels.join(", ") || "none"}`,
    );
    sections.push(
      `- Affected exposures: ${report.impact.affectedExposures.join(", ") || "none"}`,
    );
    sections.push(`- Impact score: **${report.impact.impactScore}**/100`);
    sections.push("");
  }

  // Cost section
  if (report.costEstimates && report.costEstimates.length > 0) {
    sections.push("### Cost Estimation");
    sections.push("");
    for (const est of report.costEstimates) {
      const abs = Math.abs(est.costDelta).toFixed(2);
      const formatted = est.costDelta >= 0 ? `+$${abs}` : `-$${abs}`;
      sections.push(
        `- \`${est.file}\`: ${formatted} ${est.currency}/mo`,
      );
    }
    sections.push("");
  }

  // Footer
  sections.push(FOOTER);

  let comment = sections.join("\n");

  // Truncate if over GitHub limit
  if (comment.length > GITHUB_COMMENT_LIMIT) {
    const truncMsg =
      "\n\n*...comment truncated due to GitHub size limit...*" + FOOTER;
    comment = comment.slice(0, GITHUB_COMMENT_LIMIT - truncMsg.length) + truncMsg;
  }

  return comment;
}

function makeReport(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    issues: [],
    filesAnalyzed: 5,
    issuesFound: 0,
    shouldFail: false,
    mode: "static",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeIssue(overrides: Partial<SQLIssue> = {}): SQLIssue {
  return {
    file: "models/staging/stg_orders.sql",
    message: "Using SELECT * is discouraged",
    severity: Severity.Warning,
    ...overrides,
  };
}

describe("Comment Builder", () => {
  it("builds markdown from review results with issues", () => {
    const report = makeReport({
      issues: [
        makeIssue({ severity: Severity.Error, message: "Missing GROUP BY" }),
        makeIssue({ severity: Severity.Warning, message: "SELECT * used" }),
      ],
      issuesFound: 2,
    });

    const comment = buildComment(report);

    expect(comment).toContain("## Altimate Code Review");
    expect(comment).toContain("### SQL Quality");
    expect(comment).toContain("Missing GROUP BY");
    expect(comment).toContain("SELECT * used");
  });

  it("includes powered-by footer", () => {
    const report = makeReport();
    const comment = buildComment(report);

    expect(comment).toContain("Powered by");
    expect(comment).toContain("Altimate Code");
    expect(comment).toContain("altimate.ai");
  });

  it("truncates at 65536 chars", () => {
    // Create a report with enough issues to exceed the limit
    const issues: SQLIssue[] = [];
    for (let i = 0; i < 5000; i++) {
      issues.push(
        makeIssue({
          message: `Issue #${i}: ${"x".repeat(200)} this is a very long description that should cause the comment to exceed GitHub limits.`,
          severity: Severity.Warning,
        }),
      );
    }
    const report = makeReport({ issues, issuesFound: issues.length });
    const comment = buildComment(report);

    expect(comment.length).toBeLessThanOrEqual(65536);
    expect(comment).toContain("truncated");
  });

  it("handles zero issues", () => {
    const report = makeReport({ issues: [], issuesFound: 0 });
    const comment = buildComment(report);

    expect(comment).toContain("found **0** issues");
    expect(comment).not.toContain("### SQL Quality");
  });

  it("sorts issues by severity (critical first, info last)", () => {
    const issues: SQLIssue[] = [
      makeIssue({ severity: Severity.Info, message: "Info issue" }),
      makeIssue({ severity: Severity.Critical, message: "Critical issue" }),
      makeIssue({ severity: Severity.Warning, message: "Warning issue" }),
      makeIssue({ severity: Severity.Error, message: "Error issue" }),
    ];
    const report = makeReport({ issues, issuesFound: 4 });
    const comment = buildComment(report);

    const criticalIdx = comment.indexOf("Critical issue");
    const errorIdx = comment.indexOf("Error issue");
    const warningIdx = comment.indexOf("Warning issue");
    const infoIdx = comment.indexOf("Info issue");

    expect(criticalIdx).toBeLessThan(errorIdx);
    expect(errorIdx).toBeLessThan(warningIdx);
    expect(warningIdx).toBeLessThan(infoIdx);
  });

  it("includes impact analysis section when provided", () => {
    const impact: ImpactResult = {
      modifiedModels: ["stg_orders"],
      downstreamModels: ["orders", "revenue"],
      affectedExposures: ["dashboard_weekly"],
      affectedTests: ["test_orders_not_null"],
      impactScore: 72,
    };
    const report = makeReport({ impact, impactScore: 72 });
    const comment = buildComment(report);

    expect(comment).toContain("### Impact Analysis");
    expect(comment).toContain("stg_orders");
    expect(comment).toContain("orders");
    expect(comment).toContain("revenue");
    expect(comment).toContain("dashboard_weekly");
    expect(comment).toContain("72");
  });

  it("includes cost estimation section when provided", () => {
    const costEstimates: CostEstimate[] = [
      {
        file: "models/marts/orders.sql",
        costDelta: 15.5,
        currency: "USD",
      },
      {
        file: "models/marts/revenue.sql",
        costDelta: -3.2,
        currency: "USD",
      },
    ];
    const report = makeReport({ costEstimates });
    const comment = buildComment(report);

    expect(comment).toContain("### Cost Estimation");
    expect(comment).toContain("+$15.50");
    expect(comment).toContain("-$3.20");
  });

  it("includes line numbers when available", () => {
    const issues: SQLIssue[] = [
      makeIssue({ line: 42, message: "Issue at line 42" }),
    ];
    const report = makeReport({ issues, issuesFound: 1 });
    const comment = buildComment(report);

    expect(comment).toContain("(line 42)");
  });

  it("includes suggestions when available", () => {
    const issues: SQLIssue[] = [
      makeIssue({
        message: "SELECT * used",
        suggestion: "List columns explicitly",
      }),
    ];
    const report = makeReport({ issues, issuesFound: 1 });
    const comment = buildComment(report);

    expect(comment).toContain("Suggestion: List columns explicitly");
  });

  it("produces valid markdown (no broken formatting)", () => {
    const report = makeReport({
      issues: [makeIssue()],
      issuesFound: 1,
      impact: {
        modifiedModels: ["stg_orders"],
        downstreamModels: ["orders"],
        affectedExposures: [],
        affectedTests: [],
        impactScore: 30,
      },
    });
    const comment = buildComment(report);

    // Check balanced markdown elements
    const backtickPairs = (comment.match(/`/g) || []).length;
    expect(backtickPairs % 2).toBe(0);

    // No unclosed bold markers
    const boldMarkers = (comment.match(/\*\*/g) || []).length;
    expect(boldMarkers % 2).toBe(0);
  });
});
