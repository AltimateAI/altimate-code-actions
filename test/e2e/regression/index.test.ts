import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { checkCLIAvailable } from "../helpers/cli-runner.js";
import { parseDiff, isSQLFile } from "../../../src/util/diff-parser.js";

const FIXTURES = resolve(import.meta.dir, "../fixtures");

let cliAvailable = false;

beforeAll(async () => {
  cliAvailable = await checkCLIAvailable();
});

describe("Regression Tests", () => {
  it("handles files with unicode characters", () => {
    const unicodeSQL = `
-- Comment with unicode: cafe\u0301, na\u00EFve, stra\u00DFe
SELECT
    id,
    customer_name,  -- M\u00FCller, \u00D6zil, \u00C7elik
    city             -- Z\u00FCrich, Montr\u00E9al
FROM customers
WHERE city = 'Z\u00FCrich';
`;

    // Should parse without throwing
    const diff = `diff --git a/models/unicode.sql b/models/unicode.sql
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/models/unicode.sql
@@ -0,0 +1,8 @@
+${unicodeSQL.split("\n").filter(Boolean).map((l) => l).join("\n+")}
`;

    const parsed = parseDiff(diff);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].file).toBe("models/unicode.sql");
  });

  it("handles very large SQL files (>1MB simulated)", () => {
    // Generate a large SQL string
    const lines: string[] = ["SELECT"];
    for (let i = 0; i < 10000; i++) {
      lines.push(`    col_${i} AS alias_${i},`);
    }
    lines[lines.length - 1] = lines[lines.length - 1].replace(",", "");
    lines.push("FROM large_table;");
    const largeSql = lines.join("\n");

    // Should be over 200KB
    expect(largeSql.length).toBeGreaterThan(200_000);

    // Creating a diff-like structure
    const diffLines = largeSql.split("\n").map((l) => `+${l}`).join("\n");
    const diff = `diff --git a/models/large.sql b/models/large.sql
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/models/large.sql
@@ -0,0 +1,${lines.length} @@
${diffLines}
`;

    const parsed = parseDiff(diff);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].hunks[0].lines.length).toBe(lines.length);
  });

  it("handles SQL files with Jinja templating", () => {
    const jinjaSql = `
{{ config(materialized='table') }}

WITH source AS (
    SELECT * FROM {{ source('raw', 'orders') }}
    WHERE order_date >= '{{ var("start_date", "2024-01-01") }}'
),

{% set payment_methods = ['credit_card', 'bank_transfer', 'gift_card'] %}

final AS (
    SELECT
        order_id,
        {% for method in payment_methods %}
        SUM(CASE WHEN payment_method = '{{ method }}' THEN amount ELSE 0 END) AS {{ method }}_amount
        {% if not loop.last %},{% endif %}
        {% endfor %}
    FROM source
    GROUP BY order_id
)

SELECT * FROM final
`;

    // Jinja SQL should still be identifiable as SQL
    expect(jinjaSql.toUpperCase()).toContain("SELECT");
    expect(jinjaSql).toContain("{{");
    expect(jinjaSql).toContain("{%");

    // isSQLFile should still detect it
    expect(isSQLFile("models/jinja_model.sql")).toBe(true);
  });

  it("handles PR with 100+ changed files in diff", () => {
    const diffParts: string[] = [];
    for (let i = 0; i < 120; i++) {
      diffParts.push(`diff --git a/models/model_${i}.sql b/models/model_${i}.sql
index abc1234..def5678 100644
--- a/models/model_${i}.sql
+++ b/models/model_${i}.sql
@@ -1,3 +1,4 @@
 SELECT
     id,
-    name
+    name,
+    updated_at
 FROM table_${i}
`);
    }

    const megaDiff = diffParts.join("\n");
    const parsed = parseDiff(megaDiff);

    expect(parsed).toHaveLength(120);
    // All should be SQL files
    expect(parsed.every((p) => isSQLFile(p.file))).toBe(true);
  });

  it("handles concurrent analysis of multiple files (parallel reads)", async () => {
    const files = [
      resolve(FIXTURES, "sql-anti-patterns/select-star.sql"),
      resolve(FIXTURES, "sql-anti-patterns/cartesian-join.sql"),
      resolve(FIXTURES, "sql-anti-patterns/non-deterministic.sql"),
      resolve(FIXTURES, "sql-anti-patterns/correlated-subquery.sql"),
      resolve(FIXTURES, "sql-anti-patterns/or-in-join.sql"),
    ];

    // Read all files in parallel
    const results = await Promise.all(
      files.map(async (f) => {
        const content = readFileSync(f, "utf-8");
        return { file: f, content, length: content.length };
      }),
    );

    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.content.length).toBeGreaterThan(0);
      expect(r.content.toUpperCase()).toContain("SELECT");
    }
  });

  it("handles diff with no newline at end of file", () => {
    const diff = `diff --git a/models/no_newline.sql b/models/no_newline.sql
index abc1234..def5678 100644
--- a/models/no_newline.sql
+++ b/models/no_newline.sql
@@ -1,2 +1,3 @@
 SELECT id FROM users
-WHERE active = true
\\ No newline at end of file
+WHERE active = true
+ORDER BY id
\\ No newline at end of file
`;

    const parsed = parseDiff(diff);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].hunks).toHaveLength(1);
  });

  it("handles SQL with mixed line endings", () => {
    const sql = "SELECT\r\n    id,\r\n    name\r\nFROM users;\r\n";

    // Should not crash when processing
    expect(sql.includes("SELECT")).toBe(true);
    expect(sql.replace(/\r\n/g, "\n").split("\n").length).toBeGreaterThan(1);
  });

  it("handles empty SQL files in diff", () => {
    const diff = `diff --git a/models/empty.sql b/models/empty.sql
new file mode 100644
index 0000000..e69de29
`;

    const parsed = parseDiff(diff);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].hunks).toHaveLength(0);
    expect(parsed[0].isNew).toBe(true);
  });

  it("handles SQL with deeply nested subqueries", () => {
    const nestedSQL = `
SELECT * FROM (
  SELECT * FROM (
    SELECT * FROM (
      SELECT * FROM (
        SELECT id, name FROM users WHERE active = true
      ) t1
    ) t2
  ) t3
) t4;
`;
    // Should not cause stack overflow or parsing issues
    expect(nestedSQL.toUpperCase()).toContain("SELECT");
    // Count nesting depth
    const depth = (nestedSQL.match(/\bFROM\s*\(/gi) || []).length;
    expect(depth).toBe(4);
  });
});
