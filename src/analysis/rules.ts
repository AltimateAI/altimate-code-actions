import { Severity, SEVERITY_WEIGHT } from "./types.js";
import type { SQLIssue } from "./types.js";
import type {
  AltimateConfig,
  RuleConfig,
  CustomPattern,
} from "../config/schema.js";

/** Function signature for a rule's detection logic. */
export type RuleDetector = (sql: string, file: string) => SQLIssue[];

/** A registered rule with its metadata and detection function. */
export interface Rule {
  /** Unique identifier for the rule (matches config key). */
  id: string;
  /** Short human-readable name. */
  name: string;
  /** Description of what this rule checks. */
  description: string;
  /** Default severity (can be overridden by config). */
  defaultSeverity: Severity;
  /** Detection function that scans SQL and returns issues. */
  detect: RuleDetector;
}

// ---------------------------------------------------------------------------
// Built-in rule detectors
// ---------------------------------------------------------------------------

function findAllMatches(
  sql: string,
  file: string,
  regex: RegExp,
  ruleId: string,
  message: string,
  severity: Severity,
): SQLIssue[] {
  const issues: SQLIssue[] = [];
  const lines = sql.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      issues.push({
        file,
        line: i + 1,
        message,
        severity,
        rule: ruleId,
      });
    }
  }

  return issues;
}

function detectSelectStar(sql: string, file: string): SQLIssue[] {
  return findAllMatches(
    sql,
    file,
    /\bSELECT\s+\*/i,
    "select_star",
    "SELECT * detected — explicitly list columns for clarity and performance",
    Severity.Warning,
  );
}

function detectCartesianJoin(sql: string, file: string): SQLIssue[] {
  const issues: SQLIssue[] = [];
  const lines = sql.split("\n");

  // Look for comma-separated tables in FROM without a WHERE (simple heuristic)
  // Handles aliases: FROM orders a, customers b
  const fromPattern = /\bFROM\s+\w+(?:\s+\w+)?\s*,\s*\w+/i;
  for (let i = 0; i < lines.length; i++) {
    if (fromPattern.test(lines[i])) {
      issues.push({
        file,
        line: i + 1,
        message:
          "Possible cartesian join — comma-separated tables in FROM without explicit JOIN. Use explicit JOIN syntax instead.",
        severity: Severity.Error,
        rule: "cartesian_join",
      });
    }
  }

  return issues;
}

