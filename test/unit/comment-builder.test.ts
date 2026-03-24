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
  buildHeader,
  buildSummaryTable,
  buildIssuesSection,
  buildDAGSection,
  buildCostSection,
  buildFooter,
} from "../../src/reporting/comment.js";

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
  // ---------------------------------------------------------------------------
  // buildComment
  // ---------------------------------------------------------------------------

  describe("buildComment", () => {
    it("returns null when no files were analyzed", () => {
      const report = makeReport({ filesAnalyzed: 0 });
      expect(buildComment(report)).toBeNull();
    });

    it("builds a complete comment for a clean PR", () => {
      const report = makeReport({ filesAnalyzed: 3 });
      const comment = buildComment(report)!;

      expect(comment).toContain("## \u2705 Altimate Code \u2014 All checks passed");
      expect(comment).toContain("| Check | Result | Details |");
      expect(comment).toContain("0 issues in 3 files");
      expect(comment).toContain("Altimate Code");
      expect(comment).toContain("Configure");
      expect(comment).toContain("Feedback");
    });

    it("builds a comment with warnings", () => {
      const report = makeReport({
        issues: [
          makeIssue({ severity: Severity.Warning, message: "SELECT * used" }),
          makeIssue({ severity: Severity.Warning, message: "Missing alias" }),
        ],
        issuesFound: 2,
      });
      const comment = buildComment(report)!;

      expect(comment).toContain("\u26A0\uFE0F Altimate Code \u2014 2 warnings found");
      expect(comment).toContain("SELECT * used");
      expect(comment).toContain("Missing alias");
      expect(comment).toContain("<details>");
    });

    it("builds a comment with critical issues", () => {
      const report = makeReport({
        issues: [
          makeIssue({ severity: Severity.Critical, message: "Non-deterministic JOIN" }),
          makeIssue({ severity: Severity.Warning, message: "Style issue" }),
        ],
        issuesFound: 2,
        shouldFail: true,
      });
      const comment = buildComment(report)!;

      expect(comment).toContain("\u274C Altimate Code \u2014 1 critical issue found");
      expect(comment).toContain("Non-deterministic JOIN");
    });

    it("includes all sections when data is present", () => {
      const impact: ImpactResult = {
        modifiedModels: ["stg_orders"],
        downstreamModels: ["orders", "revenue"],
        affectedExposures: ["dashboard_weekly"],
        affectedTests: ["test_orders_not_null"],
        impactScore: 72,
      };
      const costEstimates: CostEstimate[] = [
        {
          file: "models/orders.sql",
          model: "fct_revenue",
          costDelta: 1.6,
          costBefore: 0.8,
          costAfter: 2.4,
          currency: "USD",
          explanation: "Full table scan",
        },
      ];
      const report = makeReport({
        issues: [makeIssue({ severity: Severity.Warning })],
        issuesFound: 1,
        impact,
        impactScore: 72,
        costEstimates,
        estimatedCostDelta: 1.6,
      });
      const comment = buildComment(report)!;

      expect(comment).toContain("DAG Impact");
      expect(comment).toContain("Cost Impact");
      expect(comment).toContain("stg_orders");
      expect(comment).toContain("fct_revenue");
      expect(comment).toContain("$1.60");
    });

    it("truncates at 60K chars with notice", () => {
      const issues: SQLIssue[] = [];
      for (let i = 0; i < 5000; i++) {
        issues.push(
          makeIssue({
            message: `Issue #${i}: ${"x".repeat(200)}`,
            severity: Severity.Warning,
          }),
        );
      }
      const report = makeReport({ issues, issuesFound: issues.length });
      const comment = buildComment(report)!;

      expect(comment.length).toBeLessThanOrEqual(65536);
      expect(comment).toContain("truncated");
    });

    it("produces valid markdown (balanced markers)", () => {
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
      const comment = buildComment(report)!;

      const backtickPairs = (comment.match(/`/g) || []).length;
      expect(backtickPairs % 2).toBe(0);

      const boldMarkers = (comment.match(/\*\*/g) || []).length;
      expect(boldMarkers % 2).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // buildHeader
  // ---------------------------------------------------------------------------

  describe("buildHeader", () => {
    it("shows pass for zero issues", () => {
      const report = makeReport();
      expect(buildHeader(report)).toBe(
        "## \u2705 Altimate Code \u2014 All checks passed",
      );
    });

    it("shows warning count for warnings only", () => {
      const report = makeReport({
        issues: [
          makeIssue({ severity: Severity.Warning }),
          makeIssue({ severity: Severity.Warning }),
          makeIssue({ severity: Severity.Info }),
        ],
      });
      expect(buildHeader(report)).toBe(
        "## \u26A0\uFE0F Altimate Code \u2014 2 warnings found",
      );
    });

    it("shows critical count for errors/critical", () => {
      const report = makeReport({
        issues: [
          makeIssue({ severity: Severity.Critical }),
          makeIssue({ severity: Severity.Error }),
        ],
      });
      expect(buildHeader(report)).toBe(
        "## \u274C Altimate Code \u2014 2 critical issues found",
      );
    });

    it("uses singular noun for 1 warning", () => {
      const report = makeReport({
        issues: [makeIssue({ severity: Severity.Warning })],
      });
      expect(buildHeader(report)).toContain("1 warning found");
    });

    it("uses singular noun for 1 critical issue", () => {
      const report = makeReport({
        issues: [makeIssue({ severity: Severity.Critical })],
      });
      expect(buildHeader(report)).toContain("1 critical issue found");
    });
  });

  // ---------------------------------------------------------------------------
  // buildSummaryTable
  // ---------------------------------------------------------------------------

  describe("buildSummaryTable", () => {
    it("shows SQL Analysis passed row", () => {
      const report = makeReport({ filesAnalyzed: 3, issuesFound: 0 });
      const table = buildSummaryTable(report);

      expect(table).toContain("| SQL Analysis |");
      expect(table).toContain("Passed");
      expect(table).toContain("0 issues in 3 files");
    });

    it("shows dbt Impact row when impact data exists", () => {
      const report = makeReport({
        impact: {
          modifiedModels: ["stg_orders"],
          downstreamModels: ["orders", "revenue"],
          affectedExposures: [],
          affectedTests: [],
          impactScore: 50,
        },
      });
      const table = buildSummaryTable(report);

      expect(table).toContain("| dbt Impact |");
      expect(table).toContain("3 models");
      expect(table).toContain("1 direct, 2 downstream");
    });

    it("shows Cost Impact row with delta", () => {
      const report = makeReport({
        estimatedCostDelta: 12.5,
        costEstimates: [
          {
            file: "stg_orders.sql",
            costDelta: 12.5,
            currency: "USD",
            explanation: "stg_orders cost increased",
          },
        ],
      });
      const table = buildSummaryTable(report);

      expect(table).toContain("| Cost Impact |");
      expect(table).toContain("+$12.50/mo");
    });

    it("only shows rows for checks that were run", () => {
      const report = makeReport({ filesAnalyzed: 1 });
      const table = buildSummaryTable(report);

      expect(table).toContain("SQL Analysis");
      expect(table).not.toContain("dbt Impact");
      expect(table).not.toContain("Cost Impact");
    });
  });

  // ---------------------------------------------------------------------------
  // buildIssuesSection
  // ---------------------------------------------------------------------------

  describe("buildIssuesSection", () => {
    it("groups issues by severity", () => {
      const issues: SQLIssue[] = [
        makeIssue({ severity: Severity.Warning, message: "warn1" }),
        makeIssue({ severity: Severity.Critical, message: "crit1" }),
        makeIssue({ severity: Severity.Info, message: "info1" }),
      ];
      const section = buildIssuesSection(issues);

      const critIdx = section.indexOf("crit1");
      const warnIdx = section.indexOf("warn1");
      const infoIdx = section.indexOf("info1");

      expect(critIdx).toBeLessThan(warnIdx);
      expect(warnIdx).toBeLessThan(infoIdx);
    });

    it("wraps each severity in collapsible details", () => {
      const issues: SQLIssue[] = [
        makeIssue({ severity: Severity.Warning }),
        makeIssue({ severity: Severity.Error }),
      ];
      const section = buildIssuesSection(issues);

      expect(section).toContain("<details>");
      expect(section).toContain("</details>");
      expect(section).toContain("<summary>");
    });

    it("shows correct count labels", () => {
      const issues: SQLIssue[] = [
        makeIssue({ severity: Severity.Warning }),
        makeIssue({ severity: Severity.Warning }),
        makeIssue({ severity: Severity.Warning }),
      ];
      const section = buildIssuesSection(issues);

      expect(section).toContain("3 warnings");
    });

    it("includes file, line, issue, and rule columns", () => {
      const issues: SQLIssue[] = [
        makeIssue({
          file: "models/stg.sql",
          line: 42,
          message: "Bad query",
          rule: "PERF001",
          severity: Severity.Warning,
        }),
      ];
      const section = buildIssuesSection(issues);

      expect(section).toContain("| File | Line | Issue | Rule |");
      expect(section).toContain("`models/stg.sql`");
      expect(section).toContain("42");
      expect(section).toContain("Bad query");
      expect(section).toContain("`PERF001`");
    });

    it("escapes pipe characters in messages", () => {
      const issues: SQLIssue[] = [
        makeIssue({
          message: "col1 | col2 should be separate",
          severity: Severity.Warning,
        }),
      ];
      const section = buildIssuesSection(issues);
      expect(section).toContain("col1 \\| col2");
    });
  });

  // ---------------------------------------------------------------------------
  // buildDAGSection
  // ---------------------------------------------------------------------------

  describe("buildDAGSection", () => {
    it("shows modified and downstream models", () => {
      const impact: ImpactResult = {
        modifiedModels: ["stg_orders"],
        downstreamModels: ["fct_revenue", "dim_customers"],
        affectedExposures: [],
        affectedTests: [],
        impactScore: 60,
      };
      const section = buildDAGSection(impact);

      expect(section).toContain("DAG Impact");
      expect(section).toContain("3 models affected");
      expect(section).toContain("Modified in this PR");
      expect(section).toContain("stg_orders");
      expect(section).toContain("Downstream impact");
      expect(section).toContain("fct_revenue");
      expect(section).toContain("dim_customers");
    });

    it("includes affected exposures", () => {
      const impact: ImpactResult = {
        modifiedModels: ["stg_orders"],
        downstreamModels: [],
        affectedExposures: ["Revenue Dashboard"],
        affectedTests: [],
        impactScore: 40,
      };
      const section = buildDAGSection(impact);

      expect(section).toContain("Affected exposures");
      expect(section).toContain("Revenue Dashboard");
    });

    it("includes ASCII DAG", () => {
      const impact: ImpactResult = {
        modifiedModels: ["stg_orders"],
        downstreamModels: ["fct_revenue"],
        affectedExposures: [],
        affectedTests: [],
        impactScore: 50,
      };
      const section = buildDAGSection(impact);

      expect(section).toContain("```");
      expect(section).toContain("stg_orders");
      expect(section).toContain("\u2192"); // →
    });

    it("is collapsible", () => {
      const impact: ImpactResult = {
        modifiedModels: ["stg_orders"],
        downstreamModels: [],
        affectedExposures: [],
        affectedTests: [],
        impactScore: 10,
      };
      const section = buildDAGSection(impact);

      expect(section).toContain("<details>");
      expect(section).toContain("</details>");
    });
  });

  // ---------------------------------------------------------------------------
  // buildCostSection
  // ---------------------------------------------------------------------------

  describe("buildCostSection", () => {
    it("shows before/after/delta table", () => {
      const estimates: CostEstimate[] = [
        {
          file: "models/fct_revenue.sql",
          model: "fct_revenue",
          costBefore: 0.8,
          costAfter: 2.4,
          costDelta: 1.6,
          currency: "USD",
        },
      ];
      const section = buildCostSection(estimates, 1.6);

      expect(section).toContain("Cost Impact");
      expect(section).toContain("+$1.60/mo estimated");
      expect(section).toContain("| Model | Before | After | Delta |");
      expect(section).toContain("$0.80/mo");
      expect(section).toContain("$2.40/mo");
      expect(section).toContain("+$1.60");
    });

    it("shows cause when explanation provided", () => {
      const estimates: CostEstimate[] = [
        {
          file: "models/stg.sql",
          costDelta: 5.0,
          currency: "USD",
          explanation: "Full table scan due to missing partition filter",
        },
      ];
      const section = buildCostSection(estimates);

      expect(section).toContain("**Cause:**");
      expect(section).toContain("Full table scan");
    });

    it("is collapsible", () => {
      const estimates: CostEstimate[] = [
        { file: "a.sql", costDelta: 1.0, currency: "USD" },
      ];
      const section = buildCostSection(estimates);

      expect(section).toContain("<details>");
      expect(section).toContain("</details>");
    });

    it("uses model name when available, falls back to file", () => {
      const estimates: CostEstimate[] = [
        {
          file: "models/fct_revenue.sql",
          model: "fct_revenue",
          costDelta: 1.0,
          currency: "USD",
        },
        {
          file: "models/stg_orders.sql",
          costDelta: 2.0,
          currency: "USD",
        },
      ];
      const section = buildCostSection(estimates);

      expect(section).toContain("`fct_revenue`");
      expect(section).toContain("`models/stg_orders.sql`");
    });
  });

  // ---------------------------------------------------------------------------
  // buildASCIIDAG
  // ---------------------------------------------------------------------------

  describe("buildASCIIDAG", () => {
    const dummyImpact: ImpactResult = {
      modifiedModels: [],
      downstreamModels: [],
      affectedExposures: [],
      affectedTests: [],
      impactScore: 0,
    };

    it("returns empty string for no modified models", () => {
      expect(buildASCIIDAG([], [], dummyImpact)).toBe("");
    });

    it("renders a single edge", () => {
      const dag = buildASCIIDAG(["stg_orders"], ["fct_revenue"], dummyImpact);
      expect(dag).toContain("stg_orders");
      expect(dag).toContain("fct_revenue");
      expect(dag).toContain("\u2192"); // →
    });

    it("renders multiple children with tree branches", () => {
      const dag = buildASCIIDAG(
        ["stg_orders"],
        ["fct_revenue", "dim_customers"],
        dummyImpact,
      );
      expect(dag).toContain("\u252C"); // ┬
      expect(dag).toContain("\u2514"); // └
      expect(dag).toContain("fct_revenue");
      expect(dag).toContain("dim_customers");
    });

    it("renders model name alone when no children", () => {
      const dag = buildASCIIDAG(["stg_orders"], [], dummyImpact);
      expect(dag).toBe("stg_orders");
    });
  });

  // ---------------------------------------------------------------------------
  // buildFooter
  // ---------------------------------------------------------------------------

  describe("buildFooter", () => {
    it("includes version, configure link, and feedback link", () => {
      const footer = buildFooter();

      expect(footer).toContain("v0.2.0");
      expect(footer).toContain("Configure");
      expect(footer).toContain("Feedback");
      expect(footer).toContain("Altimate Code");
      expect(footer).toContain("---");
    });
  });
});
