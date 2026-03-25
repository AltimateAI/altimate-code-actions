import { describe, it, expect } from "bun:test";
import {
  Severity,
  type ReviewReport,
  type SQLIssue,
  type ImpactResult,
  type CostEstimate,
  type ValidationSummary,
  type QueryProfile,
} from "../../src/analysis/types.js";
import { buildComment, buildASCIIDAG } from "../../src/reporting/comment.js";
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

function makeValidationSummary(): ValidationSummary {
  return {
    checksRun: ["validate", "lint", "safety", "pii"],
    schemaResolved: true,
    categories: {
      validate: {
        label: "SQL Syntax",
        method: "DataFusion against 14 table schemas",
        rulesChecked: 0,
        findingsCount: 0,
        passed: true,
      },
      lint: {
        label: "Anti-Patterns (26 rules)",
        method: "AST analysis: SELECT *, cartesian joins, missing GROUP BY, ...",
        rulesChecked: 26,
        findingsCount: 0,
        passed: true,
      },
      safety: {
        label: "Injection Safety (10 rules)",
        method: "Pattern scan: SQL injection, stacked queries, tautology, ...",
        rulesChecked: 10,
        findingsCount: 0,
        passed: true,
      },
      pii: {
        label: "PII Exposure",
        method: "Column classification: email, SSN, phone, credit card, ...",
        rulesChecked: 9,
        findingsCount: 0,
        passed: true,
      },
    },
  };
}

describe("PR Comment Generation v0.4", () => {
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

  it("shows validation table for clean PR with rich metadata", () => {
    const report = makeReport({
      filesAnalyzed: 3,
      issuesFound: 0,
      validationSummary: makeValidationSummary(),
    });
    const comment = buildComment(report)!;

    // Executive line
    expect(comment).toContain("validated");
    expect(comment).toContain("\u2705");
    // Validation table
    expect(comment).toContain("| What We Checked | How | Result |");
    expect(comment).toContain("SQL Syntax");
    expect(comment).toContain("Anti-Patterns (26 rules)");
    expect(comment).toContain("Injection Safety (10 rules)");
    expect(comment).toContain("PII Exposure");
    expect(comment).toContain("DataFusion");
    expect(comment).toContain("AST analysis");
    expect(comment).toContain("Pattern scan");
    expect(comment).toContain("Column classification");
    // Zero-cost callout
    expect(comment).toContain("Validated without hitting your warehouse");
  });

  it("shows legacy table for clean PR without validation summary", () => {
    const report = makeReport({ filesAnalyzed: 3, issuesFound: 0 });
    const comment = buildComment(report)!;

    expect(comment).toContain("| What We Checked | How | Result |");
    expect(comment).toContain("SQL Quality");
    expect(comment).toContain("3 files");
  });

  it("includes query profile section when profiles present", () => {
    const profiles: QueryProfile[] = [
      {
        file: "models/staging/stg_orders.sql",
        complexity: "Low",
        tablesReferenced: 2,
        joinCount: 1,
        joinTypes: ["INNER"],
        hasAggregation: false,
        hasSubquery: false,
        hasWindowFunction: false,
        hasCTE: true,
      },
    ];
    const report = makeReport({
      filesAnalyzed: 1,
      issuesFound: 0,
      queryProfiles: profiles,
      validationSummary: makeValidationSummary(),
    });
    const comment = buildComment(report)!;

    assertCommentHasSection(comment, "Query Profile");
    expect(comment).toContain("Complexity");
    expect(comment).toContain("Low");
    expect(comment).toContain("1 (INNER)");
  });

  it("includes collapsible issues section when warnings exist", () => {
    const report = makeReport({
      issues: [makeIssue({ severity: Severity.Warning, message: "Missing GROUP BY" })],
      issuesFound: 1,
    });
    const comment = buildComment(report)!;

    assertCommentHasSeverity(comment, "warning");
    expect(comment).toContain("<details>");
    expect(comment).toContain("Missing GROUP BY");
  });

  it("auto-expands critical issues (not in <details>)", () => {
    const report = makeReport({
      issues: [makeIssue({ severity: Severity.Critical, message: "Critical failure" })],
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
    expect(comment).toContain("stg_orders");
    expect(comment).toContain("orders");
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

    expect(comment).toContain("exec_dashboard");
    expect(comment).toContain("exposure");
    expect(comment).toContain("classDef exposure fill:#845ef7");
  });

  it("includes Breaking Changes row in validation table with impact data", () => {
    const impact: ImpactResult = {
      modifiedModels: ["stg_orders"],
      downstreamModels: ["fct_revenue", "dim_customers"],
      affectedExposures: [],
      affectedTests: [],
      impactScore: 40,
    };
    const report = makeReport({
      impact,
      impactScore: 40,
      validationSummary: makeValidationSummary(),
    });
    const comment = buildComment(report)!;

    expect(comment).toContain("Breaking Changes");
    expect(comment).toContain("2 downstream models");
    expect(comment).toContain("\u2705 Compatible");
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
      costEstimates: [{ file: "a.sql", costDelta: 1.6, currency: "USD" }],
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
    expect(comment).toContain("validated");
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

  it("includes footer with version, zero-cost callout, configure, and feedback links", () => {
    const report = makeReport();
    const comment = buildComment(report)!;

    expect(comment).toContain("v0.4.0");
    expect(comment).toContain("Validated without hitting your warehouse");
    expect(comment).toContain("Configure");
    expect(comment).toContain("Feedback");
    expect(comment).toContain("Altimate Code");
  });

  it("includes file count in validation table", () => {
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

    const dag = buildASCIIDAG(impact.modifiedModels, impact.downstreamModels, impact);

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

  it("executive line shows model counts, downstream safe, and findings", () => {
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

    expect(comment).toContain("`2 models` validated");
    expect(comment).toContain("`2 downstream`");
    expect(comment).toContain("`1 exposure` at risk");
    expect(comment).toContain("1 finding");
  });

  it("shows 'safe' for downstream when no issues", () => {
    const impact: ImpactResult = {
      modifiedModels: ["stg_orders"],
      downstreamModels: ["fct_revenue", "dim_customers"],
      affectedExposures: [],
      affectedTests: [],
      impactScore: 30,
    };
    const report = makeReport({ impact, impactScore: 30 });
    const comment = buildComment(report)!;

    expect(comment).toContain("`2 downstream` safe");
  });
});