function detectMissingPartition(sql: string, file: string): SQLIssue[] {
  const issues: SQLIssue[] = [];
  const lines = sql.split("\n");
  const fullUpper = sql.toUpperCase();

  // If query has window functions but no PARTITION BY
  if (
    /\b(ROW_NUMBER|RANK|DENSE_RANK|NTILE|LAG|LEAD)\s*\(/i.test(sql) &&
    !fullUpper.includes("PARTITION BY")
  ) {
    for (let i = 0; i < lines.length; i++) {
      if (
        /\b(ROW_NUMBER|RANK|DENSE_RANK|NTILE|LAG|LEAD)\s*\(/i.test(lines[i])
      ) {
        issues.push({
          file,
          line: i + 1,
          message:
            "Window function without PARTITION BY — this operates over the entire result set",
          severity: Severity.Warning,
          rule: "missing_partition",
        });
      }
    }
  }

  return issues;
}

function detectNonDeterministic(sql: string, file: string): SQLIssue[] {
  // Match with or without parens: CURRENT_DATE, CURRENT_DATE(), NOW(), etc.
  return findAllMatches(
    sql,
    file,
    /\b(CURRENT_DATE|CURRENT_TIMESTAMP|NOW|GETDATE|SYSDATE|SYSTIMESTAMP)\b(\s*\(\s*\))?/i,
    "non_deterministic",
    "Non-deterministic function detected — results will vary between runs. Consider parameterizing.",
    Severity.Warning,
  );
}

function detectCorrelatedSubquery(sql: string, file: string): SQLIssue[] {
  const issues: SQLIssue[] = [];
  const lines = sql.split("\n");

  // Simple heuristic: subquery in WHERE/SELECT that references outer alias
  // Look for WHERE ... (SELECT ... WHERE outer.col pattern
  const subqueryInWhere =
    /\bWHERE\s+.*\(\s*SELECT\b/i;

  for (let i = 0; i < lines.length; i++) {
    if (subqueryInWhere.test(lines[i])) {
      issues.push({
        file,
        line: i + 1,
        message:
          "Possible correlated subquery in WHERE clause — consider rewriting as a JOIN for better performance",
        severity: Severity.Warning,
        rule: "correlated_subquery",
      });
    }
  }

  return issues;
}

function detectImplicitTypeCast(sql: string, file: string): SQLIssue[] {
  const issues: SQLIssue[] = [];
  const lines = sql.split("\n");

  // Detect comparing string literals to numeric columns or vice versa
  // Heuristic: WHERE col = '123' pattern (numeric string in comparison)
  const pattern = /\b\w+\s*=\s*'[0-9]+'/;

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      issues.push({
        file,
        line: i + 1,
        message:
          "Possible implicit type cast — comparing a column to a quoted numeric literal",
        severity: Severity.Info,
        rule: "implicit_type_cast",
      });
    }
  }

  return issues;
}

function detectOrInJoin(sql: string, file: string): SQLIssue[] {
  return findAllMatches(
    sql,
    file,
    /\bJOIN\b[^;]*\bON\b[^;]*\bOR\b/i,
    "or_in_join",
    "OR in JOIN condition — this can prevent index usage and cause full scans",
    Severity.Warning,
  );
}

function detectMissingGroupBy(sql: string, file: string): SQLIssue[] {
  const issues: SQLIssue[] = [];
  const lines = sql.split("\n");
  const fullUpper = sql.toUpperCase();

  // Skip if query uses window functions (OVER clause) — aggregates in OVER
  // don't require GROUP BY
  if (/\bOVER\s*\(/i.test(sql)) return issues;

  // If query has aggregate functions but no GROUP BY
  const hasAggregate =
    /\b(SUM|COUNT|AVG|MIN|MAX)\s*\(/i.test(sql);
  const hasGroupBy = fullUpper.includes("GROUP BY");

  if (hasAggregate && !hasGroupBy) {
    // Only flag if there are non-aggregate columns in SELECT
    // Simple heuristic: check if SELECT has more than just the aggregate
    const selectMatch = sql.match(/\bSELECT\b([\s\S]*?)\bFROM\b/i);
    if (selectMatch) {
      const selectClause = selectMatch[1];
      const hasNonAggColumn = /\b(?!SUM|COUNT|AVG|MIN|MAX)\w+\s*[,\s]/i.test(
        selectClause,
      );
      if (hasNonAggColumn) {
        for (let i = 0; i < lines.length; i++) {
          if (/\bSELECT\b/i.test(lines[i])) {
            issues.push({
              file,
              line: i + 1,
              message:
                "Aggregate function used without GROUP BY — non-aggregate columns may cause errors",
              severity: Severity.Error,
              rule: "missing_group_by",
            });
            break;
          }
        }
      }
    }
  }

  return issues;
}

function detectOrderByOrdinal(sql: string, file: string): SQLIssue[] {
  return findAllMatches(
    sql,
    file,
    /\bORDER\s+BY\s+\d+/i,
    "order_by_ordinal",
    "ORDER BY uses ordinal position — use column names for maintainability",
    Severity.Info,
  );
}

function detectUnionWithoutAll(sql: string, file: string): SQLIssue[] {
  const issues: SQLIssue[] = [];
  const lines = sql.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match UNION that is NOT followed by ALL (on same or next line)
    if (/\bUNION\b/i.test(line) && !/\bUNION\s+ALL\b/i.test(line)) {
      // Check if next line starts with ALL
      const nextLine = lines[i + 1]?.trim() ?? "";
      if (!/^ALL\b/i.test(nextLine)) {
        issues.push({
          file,
          line: i + 1,
          message:
            "UNION without ALL causes an implicit DISTINCT — use UNION ALL if duplicates are acceptable",
          severity: Severity.Info,
          rule: "union_without_all",
        });
      }
    }
  }

  return issues;
}

function detectNestedSubquery(sql: string, file: string): SQLIssue[] {
  const issues: SQLIssue[] = [];
  const lines = sql.split("\n");

  // Count nesting depth of parenthesized SELECT statements
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      if (line[j] === "(") depth++;
      if (line[j] === ")") depth = Math.max(0, depth - 1);
    }
    if (depth >= 3 && /\bSELECT\b/i.test(line)) {
      issues.push({
        file,
        line: i + 1,
        message:
          "Deeply nested subquery (3+ levels) — consider using CTEs for readability",
        severity: Severity.Warning,
        rule: "nested_subquery",
      });
    }
  }

  return issues;
}

function detectMissingWhereClause(sql: string, file: string): SQLIssue[] {
  const issues: SQLIssue[] = [];
  const lines = sql.split("\n");

  // Detect UPDATE/DELETE without WHERE
  const dangerousPattern =
    /\b(UPDATE\s+\w+\s+SET|DELETE\s+FROM\s+\w+)\b/i;

  for (let i = 0; i < lines.length; i++) {
    if (dangerousPattern.test(lines[i])) {
      // Look ahead for WHERE within the next few lines
      const lookahead = lines.slice(i, i + 5).join(" ");
      if (!/\bWHERE\b/i.test(lookahead)) {
        const op = /\bUPDATE\b/i.test(lines[i]) ? "UPDATE" : "DELETE";
        issues.push({
          file,
          line: i + 1,
          message: `${op} without WHERE clause — this affects all rows in the table`,
          severity: Severity.Warning,
          rule: "missing_where_clause",
        });
      }
    }
  }

  return issues;
}

