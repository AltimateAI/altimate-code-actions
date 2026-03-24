import { describe, it, expect } from "bun:test";
import type {
  ReviewReport,
  SQLIssue,
  ImpactResult,
  CostEstimate,
} from "../../src/analysis/types.js";
import { Severity } from "../../src/analysis/types.js";
import {
  buildComment,
  buildASCIIDAG,
} from "../../src/reporting/comment.js";
import {
  assertCommentHasSection,
  assertCommentHasSeverity,
  assertCommentFormat,
  assertCommentMissingSection,
} from "./helpers/assert-comment.js";

const GITHUB_COMMENT_LIMIT = 65536;

function makeReport(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    issues: [],
    filesAnalyzed: 10,
    issuesFound: 0,
    shouldFail: false,
    mode: "static",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeIssue(overrides: Partial<SQLIssue> = {}): SQLIssue {
  return {
    file: "models/stg_orders.sql",
    message: "Test issue",
    severity: Severity.Warning,
    ...overrides,
  };
}

describe("PR Comment Generation v0.3", () => {
  it("returns null when no SQL files were analyzed", () => {
    const report = makeReport({ filesAnalyzed: 0 });
    expect(buildComment(report)).toBeNull();
  });

  it("generates valid markdown comment", () => {
    const report = makeReport({
      issues: [makeIssue()],
      issuesFound: 1,
    });
    const comment = buildComment(report)!;
    assertCommentFormat(comment);
  });

  it("shows executive line and summary table for clean PR", () => {
    const report = makeReport({ filesAnalyzed: 3, issuesFound: 0 });
    const comment = buildComment(report)!;

    // Executive line
    expect(comment).toContain("all checks passed");
    expect(comment).toContain("\u2705");
    // Summary table
    expect(comment).toContain("| Check | Result | Details |");
    expect(comment).toContain("SQL Quality");
    expect(comment).toContain("3 files analyzed");
    // No collapsible sections for clean PR
    expect(comment).not.toContain("<details>");
  });

  it("includes collapsible issues section when warnings exist", () => {
    const report = makeReport({
      issues: [
        makeIssue({ severity: Severity.Warning, message: "Missing GROUP BY" }),
      ],
      issuesFound: 1,
    });
    const comment = buildComment(report)!;

    assertCommentHasSeverity(comment, "warning");
    expect(comment).toContain("<details>");
    expect(comment).toContain("Missing GROUP BY");
  });

  it("auto-expands critical issues (not in <details>)", () => {
    const report = makeReport({
      issues: [
        makeIssue({ severity: Severity.Critical, message: "Critical failure" }),
      ],
      issuesFound: 1,
    });
    const comment = buildComment(report)!;

    assertCommentHasSeverity(comment, "critical");
    expect(comment).toContain("### \u274C 1 critical issue");
    expect(comment).toContain("Critical failure");
  });

  it("does not include issues section when no issues", () => {
    const report = makeReport({ issues: [], issuesFound: 0 });
    const comment = buildComment(report)!;

    assertCommentMissingSection(comment, "critical");
    assertCommentMissingSection(comment, "warning");
  });

  it("includes Mermaid DAG blast radius when dbt data present", () => {
    const impact: ImpactResult = {
      modifiedModels: ["stg_orders"],
      downstreamModels: ["orders", "revenue"],
      affectedExposures: [],
      affectedTests: [],
      impactScore: 65,
    };
    const report = makeReport({ impact, impactScore: 65 });
    const comment = buildComment(report)!;

    assertCommentHasSection(comment, "Blast Radius");
    expect(comment).toContain("```mermaid");
    expect(comment).toContain("graph LR");
    expect(comment).toContain("stg_orders:::modified");
    expect(comment).toContain("orders:::downstream");
    expect(comment).toContain("2 downstream models");
  });

  it("includes exposures in Mermaid DAG with purple class", () => {
    const impact: ImpactResult = {
      modifiedModels: ["stg_orders"],
      downstreamModels: ["fct_revenue"],
      affectedExposures: ["exec_dashboard"],
      affectedTests: [],
      impactScore: 70,
    };
    const report = makeReport({ impact, impactScore: 70 });
    const comment = buildComment(report)!;

    expect(comment).toContain("exec_dashboard:::exposure");
    expect(comment).toContain("classDef exposure fill:#845ef7");
  });

  it("includes cost section with before/after/delta/cause", () => {
    const costEstimates: CostEstimate[] = [
      {
        file: "models/orders.sql",
        model: "fct_orders",
        costDelta: 12.5,
        costBefore: 5.0,
        costAfter: 17.5,
        currency: "USD",
        explanation: "Full table scan",
      },
    ];
    const report = makeReport({
      costEstimates,
      estimatedCostDelta: 12.5,
    });
    const comment = buildComment(report)!;

    assertCommentHasSection(comment, "Cost Impact");
    expect(comment).toContain("$12.50");
    expect(comment).toContain("fct_orders");
    expect(comment).toContain("| Model | Before | After | Delta | Cause |");
    expect(comment).toContain("Full table scan");
  });

  it("shows cost delta in executive line", () => {
    const report = makeReport({
      estimatedCostDelta: 1.6,
      costEstimates: [
        { file: "a.sql", costDelta: 1.6, currency: "USD" },
      ],
    });
    const comment = buildComment(report)!;

    expect(comment).toContain("`+$1.60/mo`");
  });

  it("respects severity grouping (critical first, info last)", () => {
    const report = makeReport({
      issues: [
        makeIssue({ severity: Severity.Info, message: "AAA_info" }),
        makeIssue({ severity: Severity.Critical, message: "AAA_critical" }),
        makeIssue({ severity: Severity.Error, message: "AAA_error" }),
      ],
      issuesFound: 3,
    });
    const comment = buildComment(report)!;

    assertCommentHasSeverity(comment, "info");
    assertCommentHasSeverity(comment, "critical");

    const critIdx = comment.indexOf("AAA_critical");
    const errIdx = comment.indexOf("AAA_error");
    const infoIdx = comment.indexOf("AAA_info");

    expect(critIdx).toBeLessThan(errIdx);
    expect(errIdx).toBeLessThan(infoIdx);
  });

  it("handles empty results gracefully", () => {
    const report = makeReport({
      issues: [],
      issuesFound: 0,
      filesAnalyzed: 1,
    });
    const comment = buildComment(report)!;

    assertCommentFormat(comment);
    expect(comment).toContain("all checks passed");
    expect(comment).toContain("1 files analyzed");
  });

  it("truncates long comments to within GitHub limit", () => {
    const issues: SQLIssue[] = [];
    for (let i = 0; i < 3000; i++) {
      issues.push(
        makeIssue({
          message: `Issue ${i}: ${"a".repeat(300)}`,
          severity: Severity.Warning,
          file: `models/model_${i}.sql`,
        }),
      );
    }
    const report = makeReport({ issues, issuesFound: issues.length });
    const comment = buildComment(report)!;

    expect(comment.length).toBeLessThanOrEqual(GITHUB_COMMENT_LIMIT);
    expect(comment).toContain("truncated");
    expect(comment).toContain("Altimate Code");
  });

  it("includes footer with version, configure, and feedback links", () => {
    const report = makeReport();
    const comment = buildComment(report)!;

    expect(comment).toContain("v0.3.0");
    expect(comment).toContain("Configure");
    expect(comment).toContain("Feedback");
    expect(comment).toContain("Altimate Code");
  });

  it("includes file count in summary table", () => {
    const report = makeReport({
      filesAnalyzed: 42,
      issuesFound: 0,
    });
    const comment = buildComment(report)!;

    expect(comment).toContain("42");
  });

  it("generates ASCII DAG with tree branches (legacy)", () => {
    const impact: ImpactResult = {
      modifiedModels: ["stg_orders"],
      downstreamModels: ["fct_revenue", "dim_customers"],
      affectedExposures: [],
      affectedTests: [],
      impactScore: 50,
    };

    const dag = buildASCIIDAG(
      impact.modifiedModels,
      impact.downstreamModels,
      impact,
    );

    expect(dag).toContain("stg_orders");
    expect(dag).toContain("fct_revenue");
    expect(dag).toContain("dim_customers");
  });

  it("issues table includes numbered rows with Fix column", () => {
    const report = makeReport({
      issues: [
        makeIssue({
          severity: Severity.Warning,
          message: "SELECT * detected",
          suggestion: "List columns explicitly",
          line: 14,
          file: "fct_revenue.sql",
        }),
        makeIssue({
          severity: Severity.Warning,
          message: "Non-deterministic CURRENT_DATE",
          suggestion: "Use {{ run_date }} variable",
          line: 23,
          file: "fct_revenue.sql",
        }),
      ],
      issuesFound: 2,
    });
    const comment = buildComment(report)!;

    expect(comment).toContain("| # | File | Line | Issue | Fix |");
    expect(comment).toContain("| 1 |");
    expect(comment).toContain("| 2 |");
    expect(comment).toContain("List columns explicitly");
    expect(comment).toContain("Use {{ run_date }} variable");
  });

  it("executive line shows model counts and downstream", () => {
    const impact: ImpactResult = {
      modifiedModels: ["stg_orders", "stg_payments"],
      downstreamModels: ["fct_revenue", "dim_customers"],
      affectedExposures: ["exec_dashboard"],
      affectedTests: [],
      impactScore: 80,
    };
    const report = makeReport({
      impact,
      impactScore: 80,
      issues: [makeIssue({ severity: Severity.Warning })],
      issuesFound: 1,
    });
    const comment = buildComment(report)!;

    expect(comment).toContain("`2 models` modified");
    expect(comment).toContain("`2 downstream`");
    expect(comment).toContain("`1 exposure` at risk");
  });
});
