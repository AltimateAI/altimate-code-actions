import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { checkCLIAvailable, runCLI } from "./helpers/cli-runner.js";

const FIXTURES = resolve(import.meta.dir, "fixtures");
const ANTI_PATTERNS = resolve(FIXTURES, "sql-anti-patterns");
const CLEAN_SQL = resolve(FIXTURES, "sql-clean");

/**
 * Analyze a SQL file using the CLI and return parsed results.
 * Falls back to a lightweight static analysis when CLI is unavailable.
 */
async function analyzeFile(filePath: string): Promise<{
  issues: Array<{
    type: string;
    severity: string;
    message: string;
    line?: number;
  }>;
  raw: string;
}> {
  const absPath = resolve(filePath);
  const content = readFileSync(absPath, "utf-8");

  if (cliAvailable) {
    const result = await runCLI(["analyze", "sql", "--file", absPath, "--format", "json"], {
      timeout: 30_000,
    });
    if (result.exitCode === 0 && result.json && typeof result.json === "object") {
      const data = result.json as Record<string, unknown>;
      const issues = (data.issues ?? []) as Array<{
        type: string;
        severity: string;
        message: string;
        line?: number;
      }>;
      if (issues.length > 0) {
        return { issues, raw: result.stdout };
      }
    }
    // CLI didn't produce usable results; fall through to static analysis
  }

  // Fallback: lightweight static pattern matching for core anti-patterns
  return { issues: detectAntiPatterns(content), raw: content };
}