function detectLeadingWildcardLike(sql: string, file: string): SQLIssue[] {
  return findAllMatches(
    sql,
    file,
    /\bLIKE\s+'%/i,
    "leading_wildcard_like",
    "LIKE with leading wildcard prevents index usage — consider full-text search",
    Severity.Info,
  );
}

function detectDuplicateColumnAlias(sql: string, file: string): SQLIssue[] {
  const issues: SQLIssue[] = [];

  // Extract aliases from SELECT clause
  const selectMatch = sql.match(/\bSELECT\b([\s\S]*?)\bFROM\b/i);
  if (!selectMatch) return issues;

  const selectClause = selectMatch[1];
  const aliasPattern = /\bAS\s+(\w+)/gi;
  const aliases = new Map<string, number>();
  let match;

  while ((match = aliasPattern.exec(selectClause)) !== null) {
    const alias = match[1].toLowerCase();
    aliases.set(alias, (aliases.get(alias) ?? 0) + 1);
  }

  for (const [alias, count] of aliases) {
    if (count > 1) {
      // Find the line of the duplicate
      const lines = sql.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const asPattern = new RegExp(`\\bAS\\s+${alias}\\b`, "i");
        if (asPattern.test(lines[i])) {
          issues.push({
            file,
            line: i + 1,
            message: `Duplicate column alias '${alias}' — this will cause ambiguous results`,
            severity: Severity.Error,
            rule: "duplicate_column_alias",
          });
          break;
        }
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

/** All built-in rules. */
const BUILTIN_RULES: Rule[] = [
  {
    id: "select_star",
    name: "No SELECT *",
    description: "Flags SELECT * statements that should list columns explicitly",
    defaultSeverity: Severity.Warning,
    detect: detectSelectStar,
  },
  {
    id: "cartesian_join",
    name: "Cartesian Join",
    description: "Detects implicit cartesian joins from comma-separated tables",
    defaultSeverity: Severity.Error,
    detect: detectCartesianJoin,
  },
  {
    id: "missing_partition",
    name: "Missing PARTITION BY",
    description: "Flags window functions without PARTITION BY",
    defaultSeverity: Severity.Warning,
    detect: detectMissingPartition,
  },
  {
    id: "non_deterministic",
    name: "Non-deterministic Function",
    description: "Detects functions like NOW(), CURRENT_DATE that produce varying results",
    defaultSeverity: Severity.Warning,
    detect: detectNonDeterministic,
  },
  {
    id: "correlated_subquery",
    name: "Correlated Subquery",
    description: "Flags subqueries in WHERE that may be correlated",
    defaultSeverity: Severity.Warning,
    detect: detectCorrelatedSubquery,
  },
  {
    id: "implicit_type_cast",
    name: "Implicit Type Cast",
    description: "Detects potential implicit type casts in comparisons",
    defaultSeverity: Severity.Info,
    detect: detectImplicitTypeCast,
  },
  {
    id: "or_in_join",
    name: "OR in JOIN",
    description: "Flags OR conditions in JOIN clauses that prevent index usage",
    defaultSeverity: Severity.Warning,
    detect: detectOrInJoin,
  },
  {
    id: "missing_group_by",
    name: "Missing GROUP BY",
    description: "Detects aggregate functions with non-aggregate columns but no GROUP BY",
    defaultSeverity: Severity.Error,
    detect: detectMissingGroupBy,
  },
  {
    id: "order_by_ordinal",
    name: "ORDER BY Ordinal",
    description: "Flags ORDER BY with numeric ordinals instead of column names",
    defaultSeverity: Severity.Info,
    detect: detectOrderByOrdinal,
  },
  {
    id: "union_without_all",
    name: "UNION without ALL",
    description: "Detects UNION without ALL that causes implicit DISTINCT",
    defaultSeverity: Severity.Info,
    detect: detectUnionWithoutAll,
  },
  {
    id: "nested_subquery",
    name: "Nested Subquery",
    description: "Flags deeply nested subqueries that should use CTEs",
    defaultSeverity: Severity.Warning,
    detect: detectNestedSubquery,
  },
  {
    id: "missing_where_clause",
    name: "Missing WHERE Clause",
    description: "Detects UPDATE/DELETE without WHERE clause",
    defaultSeverity: Severity.Warning,
    detect: detectMissingWhereClause,
  },
  {
    id: "leading_wildcard_like",
    name: "Leading Wildcard LIKE",
    description: "Flags LIKE patterns starting with % that prevent index usage",
    defaultSeverity: Severity.Info,
    detect: detectLeadingWildcardLike,
  },
  {
    id: "duplicate_column_alias",
    name: "Duplicate Column Alias",
    description: "Detects duplicate AS aliases in SELECT",
    defaultSeverity: Severity.Error,
    detect: detectDuplicateColumnAlias,
  },
];

/**
 * The rule registry holds all active rules — both built-in and custom. It
 * provides methods to run rules against SQL content and respects the
 * enable/disable and severity overrides from the config.
 */
export class RuleRegistry {
  private rules: Map<string, Rule> = new Map();

  constructor() {
    // Register all built-in rules
    for (const rule of BUILTIN_RULES) {
      this.rules.set(rule.id, rule);
    }
  }

  /** Get all registered rule IDs. */
  getRuleIds(): string[] {
    return [...this.rules.keys()];
  }

  /** Get a rule by ID. */
  getRule(id: string): Rule | undefined {
    return this.rules.get(id);
  }

  /** Get all registered rules. */
  getAllRules(): Rule[] {
    return [...this.rules.values()];
  }

  /** Check if a rule is registered. */
  hasRule(id: string): boolean {
    return this.rules.has(id);
  }

  /**
   * Register a custom rule. If a rule with the same ID already exists, it is
   * replaced.
   */
  addRule(rule: Rule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * Remove a rule by ID.
   * @returns true if the rule existed and was removed.
   */
  removeRule(id: string): boolean {
    return this.rules.delete(id);
  }

  /**
   * Register custom patterns from config as rules. Each custom pattern becomes
   * a rule with a regex-based detector.
   */
  addCustomPatterns(patterns: CustomPattern[]): void {
    for (const pattern of patterns) {
      const ruleId = `custom_${pattern.name.replace(/\s+/g, "_").toLowerCase()}`;
      let regex: RegExp;
      try {
        regex = new RegExp(pattern.pattern, "gi");
      } catch {
        // Skip invalid regex — validation should have caught this
        continue;
      }

      this.rules.set(ruleId, {
        id: ruleId,
        name: pattern.name,
        description: pattern.message,
        defaultSeverity: pattern.severity,
        detect: (sql: string, file: string) =>
          findAllMatches(sql, file, regex, ruleId, pattern.message, pattern.severity),
      });
    }
  }

  /**
   * Run all enabled rules against a SQL string and return the issues found.
   *
   * @param sql     The SQL content to analyze.
   * @param file    The file path (for issue reporting).
   * @param config  The resolved config — controls which rules are enabled and
   *                their severity overrides.
   * @returns Array of issues found, sorted by line number.
   */
  analyze(sql: string, file: string, config: AltimateConfig): SQLIssue[] {
    const issues: SQLIssue[] = [];
    const ruleConfigs = config.sql_review.rules as Record<string, RuleConfig>;
    const threshold = config.sql_review.severity_threshold;
    const thresholdWeight = SEVERITY_WEIGHT[threshold];

    for (const rule of this.rules.values()) {
      // Check if this rule is enabled in config
      const ruleConfig = ruleConfigs[rule.id as keyof typeof ruleConfigs];
      if (ruleConfig && !ruleConfig.enabled) continue;

      // Determine effective severity
      const severity = ruleConfig?.severity ?? rule.defaultSeverity;

      // Skip if below threshold
      if (SEVERITY_WEIGHT[severity] < thresholdWeight) continue;

      try {
        const detected = rule.detect(sql, file);
        // Apply severity override
        for (const issue of detected) {
          issue.severity = severity;
          issues.push(issue);
        }
      } catch (err) {
        // Individual rule failure should not break the whole analysis
        issues.push({
          file,
          message: `Rule '${rule.id}' threw an error: ${err instanceof Error ? err.message : String(err)}`,
          severity: Severity.Info,
          rule: rule.id,
        });
      }
    }

    // Sort by line number, then severity (most severe first)
    issues.sort((a, b) => {
      const lineDiff = (a.line ?? 0) - (b.line ?? 0);
      if (lineDiff !== 0) return lineDiff;
      return SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
    });

    return issues;
  }
}

/**
 * Create a RuleRegistry configured from an AltimateConfig. Registers built-in
 * rules and any custom patterns from the config.
 */
export function createRegistry(config: AltimateConfig): RuleRegistry {
  const registry = new RuleRegistry();
  if (config.sql_review.custom_patterns.length > 0) {
    registry.addCustomPatterns(config.sql_review.custom_patterns);
  }
  return registry;
}
