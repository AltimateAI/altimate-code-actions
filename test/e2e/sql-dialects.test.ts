import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURES = resolve(import.meta.dir, "fixtures/sql-dialects");

/** Read a dialect fixture file. */
function loadDialectSQL(dialect: string, filename: string): string {
  const path = resolve(FIXTURES, dialect, filename);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}`);
  }
  return readFileSync(path, "utf-8");
}

/** Map of dialect to their fixture file and expected dialect-specific features. */
const DIALECT_FIXTURES: Record<
  string,
  {
    file: string;
    /** Keywords or syntax unique to this dialect. */
    markers: string[];
    /** Anti-patterns that should still be detectable. */
    expectedKeywords: string[];
  }
> = {
  snowflake: {
    file: "flatten-query.sql",
    markers: ["FLATTEN", "VARIANT", "IFF", "DATEADD"],
    expectedKeywords: ["SELECT", "FROM", "WHERE"],
  },
  bigquery: {
    file: "unnest-query.sql",
    markers: ["UNNEST", "SAFE_DIVIDE", "FORMAT_TIMESTAMP"],
    expectedKeywords: ["SELECT", "FROM", "WHERE"],
  },
  postgres: {
    file: "array-query.sql",
    markers: ["generate_series", "array_agg", "JSONB", "->>'"],
    expectedKeywords: ["SELECT", "FROM", "GROUP BY"],
  },
  redshift: {
    file: "distkey-query.sql",
    markers: ["APPROXIMATE", "LISTAGG", "GETDATE"],
    expectedKeywords: ["SELECT", "FROM", "GROUP BY"],
  },
  databricks: {
    file: "delta-query.sql",
    markers: ["QUALIFY", "INTERVAL", "ROW_NUMBER"],
    expectedKeywords: ["SELECT", "FROM", "WHERE"],
  },
};

describe.each(Object.keys(DIALECT_FIXTURES))("SQL dialect: %s", (dialect) => {
  const config = DIALECT_FIXTURES[dialect];

  it("fixture file exists and is non-empty", () => {
    const path = resolve(FIXTURES, dialect, config.file);
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8");
    expect(content.trim().length).toBeGreaterThan(0);
  });

  it("parses dialect-specific SQL (contains valid SQL structure)", () => {
    const sql = loadDialectSQL(dialect, config.file);

    // All dialects should have basic SQL structure
    for (const keyword of config.expectedKeywords) {
      expect(sql.toUpperCase()).toContain(keyword.toUpperCase());
    }
  });

  it("contains dialect-specific syntax markers", () => {
    const sql = loadDialectSQL(dialect, config.file);

    const foundMarkers = config.markers.filter((marker) => sql.includes(marker));
    // At least one dialect-specific marker should be present
    expect(foundMarkers.length).toBeGreaterThan(0);
  });

  it("is syntactically distinct from other dialects", () => {
    const sql = loadDialectSQL(dialect, config.file);

    // Count how many markers from OTHER dialects appear in this file
    let foreignMarkerCount = 0;
    for (const [otherDialect, otherConfig] of Object.entries(DIALECT_FIXTURES)) {
      if (otherDialect === dialect) continue;
      for (const marker of otherConfig.markers) {
        if (sql.includes(marker)) foreignMarkerCount++;
      }
    }

    // The file should have more own markers than foreign markers
    const ownMarkerCount = config.markers.filter((m) => sql.includes(m)).length;
    expect(ownMarkerCount).toBeGreaterThanOrEqual(foreignMarkerCount);
  });

  it("does not contain syntax errors (balanced parentheses)", () => {
    const sql = loadDialectSQL(dialect, config.file);
    // Remove string literals before counting
    const cleaned = sql.replace(/'[^']*'/g, "");
    const opens = (cleaned.match(/\(/g) || []).length;
    const closes = (cleaned.match(/\)/g) || []).length;
    expect(opens).toBe(closes);
  });

  it("has a comment describing the dialect", () => {
    const sql = loadDialectSQL(dialect, config.file);
    // Should start with a comment mentioning the dialect
    expect(sql).toMatch(new RegExp(`--.*${dialect}`, "i"));
  });
});

describe("Cross-dialect analysis", () => {
  it("all dialect fixtures use SELECT statement", () => {
    for (const [dialect, config] of Object.entries(DIALECT_FIXTURES)) {
      const sql = loadDialectSQL(dialect, config.file);
      expect(sql.toUpperCase()).toContain("SELECT");
    }
  });

  it("all dialects have unique fixture files", () => {
    const contents = new Set<string>();
    for (const [dialect, config] of Object.entries(DIALECT_FIXTURES)) {
      const sql = loadDialectSQL(dialect, config.file);
      expect(contents.has(sql)).toBe(false);
      contents.add(sql);
    }
  });

  it("all 5 expected dialects have fixtures", () => {
    const expected = ["snowflake", "bigquery", "postgres", "redshift", "databricks"];
    for (const dialect of expected) {
      expect(existsSync(resolve(FIXTURES, dialect))).toBe(true);
    }
  });
});