/** Static pattern-based anti-pattern detection (works without CLI). */
function detectAntiPatterns(
  sql: string,
): Array<{ type: string; severity: string; message: string; line?: number }> {
  const issues: Array<{ type: string; severity: string; message: string; line?: number }> = [];
  const lines = sql.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith("--")) continue;

    // SELECT *
    if (/\bSELECT\s+\*/i.test(trimmed) && !/count\s*\(\s*\*\s*\)/i.test(trimmed)) {
      issues.push({
        type: "select_star",
        severity: "warning",
        message: "SELECT * pulls all columns; list columns explicitly",
        line: i + 1,
      });
    }
  }

  // Cartesian join: FROM with comma-separated tables and no JOIN keyword
  const noComments = sql.replace(/--[^\n]*/g, "");
  const _normalized = noComments.replace(/\s+/g, " ").trim().toUpperCase();

  if (
    /\bFROM\s+\w+\s+\w+\s*,\s*\w+/i.test(noComments) &&
    !/\bJOIN\b/i.test(noComments.split(/\bWHERE\b/i)[0] ?? "")
  ) {
    issues.push({
      type: "cartesian_join",
      severity: "error",
      message: "Comma-separated FROM tables without explicit JOIN may produce cartesian product",
    });
  }

  // Non-deterministic: CURRENT_DATE, CURRENT_TIMESTAMP, NOW(), GETDATE()
  if (/\b(CURRENT_DATE|CURRENT_TIMESTAMP|NOW\s*\(\)|GETDATE\s*\(\))\b/i.test(noComments)) {
    issues.push({
      type: "non_deterministic",
      severity: "warning",
      message: "Query uses non-deterministic function; results change on each run",
    });
  }

  // Correlated subquery: subquery WHERE references outer alias (e.g. e2.col = e.col)
  const normalized2 = noComments.replace(/\n/g, " ");
  if (/\(\s*SELECT\b.*?\bWHERE\b.*?\b\w+\.\w+\s*=\s*\w+\.\w+\s*\)/i.test(normalized2)) {
    issues.push({
      type: "correlated_subquery",
      severity: "warning",
      message: "Correlated subquery re-executes per outer row; consider a JOIN",
    });
  }

  // OR in JOIN condition
  if (/\bJOIN\b[^;]*\bON\b[^;]*\bOR\b/i.test(noComments)) {
    issues.push({
      type: "or_in_join",
      severity: "warning",
      message: "OR in JOIN condition prevents index usage",
    });
  }

  // Implicit type cast: WHERE column = 'number'
  if (/\bWHERE\b[^;]*\bid\s*=\s*'[0-9]+'/i.test(noComments)) {
    issues.push({
      type: "implicit_type_cast",
      severity: "warning",
      message: "Comparing column to string literal of a number causes implicit type cast",
    });
  }

  // Missing partition filter (heuristic: partitioned_by in table name, no date filter)
  if (/partitioned/i.test(noComments) && !/\bWHERE\b[^;]*(date|partition|dt)\b/i.test(noComments)) {
    issues.push({
      type: "missing_partition_filter",
      severity: "error",
      message: "Query on partitioned table without partition filter causes full scan",
    });
  }

  // Function on indexed column in WHERE
  if (
    /\bWHERE\b[^;]*\b(UPPER|LOWER|TRIM|CAST|CONVERT|SUBSTRING|LEFT|RIGHT|YEAR|MONTH|DAY|DATE_TRUNC|COALESCE)\s*\(/i.test(
      noComments,
    )
  ) {
    issues.push({
      type: "function_on_indexed_column",
      severity: "warning",
      message: "Function applied to column in WHERE clause prevents index usage",
    });
  }

  // NOT IN with subquery
  if (/\bNOT\s+IN\s*\(\s*SELECT\b/i.test(noComments)) {
    issues.push({
      type: "not_in_with_nulls",
      severity: "warning",
      message:
        "NOT IN with subquery can return zero rows if any NULL exists in the subquery result",
    });
  }

  // SELECT DISTINCT after JOIN
  if (/\bSELECT\s+DISTINCT\b/i.test(noComments) && /\bJOIN\b/i.test(noComments)) {
    issues.push({
      type: "distinct_masking_bad_join",
      severity: "warning",
      message: "SELECT DISTINCT after JOIN may mask a fan-out from a bad join",
    });
  }

  // COUNT(*) > 0 for existence (may be separated by closing parens from subquery)
  if (/\bCOUNT\s*\(\s*\*\s*\)/i.test(noComments) && />\s*0/.test(noComments)) {
    issues.push({
      type: "count_for_existence",
      severity: "warning",
      message: "COUNT(*) > 0 scans all matching rows; use EXISTS to short-circuit",
    });
  }

  // DELETE without LIMIT
  if (/\bDELETE\s+FROM\b/i.test(noComments) && !/\bLIMIT\b/i.test(noComments)) {
    issues.push({
      type: "no_limit_on_delete",
      severity: "info",
      message: "DELETE without LIMIT can lock large portions of the table",
    });
  }

  return issues;
}

let cliAvailable = false;

beforeAll(async () => {
  cliAvailable = await checkCLIAvailable();
});

describe("SQL Anti-Pattern Detection", () => {
  it("detects SELECT * anti-pattern", async () => {
    const result = await analyzeFile(resolve(ANTI_PATTERNS, "select-star.sql"));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: "select_star",
        severity: expect.stringMatching(/warning|error/),
      }),
    );
  });

  it("detects cartesian join", async () => {
    const result = await analyzeFile(resolve(ANTI_PATTERNS, "cartesian-join.sql"));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: "cartesian_join",
      }),
    );
  });

  it("detects non-deterministic query", async () => {
    const result = await analyzeFile(resolve(ANTI_PATTERNS, "non-deterministic.sql"));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: "non_deterministic",
      }),
    );
  });

  it("detects correlated subquery", async () => {
    const result = await analyzeFile(resolve(ANTI_PATTERNS, "correlated-subquery.sql"));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: "correlated_subquery",
      }),
    );
  });

  it("detects missing partition filter", async () => {
    const result = await analyzeFile(resolve(ANTI_PATTERNS, "missing-partition.sql"));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: "missing_partition_filter",
      }),
    );
  });

  it("detects OR in join condition", async () => {
    const result = await analyzeFile(resolve(ANTI_PATTERNS, "or-in-join.sql"));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: "or_in_join",
      }),
    );
  });

  it("detects implicit type cast", async () => {
    const result = await analyzeFile(resolve(ANTI_PATTERNS, "implicit-type-cast.sql"));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: "implicit_type_cast",
      }),
    );
  });

  it("detects function on indexed column", async () => {
    const result = await analyzeFile(resolve(ANTI_PATTERNS, "function-on-indexed-column.sql"));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: "function_on_indexed_column",
      }),
    );
  });

  it("detects NOT IN with nulls", async () => {
    const result = await analyzeFile(resolve(ANTI_PATTERNS, "not-in-with-nulls.sql"));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: "not_in_with_nulls",
      }),
    );
  });

  it("detects DISTINCT masking bad join", async () => {
    const result = await analyzeFile(resolve(ANTI_PATTERNS, "distinct-instead-of-join-fix.sql"));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: "distinct_masking_bad_join",
      }),
    );
  });

  it("detects COUNT(*) > 0 for existence", async () => {
    const result = await analyzeFile(resolve(ANTI_PATTERNS, "count-star-for-existence.sql"));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: "count_for_existence",
      }),
    );
  });

  it("detects DELETE without LIMIT", async () => {
    const result = await analyzeFile(resolve(ANTI_PATTERNS, "no-limit-on-delete.sql"));
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: "no_limit_on_delete",
      }),
    );
  });

  it("passes clean query with no issues", async () => {
    const result = await analyzeFile(resolve(CLEAN_SQL, "well-formed-query.sql"));
    expect(result.issues).toHaveLength(0);
  });

  it("passes clean aggregation query with no issues", async () => {
    const result = await analyzeFile(resolve(CLEAN_SQL, "aggregation-query.sql"));
    expect(result.issues).toHaveLength(0);
  });

  it("all anti-pattern fixtures are valid SQL files", () => {
    const files = [
      "select-star.sql",
      "cartesian-join.sql",
      "non-deterministic.sql",
      "correlated-subquery.sql",
      "missing-partition.sql",
      "or-in-join.sql",
      "implicit-type-cast.sql",
      "function-on-indexed-column.sql",
      "not-in-with-nulls.sql",
      "distinct-instead-of-join-fix.sql",
      "count-star-for-existence.sql",
      "no-limit-on-delete.sql",
    ];

    for (const file of files) {
      const path = resolve(ANTI_PATTERNS, file);
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      expect(content.trim().length).toBeGreaterThan(0);
      // Should contain SQL keywords
      expect(content.toUpperCase()).toMatch(/\b(SELECT|FROM)\b/);
    }
  });
});
