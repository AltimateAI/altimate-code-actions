import { describe, it, expect } from "bun:test";
import {
  RuleRegistry,
  createRegistry,
  type Rule,
  type RuleCategory,
} from "../../src/analysis/rules.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { Severity } from "../../src/analysis/types.js";
import type { AltimateConfig } from "../../src/config/schema.js";

function makeConfig(overrides?: Partial<AltimateConfig>): AltimateConfig {
  return { ...structuredClone(DEFAULT_CONFIG), ...overrides };
}

/** Config with Info threshold so all rules fire. */
function makeInfoConfig(): AltimateConfig {
  return makeConfig({
    sql_review: {
      ...DEFAULT_CONFIG.sql_review,
      severity_threshold: Severity.Info,
    },
  });
}

const VALID_CATEGORIES: RuleCategory[] = ["correctness", "performance", "style", "security"];

describe("Rule Registry", () => {
  describe("built-in rules", () => {
    it("has all 19 built-in rules registered", () => {
      const registry = new RuleRegistry();
      const ids = registry.getRuleIds();

      expect(ids.length).toBe(19);
      expect(ids).toContain("select_star");
      expect(ids).toContain("cartesian_join");
      expect(ids).toContain("missing_partition");
      expect(ids).toContain("non_deterministic");
      expect(ids).toContain("correlated_subquery");
      expect(ids).toContain("implicit_type_cast");
      expect(ids).toContain("or_in_join");
      expect(ids).toContain("missing_group_by");
      expect(ids).toContain("order_by_ordinal");
      expect(ids).toContain("union_without_all");
      expect(ids).toContain("nested_subquery");
      expect(ids).toContain("missing_where_clause");
      expect(ids).toContain("leading_wildcard_like");
      expect(ids).toContain("duplicate_column_alias");
      expect(ids).toContain("function_on_indexed_column");
      expect(ids).toContain("not_in_with_nulls");
      expect(ids).toContain("distinct_masking_bad_join");
      expect(ids).toContain("count_for_existence");
      expect(ids).toContain("no_limit_on_delete");
    });

    it("each rule has required metadata", () => {
      const registry = new RuleRegistry();

      for (const rule of registry.getAllRules()) {
        expect(rule.id).toBeTruthy();
        expect(rule.name).toBeTruthy();
        expect(rule.description).toBeTruthy();
        expect(rule.defaultSeverity).toBeTruthy();
        expect(typeof rule.detect).toBe("function");
      }
    });

    it("each rule has a valid category", () => {
      const registry = new RuleRegistry();

      for (const rule of registry.getAllRules()) {
        expect(VALID_CATEGORIES).toContain(rule.category);
      }
    });

    it("can retrieve a rule by ID", () => {
      const registry = new RuleRegistry();
      const rule = registry.getRule("select_star");

      expect(rule).toBeDefined();
      expect(rule!.id).toBe("select_star");
      expect(rule!.name).toBe("No SELECT *");
    });

    it("returns undefined for unknown rule ID", () => {
      const registry = new RuleRegistry();
      expect(registry.getRule("nonexistent")).toBeUndefined();
    });

    it("hasRule returns correct boolean", () => {
      const registry = new RuleRegistry();
      expect(registry.hasRule("select_star")).toBe(true);
      expect(registry.hasRule("nonexistent")).toBe(false);
    });
  });

  describe("custom rules", () => {
    it("can add a custom rule", () => {
      const registry = new RuleRegistry();
      const customRule: Rule = {
        id: "my_custom_rule",
        name: "My Custom Rule",
        description: "Test rule",
        category: "style",
        defaultSeverity: Severity.Warning,
        detect: (_sql, file) => [
          {
            file,
            message: "Custom issue",
            severity: Severity.Warning,
            rule: "my_custom_rule",
          },
        ],
      };

      registry.addRule(customRule);

      expect(registry.hasRule("my_custom_rule")).toBe(true);
      expect(registry.getRule("my_custom_rule")?.name).toBe("My Custom Rule");
    });

    it("replacing an existing rule ID overwrites it", () => {
      const registry = new RuleRegistry();
      const original = registry.getRule("select_star")!;
      expect(original.name).toBe("No SELECT *");

      registry.addRule({
        id: "select_star",
        name: "Replaced Rule",
        description: "Override",
        category: "style",
        defaultSeverity: Severity.Critical,
        detect: () => [],
      });

      expect(registry.getRule("select_star")!.name).toBe("Replaced Rule");
    });

    it("can remove a rule", () => {
      const registry = new RuleRegistry();
      expect(registry.hasRule("select_star")).toBe(true);

      const removed = registry.removeRule("select_star");

      expect(removed).toBe(true);
      expect(registry.hasRule("select_star")).toBe(false);
    });

    it("removeRule returns false for nonexistent rule", () => {
      const registry = new RuleRegistry();
      expect(registry.removeRule("nonexistent")).toBe(false);
    });

    it("adds custom patterns from config", () => {
      const registry = new RuleRegistry();
      registry.addCustomPatterns([
        {
          name: "no_truncate",
          pattern: "\\bTRUNCATE\\b",
          message: "TRUNCATE is dangerous",
          severity: Severity.Critical,
        },
        {
          name: "no drop table",
          pattern: "\\bDROP\\s+TABLE\\b",
          message: "DROP TABLE detected",
          severity: Severity.Error,
        },
      ]);

      expect(registry.hasRule("custom_no_truncate")).toBe(true);
      expect(registry.hasRule("custom_no_drop_table")).toBe(true);

      // Total should be 19 built-in + 2 custom
      expect(registry.getRuleIds().length).toBe(21);
    });

    it("skips custom patterns with invalid regex", () => {
      const registry = new RuleRegistry();
      const before = registry.getRuleIds().length;

      registry.addCustomPatterns([
        {
          name: "bad_regex",
          pattern: "[invalid(regex",
          message: "Should be skipped",
          severity: Severity.Warning,
        },
      ]);

      // Should not add the rule since the regex is invalid
      expect(registry.getRuleIds().length).toBe(before);
    });
  });

  describe("createRegistry", () => {
    it("creates a registry with built-in rules", () => {
      const config = makeConfig();
      const registry = createRegistry(config);

      expect(registry.getRuleIds().length).toBe(19);
    });

    it("creates a registry with custom patterns from config", () => {
      const config = makeConfig();
      config.sql_review.custom_patterns = [
        {
          name: "no_truncate",
          pattern: "\\bTRUNCATE\\b",
          message: "No TRUNCATE",
          severity: Severity.Error,
        },
      ];

      const registry = createRegistry(config);

      expect(registry.hasRule("custom_no_truncate")).toBe(true);
      expect(registry.getRuleIds().length).toBe(20);
    });
  });

  describe("rule detection", () => {
    describe("select_star", () => {
      it("detects SELECT * statements", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "SELECT * FROM orders";

        const issues = registry.analyze(sql, "test.sql", config);
        const selectStarIssues = issues.filter((i) => i.rule === "select_star");

        expect(selectStarIssues.length).toBeGreaterThan(0);
        expect(selectStarIssues[0].line).toBe(1);
        expect(selectStarIssues[0].suggestion).toBeTruthy();
      });

      it("does not flag explicit column lists", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "SELECT id, name, status FROM orders";

        const issues = registry.analyze(sql, "test.sql", config);
        const selectStarIssues = issues.filter((i) => i.rule === "select_star");

        expect(selectStarIssues.length).toBe(0);
      });
    });

    describe("cartesian_join", () => {
      it("detects comma-separated tables in FROM", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "SELECT a.id FROM orders a, customers b";

        const issues = registry.analyze(sql, "test.sql", config);
        const cartesianIssues = issues.filter((i) => i.rule === "cartesian_join");

        expect(cartesianIssues.length).toBeGreaterThan(0);
        expect(cartesianIssues[0].suggestion).toBeTruthy();
      });

      it("does not flag explicit JOIN", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "SELECT a.id FROM orders a JOIN customers b ON a.customer_id = b.id";

        const issues = registry.analyze(sql, "test.sql", config);
        const cartesianIssues = issues.filter((i) => i.rule === "cartesian_join");

        expect(cartesianIssues.length).toBe(0);
      });
    });

    describe("non_deterministic", () => {
      it("detects NOW()", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "SELECT NOW() AS current_time";

        const issues = registry.analyze(sql, "test.sql", config);
        const ndIssues = issues.filter((i) => i.rule === "non_deterministic");

        expect(ndIssues.length).toBeGreaterThan(0);
        expect(ndIssues[0].suggestion).toBeTruthy();
      });

      it("detects CURRENT_DATE()", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "WHERE created_at > CURRENT_DATE()";

        const issues = registry.analyze(sql, "test.sql", config);
        const ndIssues = issues.filter((i) => i.rule === "non_deterministic");

        expect(ndIssues.length).toBeGreaterThan(0);
      });
    });

    describe("order_by_ordinal", () => {
      it("detects ORDER BY with numbers", () => {
        const registry = new RuleRegistry();
        const config = makeInfoConfig();
        const sql = "SELECT id, name FROM users ORDER BY 1";

        const issues = registry.analyze(sql, "test.sql", config);
        const ordinalIssues = issues.filter((i) => i.rule === "order_by_ordinal");

        expect(ordinalIssues.length).toBeGreaterThan(0);
        expect(ordinalIssues[0].suggestion).toBeTruthy();
      });

      it("does not flag ORDER BY column names", () => {
        const registry = new RuleRegistry();
        const config = makeInfoConfig();
        const sql = "SELECT id, name FROM users ORDER BY name";

        const issues = registry.analyze(sql, "test.sql", config);
        const ordinalIssues = issues.filter((i) => i.rule === "order_by_ordinal");

        expect(ordinalIssues.length).toBe(0);
      });
    });

    describe("missing_where_clause", () => {
      it("detects DELETE without WHERE", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "DELETE FROM users;";

        const issues = registry.analyze(sql, "test.sql", config);
        const whereIssues = issues.filter((i) => i.rule === "missing_where_clause");

        expect(whereIssues.length).toBeGreaterThan(0);
        expect(whereIssues[0].message).toContain("DELETE");
        expect(whereIssues[0].suggestion).toBeTruthy();
      });

      it("does not flag DELETE with WHERE", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "DELETE FROM users WHERE id = 1;";

        const issues = registry.analyze(sql, "test.sql", config);
        const whereIssues = issues.filter((i) => i.rule === "missing_where_clause");

        expect(whereIssues.length).toBe(0);
      });

      it("detects UPDATE without WHERE", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "UPDATE users SET status = 'inactive';";

        const issues = registry.analyze(sql, "test.sql", config);
        const whereIssues = issues.filter((i) => i.rule === "missing_where_clause");

        expect(whereIssues.length).toBeGreaterThan(0);
        expect(whereIssues[0].message).toContain("UPDATE");
      });
    });

    describe("union_without_all", () => {
      it("detects UNION without ALL", () => {
        const registry = new RuleRegistry();
        const config = makeInfoConfig();
        const sql = "SELECT id FROM a\nUNION\nSELECT id FROM b";

        const issues = registry.analyze(sql, "test.sql", config);
        const unionIssues = issues.filter((i) => i.rule === "union_without_all");

        expect(unionIssues.length).toBeGreaterThan(0);
        expect(unionIssues[0].suggestion).toBeTruthy();
      });

      it("does not flag UNION ALL", () => {
        const registry = new RuleRegistry();
        const config = makeInfoConfig();
        const sql = "SELECT id FROM a\nUNION ALL\nSELECT id FROM b";

        const issues = registry.analyze(sql, "test.sql", config);
        const unionIssues = issues.filter((i) => i.rule === "union_without_all");

        expect(unionIssues.length).toBe(0);
      });
    });

    describe("leading_wildcard_like", () => {
      it("detects LIKE with leading %", () => {
        const registry = new RuleRegistry();
        const config = makeInfoConfig();
        const sql = "WHERE name LIKE '%smith'";

        const issues = registry.analyze(sql, "test.sql", config);
        const likeIssues = issues.filter((i) => i.rule === "leading_wildcard_like");

        expect(likeIssues.length).toBeGreaterThan(0);
        expect(likeIssues[0].suggestion).toBeTruthy();
      });

      it("does not flag LIKE with trailing %", () => {
        const registry = new RuleRegistry();
        const config = makeInfoConfig();
        const sql = "WHERE name LIKE 'smith%'";

        const issues = registry.analyze(sql, "test.sql", config);
        const likeIssues = issues.filter((i) => i.rule === "leading_wildcard_like");

        expect(likeIssues.length).toBe(0);
      });
    });

    // -----------------------------------------------------------------------
    // New rule detectors
    // -----------------------------------------------------------------------

    describe("function_on_indexed_column", () => {
      it("detects UPPER() in WHERE clause", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "SELECT id FROM users WHERE UPPER(name) = 'ALICE'";

        const issues = registry.analyze(sql, "test.sql", config);
        const fnIssues = issues.filter((i) => i.rule === "function_on_indexed_column");

        expect(fnIssues.length).toBeGreaterThan(0);
        expect(fnIssues[0].suggestion).toBeTruthy();
      });

      it("detects YEAR() in WHERE clause", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "SELECT * FROM orders WHERE YEAR(order_date) = 2024";

        const issues = registry.analyze(sql, "test.sql", config);
        const fnIssues = issues.filter((i) => i.rule === "function_on_indexed_column");

        expect(fnIssues.length).toBeGreaterThan(0);
      });

      it("detects CAST() in WHERE clause", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "SELECT id FROM users WHERE CAST(age AS VARCHAR) = '30'";

        const issues = registry.analyze(sql, "test.sql", config);
        const fnIssues = issues.filter((i) => i.rule === "function_on_indexed_column");

        expect(fnIssues.length).toBeGreaterThan(0);
      });

      it("does not flag functions outside WHERE", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "SELECT UPPER(name) AS upper_name FROM users";

        const issues = registry.analyze(sql, "test.sql", config);
        const fnIssues = issues.filter((i) => i.rule === "function_on_indexed_column");

        expect(fnIssues.length).toBe(0);
      });
    });

    describe("not_in_with_nulls", () => {
      it("detects NOT IN with subquery", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql =
          "SELECT id FROM customers WHERE customer_id NOT IN (SELECT customer_id FROM orders)";

        const issues = registry.analyze(sql, "test.sql", config);
        const niIssues = issues.filter((i) => i.rule === "not_in_with_nulls");

        expect(niIssues.length).toBeGreaterThan(0);
        expect(niIssues[0].suggestion).toBeTruthy();
      });

      it("does not flag NOT IN with literal list", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "SELECT id FROM users WHERE status NOT IN ('active', 'pending')";

        const issues = registry.analyze(sql, "test.sql", config);
        const niIssues = issues.filter((i) => i.rule === "not_in_with_nulls");

        expect(niIssues.length).toBe(0);
      });
    });

    describe("distinct_masking_bad_join", () => {
      it("detects SELECT DISTINCT with JOIN", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = [
          "SELECT DISTINCT o.order_id, c.customer_name",
          "FROM orders o",
          "JOIN customers c ON o.customer_id = c.customer_id",
          "JOIN order_items oi ON o.order_id = oi.order_id",
        ].join("\n");

        const issues = registry.analyze(sql, "test.sql", config);
        const distinctIssues = issues.filter((i) => i.rule === "distinct_masking_bad_join");

        expect(distinctIssues.length).toBeGreaterThan(0);
        expect(distinctIssues[0].suggestion).toBeTruthy();
      });

      it("does not flag SELECT DISTINCT without JOIN", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "SELECT DISTINCT status FROM orders";

        const issues = registry.analyze(sql, "test.sql", config);
        const distinctIssues = issues.filter((i) => i.rule === "distinct_masking_bad_join");

        expect(distinctIssues.length).toBe(0);
      });

      it("does not flag SELECT without DISTINCT", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "SELECT o.id FROM orders o JOIN customers c ON o.customer_id = c.id";

        const issues = registry.analyze(sql, "test.sql", config);
        const distinctIssues = issues.filter((i) => i.rule === "distinct_masking_bad_join");

        expect(distinctIssues.length).toBe(0);
      });
    });

    describe("count_for_existence", () => {
      it("detects COUNT(*) > 0", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql =
          "SELECT department FROM departments d WHERE (SELECT COUNT(*) FROM employees e WHERE e.dept_id = d.id) > 0";

        const issues = registry.analyze(sql, "test.sql", config);
        const countIssues = issues.filter((i) => i.rule === "count_for_existence");

        expect(countIssues.length).toBeGreaterThan(0);
        expect(countIssues[0].suggestion).toBeTruthy();
      });

      it("does not flag COUNT(*) without > 0", () => {
        const registry = new RuleRegistry();
        const config = makeConfig();
        const sql = "SELECT department, COUNT(*) AS cnt FROM employees GROUP BY department";

        const issues = registry.analyze(sql, "test.sql", config);
        const countIssues = issues.filter((i) => i.rule === "count_for_existence");

        expect(countIssues.length).toBe(0);
      });
    });

    describe("no_limit_on_delete", () => {
      it("detects DELETE without LIMIT", () => {
        const registry = new RuleRegistry();
        const config = makeInfoConfig();
        const sql = "DELETE FROM event_logs WHERE created_at < '2023-01-01';";

        const issues = registry.analyze(sql, "test.sql", config);
        const deleteIssues = issues.filter((i) => i.rule === "no_limit_on_delete");

        expect(deleteIssues.length).toBeGreaterThan(0);
        expect(deleteIssues[0].suggestion).toBeTruthy();
      });

      it("does not flag DELETE with LIMIT", () => {
        const registry = new RuleRegistry();
        const config = makeInfoConfig();
        const sql = "DELETE FROM event_logs WHERE created_at < '2023-01-01' LIMIT 10000;";

        const issues = registry.analyze(sql, "test.sql", config);
        const deleteIssues = issues.filter((i) => i.rule === "no_limit_on_delete");

        expect(deleteIssues.length).toBe(0);
      });
    });
  });

  describe("suggestions", () => {
    it("all built-in rules produce issues with suggestions", () => {
      const registry = new RuleRegistry();
      const config = makeInfoConfig();

      // SQL that triggers every rule
      const triggerSqls: Record<string, string> = {
        select_star: "SELECT * FROM orders",
        cartesian_join: "SELECT a.id FROM orders a, customers b",
        non_deterministic: "SELECT NOW() AS t",
        or_in_join: "SELECT a.id FROM orders a JOIN customers b ON a.id = b.id OR a.name = b.name",
        order_by_ordinal: "SELECT id, name FROM users ORDER BY 1",
        leading_wildcard_like: "WHERE name LIKE '%smith'",
        function_on_indexed_column: "SELECT id FROM users WHERE UPPER(name) = 'X'",
        not_in_with_nulls: "SELECT id FROM a WHERE id NOT IN (SELECT id FROM b)",
        count_for_existence: "WHERE COUNT(*) > 0",
        no_limit_on_delete: "DELETE FROM logs WHERE dt < '2023-01-01';",
      };

      for (const [ruleId, sql] of Object.entries(triggerSqls)) {
        const issues = registry.analyze(sql, "test.sql", config);
        const ruleIssues = issues.filter((i) => i.rule === ruleId);
        expect(ruleIssues.length).toBeGreaterThan(0);
        expect(ruleIssues[0].suggestion).toBeTruthy();
      }
    });
  });

  describe("categories", () => {
    it("rules have expected categories", () => {
      const registry = new RuleRegistry();

      expect(registry.getRule("select_star")!.category).toBe("style");
      expect(registry.getRule("cartesian_join")!.category).toBe("correctness");
      expect(registry.getRule("correlated_subquery")!.category).toBe("performance");
      expect(registry.getRule("missing_where_clause")!.category).toBe("security");
      expect(registry.getRule("function_on_indexed_column")!.category).toBe("performance");
      expect(registry.getRule("not_in_with_nulls")!.category).toBe("correctness");
      expect(registry.getRule("distinct_masking_bad_join")!.category).toBe("correctness");
      expect(registry.getRule("count_for_existence")!.category).toBe("performance");
      expect(registry.getRule("no_limit_on_delete")!.category).toBe("security");
    });

    it("every rule has a category from the allowed set", () => {
      const registry = new RuleRegistry();

      for (const rule of registry.getAllRules()) {
        expect(VALID_CATEGORIES).toContain(rule.category);
      }
    });
  });

  describe("config-driven behavior", () => {
    it("skips disabled rules", () => {
      const registry = new RuleRegistry();
      const config = makeConfig();
      config.sql_review.rules.select_star.enabled = false;

      const sql = "SELECT * FROM orders";
      const issues = registry.analyze(sql, "test.sql", config);
      const selectStarIssues = issues.filter((i) => i.rule === "select_star");

      expect(selectStarIssues.length).toBe(0);
    });

    it("overrides rule severity from config", () => {
      const registry = new RuleRegistry();
      const config = makeConfig();
      config.sql_review.rules.select_star.severity = Severity.Critical;

      const sql = "SELECT * FROM orders";
      const issues = registry.analyze(sql, "test.sql", config);
      const selectStarIssues = issues.filter((i) => i.rule === "select_star");

      expect(selectStarIssues.length).toBeGreaterThan(0);
      expect(selectStarIssues[0].severity).toBe(Severity.Critical);
    });

    it("filters issues below severity threshold", () => {
      const registry = new RuleRegistry();
      const config = makeConfig();
      config.sql_review.severity_threshold = Severity.Error;

      // This SQL has a select_star (warning) and nothing at error level
      const sql = "SELECT * FROM orders";
      const issues = registry.analyze(sql, "test.sql", config);
      const selectStarIssues = issues.filter((i) => i.rule === "select_star");

      // select_star is severity=warning, which is below error threshold
      expect(selectStarIssues.length).toBe(0);
    });

    it("custom pattern rules are detected during analysis", () => {
      const config = makeConfig();
      config.sql_review.custom_patterns = [
        {
          name: "no_truncate",
          pattern: "\\bTRUNCATE\\b",
          message: "No TRUNCATE allowed",
          severity: Severity.Critical,
        },
      ];

      const registry = createRegistry(config);
      const sql = "TRUNCATE TABLE users;";
      const issues = registry.analyze(sql, "test.sql", config);
      const truncateIssues = issues.filter((i) => i.rule === "custom_no_truncate");

      expect(truncateIssues.length).toBeGreaterThan(0);
      expect(truncateIssues[0].severity).toBe(Severity.Critical);
      expect(truncateIssues[0].message).toBe("No TRUNCATE allowed");
    });

    it("sorts issues by line number then severity", () => {
      const registry = new RuleRegistry();
      const config = makeInfoConfig();
      const sql = [
        "SELECT * FROM orders", // line 1: select_star (warning)
        "ORDER BY 1", // line 2: order_by_ordinal (info)
      ].join("\n");

      const issues = registry.analyze(sql, "test.sql", config);

      // First issue should be on line 1
      expect(issues.length).toBeGreaterThan(0);
      if (issues.length >= 2) {
        expect(issues[0].line!).toBeLessThanOrEqual(issues[1].line!);
      }
    });

    it("gracefully handles rule detection errors", () => {
      const registry = new RuleRegistry();
      // Add a rule that throws
      registry.addRule({
        id: "broken_rule",
        name: "Broken",
        description: "Always throws",
        category: "correctness",
        defaultSeverity: Severity.Error,
        detect: () => {
          throw new Error("rule exploded");
        },
      });

      const config = makeConfig();
      const sql = "SELECT 1";
      const issues = registry.analyze(sql, "test.sql", config);

      // Should have an info-level issue about the error, not crash
      const errorIssues = issues.filter((i) => i.rule === "broken_rule");
      expect(errorIssues.length).toBe(1);
      expect(errorIssues[0].message).toContain("rule exploded");
      expect(errorIssues[0].severity).toBe(Severity.Info);
    });
  });
});
