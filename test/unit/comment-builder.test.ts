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
  buildExecutiveLine,
  buildSummaryTable,
  buildIssuesSection,
  buildMermaidDAG,
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

describe("Comment Builder v0.3", () => {
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

      expect(comment).toContain("## \u2705 Altimate Code");
      expect(comment).toContain("all checks passed");
      expect(comment).toContain("| Check | Result | Details |");
      expect(comment).toContain("3 files analyzed");
      expect(comment).toContain("Altimate Code");
      expect(comment).toContain("Configure");
      expect(comment).toContain("Feedback");
      // Clean PR should NOT have collapsible sections
      expect(comment).not.toContain("<details>");
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

      expect(comment).toContain("\u26A0\uFE0F Altimate Code");
      expect(comment).toContain("`2 warnings`");
      expect(comment).toContain("SELECT * used");
      expect(comment).toContain("Missing alias");
      // Warnings should be collapsible
      expect(comment).toContain("<details>");
    });

    it("builds a comment with critical issues (auto-expanded)", () => {
      const report = makeReport({
        issues: [
          makeIssue({ severity: Severity.Critical, message: "Non-deterministic JOIN" }),
          makeIssue({ severity: Severity.Warning, message: "Style issue" }),
        ],
        issuesFound: 2,
        shouldFail: true,
      });
      const comment = buildComment(report)!;

      expect(comment).toContain("\u274C Altimate Code");
      expect(comment).toContain("`1 critical`");
      expect(comment).toContain("Non-deterministic JOIN");
      // Critical issues should be in a ### heading, not <details>
      expect(comment).toContain("### \u274C 1 critical issue");
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

      // Mermaid DAG section
      expect(comment).toContain("Blast Radius");
      expect(comment).toContain("```mermaid");
      expect(comment).toContain("graph LR");
      // Cost section
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

      const boldMarkers = (comment.match(/\*\*/g) || []).length;
      expect(boldMarkers % 2).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // buildExecutiveLine
  // ---------------------------------------------------------------------------

  describe("buildExecutiveLine", () => {
    it("shows pass for zero issues", () => {
      const report = makeReport();
      const line = buildExecutiveLine(report);
      expect(line).toContain("## \u2705 Altimate Code");
      expect(line).toContain("all checks passed");
    });

    it("shows warning count for warnings only", () => {
      const report = makeReport({
        issues: [
          makeIssue({ severity: Severity.Warning }),
          makeIssue({ severity: Severity.Warning }),
          makeIssue({ severity: Severity.Info }),
        ],
      });
      const line = buildExecutiveLine(report);
      expect(line).toContain("\u26A0\uFE0F");
      expect(line).toContain("`2 warnings`");
    });

    it("shows critical count for errors/critical", () => {
      const report = makeReport({
        issues: [
          makeIssue({ severity: Severity.Critical }),
          makeIssue({ severity: Severity.Error }),
        ],
      });
      const line = buildExecutiveLine(report);
      expect(line).toContain("\u274C");
      expect(line).toContain("`2 critical`");
    });

    it("uses singular for 1 warning", () => {
      const report = makeReport({
        issues: [makeIssue({ severity: Severity.Warning })],
      });
      const line = buildExecutiveLine(report);
      expect(line).toContain("`1 warning`");
    });

    it("includes model and downstream counts when impact data exists", () => {
      const report = makeReport({
        impact: {
          modifiedModels: ["stg_orders", "stg_payments"],
          downstreamModels: ["fct_revenue", "dim_customers", "dim_orders"],
          affectedExposures: [],
          affectedTests: [],
          impactScore: 60,
        },
      });
      const line = buildExecutiveLine(report);
      expect(line).toContain("`2 models` modified");
      expect(line).toContain("`3 downstream`");
    });

    it("includes cost delta when present", () => {
      const report = makeReport({
        estimatedCostDelta: 1.6,
      });
      const line = buildExecutiveLine(report);
      expect(line).toContain("`+$1.60/mo`");
    });

    it("includes exposure count when present", () => {
      const report = makeReport({
        impact: {
          modifiedModels: ["stg_orders"],
          downstreamModels: [],
          affectedExposures: ["exec_dashboard", "revenue_report"],
          affectedTests: [],
          impactScore: 40,
        },
      });
      const line = buildExecutiveLine(report);
      expect(line).toContain("`2 exposures` at risk");
    });

    it("uses dot separator between parts", () => {
      const report = makeReport({
        issues: [makeIssue({ severity: Severity.Warning })],
        impact: {
          modifiedModels: ["stg_orders"],
          downstreamModels: ["fct_revenue"],
          affectedExposures: [],
          affectedTests: [],
          impactScore: 30,
        },
      });
      const line = buildExecutiveLine(report);
      expect(line).toContain("\u00B7"); // middle dot separator
    });
  });

  // ---------------------------------------------------------------------------
  // buildSummaryTable
  // ---------------------------------------------------------------------------

  describe("buildSummaryTable", () => {
    it("shows SQL Quality passed row", () => {
      const report = makeReport({ filesAnalyzed: 3, issuesFound: 0 });
      const table = buildSummaryTable(report);

      expect(table).toContain("| SQL Quality |");
      expect(table).toContain("0 issues");
      expect(table).toContain("3 files analyzed");
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
      expect(table).toContain("1 modified");
      expect(table).toContain("2 downstream");
    });

    it("shows Cost row with delta", () => {
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

      expect(table).toContain("| Cost |");
      expect(table).toContain("+$12.50/mo");
    });

    it("shows exposure count in dbt Impact details", () => {
      const report = makeReport({
        impact: {
          modifiedModels: ["stg_orders"],
          downstreamModels: ["fct_revenue"],
          affectedExposures: ["dashboard"],
          affectedTests: [],
          impactScore: 50,
        },
      });
      const table = buildSummaryTable(report);

      expect(table).toContain("1 exposure");
    });

    it("only shows rows for checks that were run", () => {
      const report = makeReport({ filesAnalyzed: 1 });
      const table = buildSummaryTable(report);

      expect(table).toContain("SQL Quality");
      expect(table).not.toContain("dbt Impact");
      expect(table).not.toContain("| Cost |");
    });
  });

  // ---------------------------------------------------------------------------
  // buildMermaidDAG
  // ---------------------------------------------------------------------------

  describe("buildMermaidDAG", () => {
    it("generates a mermaid graph with classDefs", () => {
      const impact: ImpactResult = {
        modifiedModels: ["stg_orders"],
        downstreamModels: ["fct_revenue", "dim_customers"],
        affectedExposures: [],
        affectedTests: [],
        impactScore: 60,
      };
      const section = buildMermaidDAG(impact);

      expect(section).toContain("```mermaid");
      expect(section).toContain("graph LR");
      expect(section).toContain("classDef modified fill:#ff6b6b");
      expect(section).toContain("classDef downstream fill:#ffd43b");
      expect(section).toContain("classDef exposure fill:#845ef7");
      expect(section).toContain("stg_orders");
      expect(section).toContain("fct_revenue");
      expect(section).toContain("dim_customers");
    });

    it("includes exposures with purple class", () => {
      const impact: ImpactResult = {
        modifiedModels: ["stg_orders"],
        downstreamModels: ["fct_revenue"],
        affectedExposures: ["exec_dashboard"],
        affectedTests: [],
        impactScore: 70,
      };
      const section = buildMermaidDAG(impact);

      expect(section).toContain("exec_dashboard");
      expect(section).toContain("exposure");
    });

    it("is visible by default (not collapsed)", () => {
      const impact: ImpactResult = {
        modifiedModels: ["stg_orders"],
        downstreamModels: ["fct_revenue"],
        affectedExposures: [],
        affectedTests: [],
        impactScore: 30,
      };
      const section = buildMermaidDAG(impact);

      // DAG should NOT be in <details> — it's the wow factor
      expect(section).not.toContain("<details>");
      expect(section).toContain("Blast Radius");
      expect(section).toContain("```mermaid");
    });

    it("shows correct downstream count in summary", () => {
      const impact: ImpactResult = {
        modifiedModels: ["stg_orders"],
        downstreamModels: ["fct_revenue", "dim_customers", "int_orders"],
        affectedExposures: ["dashboard"],
        affectedTests: [],
        impactScore: 80,
      };
      const section = buildMermaidDAG(impact);

      expect(section).toContain("4 downstream models");
    });

    it("sanitizes node IDs for mermaid compatibility", () => {
      const impact: ImpactResult = {
        modifiedModels: ["stg-orders.v2"],
        downstreamModels: ["fct revenue"],
        affectedExposures: [],
        affectedTests: [],
        impactScore: 30,
      };
      const section = buildMermaidDAG(impact);

      // Sanitized IDs should not contain hyphens/dots/spaces
      expect(section).toContain("stg_orders_v2");
      expect(section).toContain("fct_revenue");
    });

    it("connects downstream models to exposures", () => {
      const impact: ImpactResult = {
        modifiedModels: ["stg_orders"],
        downstreamModels: ["fct_revenue"],
        affectedExposures: ["exec_dashboard"],
        affectedTests: [],
        impactScore: 50,
      };
      const section = buildMermaidDAG(impact);

      expect(section).toContain("fct_revenue");
      expect(section).toContain("exec_dashboard");
      expect(section).toContain("exposure");
    });

    it("filters out test nodes from the diagram", () => {
      const impact: ImpactResult = {
        modifiedModels: ["stg_orders"],
        downstreamModels: ["fct_revenue", "not_null_stg_orders_id", "unique_stg_orders_id"],
        affectedExposures: [],
        affectedTests: ["not_null_stg_orders_id"],
        impactScore: 30,
      };
      const section = buildMermaidDAG(impact);

      expect(section).toContain("fct_revenue");
      expect(section).not.toContain("not_null_stg_orders_id");
      expect(section).not.toContain("unique_stg_orders_id");
      expect(section).toContain("2 tests affected");
    });

    it("includes a legend", () => {
      const impact: ImpactResult = {
        modifiedModels: ["stg_orders"],
        downstreamModels: ["fct_revenue"],
        affectedExposures: [],
        affectedTests: [],
        impactScore: 30,
      };
      const section = buildMermaidDAG(impact);

      expect(section).toContain("Modified");
      expect(section).toContain("Downstream");
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

    it("auto-expands critical issues (no <details>)", () => {
      const issues: SQLIssue[] = [
        makeIssue({ severity: Severity.Critical, message: "Critical bug" }),
      ];
      const section = buildIssuesSection(issues);

      expect(section).toContain("### \u274C 1 critical issue");
      expect(section).not.toContain("<details>");
    });

    it("wraps warnings in collapsible details", () => {
      const issues: SQLIssue[] = [
        makeIssue({ severity: Severity.Warning }),
      ];
      const section = buildIssuesSection(issues);

      expect(section).toContain("<details>");
      expect(section).toContain("</details>");
      expect(section).toContain("<summary>");
    });

    it("includes numbered rows with Fix column", () => {
      const issues: SQLIssue[] = [
        makeIssue({
          file: "models/stg.sql",
          line: 42,
          message: "Bad query",
          severity: Severity.Warning,
          suggestion: "Use explicit columns",
        }),
      ];
      const section = buildIssuesSection(issues);

      expect(section).toContain("| # | File | Line | Issue | Fix |");
      expect(section).toContain("| 1 |");
      expect(section).toContain("`models/stg.sql`");
      expect(section).toContain("42");
      expect(section).toContain("Bad query");
      expect(section).toContain("Use explicit columns");
    });

    it("shows dash for Fix when no suggestion provided", () => {
      const issues: SQLIssue[] = [
        makeIssue({ severity: Severity.Warning }),
      ];
      const section = buildIssuesSection(issues);

      expect(section).toMatch(/\| - \|$/m);
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

    it("mixes auto-expanded critical and collapsible warnings", () => {
      const issues: SQLIssue[] = [
        makeIssue({ severity: Severity.Critical, message: "critical_msg" }),
        makeIssue({ severity: Severity.Warning, message: "warning_msg" }),
      ];
      const section = buildIssuesSection(issues);

      // Critical: heading, not details
      expect(section).toContain("### \u274C 1 critical issue");
      // Warning: details
      expect(section).toContain("<details>");
      expect(section).toContain("\u26A0\uFE0F 1 warning");

      // Critical before warning
      expect(section.indexOf("critical_msg")).toBeLessThan(
        section.indexOf("warning_msg"),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // buildCostSection
  // ---------------------------------------------------------------------------

  describe("buildCostSection", () => {
    it("shows before/after/delta/cause table", () => {
      const estimates: CostEstimate[] = [
        {
          file: "models/fct_revenue.sql",
          model: "fct_revenue",
          costBefore: 0.8,
          costAfter: 2.4,
          costDelta: 1.6,
          currency: "USD",
          explanation: "Full table scan",
        },
      ];
      const section = buildCostSection(estimates, 1.6);

      expect(section).toContain("Cost Impact");
      expect(section).toContain("+$1.60/mo");
      expect(section).toContain("| Model | Before | After | Delta | Cause |");
      expect(section).toContain("$0.80/mo");
      expect(section).toContain("$2.40/mo");
      expect(section).toContain("+$1.60");
      expect(section).toContain("Full table scan");
    });

    it("shows cause inline in table row", () => {
      const estimates: CostEstimate[] = [
        {
          file: "models/stg.sql",
          costDelta: 5.0,
          currency: "USD",
          explanation: "Missing partition filter",
        },
      ];
      const section = buildCostSection(estimates);

      expect(section).toContain("Missing partition filter");
      expect(section).toMatch(/\| Missing partition filter \|$/m);
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

    it("shows dash for cause when no explanation provided", () => {
      const estimates: CostEstimate[] = [
        { file: "a.sql", costDelta: 1.0, currency: "USD" },
      ];
      const section = buildCostSection(estimates);

      expect(section).toMatch(/\| - \|$/m);
    });
  });

  // ---------------------------------------------------------------------------
  // buildASCIIDAG (legacy, kept for backward compat)
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

      expect(footer).toContain("v0.3.0");
      expect(footer).toContain("Configure");
      expect(footer).toContain("Feedback");
      expect(footer).toContain("Altimate Code");
      expect(footer).toContain("---");
    });
  });
});
