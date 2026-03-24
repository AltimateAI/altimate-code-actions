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

describe("PR Comment Generation", () => {
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

  it("shows pass header and summary table for clean PR", () => {
    const report = makeReport({ filesAnalyzed: 3, issuesFound: 0 });
    const comment = buildComment(report)!;

    expect(comment).toContain("All checks passed");
    expect(comment).toContain("| Check | Result | Details |");
    expect(comment).toContain("0 issues in 3 files");
    // No collapsible sections for clean PR
    expect(comment).not.toContain("<details>");
  });

  it("includes collapsible issues section when issues exist", () => {
    const report = makeReport({
      issues: [
        makeIssue({ severity: Severity.Error, message: "Missing GROUP BY" }),
      ],
      issuesFound: 1,
    });
    const comment = buildComment(report)!;

    assertCommentHasSeverity(comment, "error");
    expect(comment).toContain("<details>");
    expect(comment).toContain("Missing GROUP BY");
  });

  it("does not include issues section when no issues", () => {
    const report = makeReport({ issues: [], issuesFound: 0 });
    const comment = buildComment(report)!;

    assertCommentMissingSection(comment, "critical");
    assertCommentMissingSection(comment, "warning");
  });

  it("includes DAG impact section when dbt data present", () => {
    const impact: ImpactResult = {
      modifiedModels: ["stg_orders"],
      downstreamModels: ["orders", "revenue"],
      affectedExposures: [],
      affectedTests: [],
      impactScore: 65,
    };
    const report = makeReport({ impact, impactScore: 65 });
    const comment = buildComment(report)!;

    assertCommentHasSection(comment, "DAG Impact");
    expect(comment).toContain("stg_orders");
    expect(comment).toContain("orders");
    expect(comment).toContain("3 models affected");
  });

  it("includes cost section when cost estimates provided", () => {
    const costEstimates: CostEstimate[] = [
      {
        file: "models/orders.sql",
        model: "fct_orders",
        costDelta: 12.5,
        costBefore: 5.0,
        costAfter: 17.5,
        currency: "USD",
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
    expect(comment).toContain("All checks passed");
    expect(comment).toContain("0 issues in 1 files");
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

    expect(comment).toContain("v0.2.0");
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

  it("generates ASCII DAG with tree branches", () => {
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
});
