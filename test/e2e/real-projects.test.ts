import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const FIXTURES = resolve(import.meta.dir, "fixtures");
const JAFFLE_SHOP = resolve(FIXTURES, "jaffle-shop");
const JAFFLE_CLASSIC = resolve(FIXTURES, "jaffle-shop-classic");
const MRR_PLAYBOOK = resolve(FIXTURES, "mrr-playbook");

/** Recursively find files matching an extension. */
function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
      results.push(...findFiles(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Check if SQL contains common Jinja template patterns. */
function hasJinjaTemplates(sql: string): boolean {
  return /\{\{.*\}\}|\{%.*%\}/s.test(sql);
}

/** Check if SQL contains CTE patterns. */
function hasCTEs(sql: string): boolean {
  return /\bWITH\b\s+\w+\s+AS\s*\(/i.test(sql);
}

/** Check if SQL contains window functions. */
function hasWindowFunctions(sql: string): boolean {
  return /\b(ROW_NUMBER|RANK|DENSE_RANK|LAG|LEAD|SUM|COUNT|AVG|MIN|MAX)\s*\([^)]*\)\s*OVER\s*\(/i.test(sql);
}

describe("Real Project Analysis", () => {
  describe("jaffle-shop", () => {
    it("has a valid dbt_project.yml", () => {
      const path = resolve(JAFFLE_SHOP, "dbt_project.yml");
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("jaffle_shop");
      expect(content).toContain("model-paths");
    });

    it("analyzes all models without read errors", () => {
      const sqlFiles = findFiles(resolve(JAFFLE_SHOP, "models"), ".sql");
      expect(sqlFiles.length).toBeGreaterThan(0);

      const errors: string[] = [];
      for (const file of sqlFiles) {
        try {
          const content = readFileSync(file, "utf-8");
          expect(content.trim().length).toBeGreaterThan(0);
          // Should contain SELECT (all dbt models produce output)
          expect(content.toUpperCase()).toContain("SELECT");
        } catch (e) {
          errors.push(`${file}: ${e}`);
        }
      }
      expect(errors).toHaveLength(0);
    });

    it("detects dbt project structure (staging + marts)", () => {
      const stagingDir = resolve(JAFFLE_SHOP, "models/staging");
      const martsDir = resolve(JAFFLE_SHOP, "models/marts");

      expect(existsSync(stagingDir)).toBe(true);
      expect(existsSync(martsDir)).toBe(true);

      const stagingFiles = findFiles(stagingDir, ".sql");
      const martsFiles = findFiles(martsDir, ".sql");

      expect(stagingFiles.length).toBeGreaterThan(0);
      expect(martsFiles.length).toBeGreaterThan(0);
    });

    it("staging models use source() macro", () => {
      const stagingFiles = findFiles(
        resolve(JAFFLE_SHOP, "models/staging"),
        ".sql",
      );

      const filesWithSource = stagingFiles.filter((f) => {
        const content = readFileSync(f, "utf-8");
        return /\{\{\s*source\s*\(/.test(content);
      });

      expect(filesWithSource.length).toBeGreaterThan(0);
    });

    it("marts models use ref() macro", () => {
      const martsFiles = findFiles(
        resolve(JAFFLE_SHOP, "models/marts"),
        ".sql",
      );

      const filesWithRef = martsFiles.filter((f) => {
        const content = readFileSync(f, "utf-8");
        return /\{\{\s*ref\s*\(/.test(content);
      });

      expect(filesWithRef.length).toBeGreaterThan(0);
    });

    it("has schema YAML files for model documentation", () => {
      const ymlFiles = findFiles(resolve(JAFFLE_SHOP, "models"), ".yml");
      expect(ymlFiles.length).toBeGreaterThan(0);

      // At least one YAML should contain model definitions
      const hasModels = ymlFiles.some((f) => {
        const content = readFileSync(f, "utf-8");
        return content.includes("models:") || content.includes("sources:");
      });
      expect(hasModels).toBe(true);
    });

    it("has seed data files", () => {
      const seedsDir = resolve(JAFFLE_SHOP, "seeds");
      expect(existsSync(seedsDir)).toBe(true);
    });

    it("models contain Jinja templating", () => {
      const sqlFiles = findFiles(resolve(JAFFLE_SHOP, "models"), ".sql");
      const jinjaFiles = sqlFiles.filter((f) =>
        hasJinjaTemplates(readFileSync(f, "utf-8")),
      );
      // Most dbt models should have Jinja
      expect(jinjaFiles.length).toBeGreaterThan(sqlFiles.length / 2);
    });
  });

  describe("jaffle-shop-classic", () => {
    const classicExists = existsSync(JAFFLE_CLASSIC);

    it.skipIf(!classicExists)("has models directory", () => {
      const modelsDir = resolve(JAFFLE_CLASSIC, "models");
      expect(existsSync(modelsDir)).toBe(true);
    });

    it.skipIf(!classicExists)("all SQL models are readable", () => {
      const sqlFiles = findFiles(resolve(JAFFLE_CLASSIC, "models"), ".sql");
      for (const file of sqlFiles) {
        const content = readFileSync(file, "utf-8");
        expect(content.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("mrr-playbook", () => {
    it("has a valid dbt_project.yml", () => {
      const path = resolve(MRR_PLAYBOOK, "dbt_project.yml");
      expect(existsSync(path)).toBe(true);
    });

    it("handles complex window functions", () => {
      const mrrSql = readFileSync(
        resolve(MRR_PLAYBOOK, "models/mrr.sql"),
        "utf-8",
      );

      expect(hasWindowFunctions(mrrSql)).toBe(true);
      // Specifically uses LAG for previous month MRR
      expect(mrrSql).toMatch(/\blag\b/i);
    });

    it("detects CTE patterns", () => {
      const mrrSql = readFileSync(
        resolve(MRR_PLAYBOOK, "models/mrr.sql"),
        "utf-8",
      );

      expect(hasCTEs(mrrSql)).toBe(true);
    });

    it("uses dbt_utils macros", () => {
      const mrrSql = readFileSync(
        resolve(MRR_PLAYBOOK, "models/mrr.sql"),
        "utf-8",
      );

      expect(mrrSql).toContain("dbt_utils");
    });

    it("contains ref() macros linking models", () => {
      const sqlFiles = findFiles(resolve(MRR_PLAYBOOK, "models"), ".sql");
      const filesWithRef = sqlFiles.filter((f) =>
        /\{\{\s*ref\s*\(/.test(readFileSync(f, "utf-8")),
      );

      expect(filesWithRef.length).toBeGreaterThan(0);
    });

    it("has CASE/WHEN logic for MRR categorization", () => {
      const mrrSql = readFileSync(
        resolve(MRR_PLAYBOOK, "models/mrr.sql"),
        "utf-8",
      );

      expect(mrrSql.toUpperCase()).toContain("CASE");
      expect(mrrSql.toUpperCase()).toContain("WHEN");
      // Should categorize as new, churn, reactivation, etc.
      expect(mrrSql).toContain("new");
      expect(mrrSql).toContain("churn");
    });

    it("all models are valid SQL or Jinja", () => {
      const sqlFiles = findFiles(resolve(MRR_PLAYBOOK, "models"), ".sql");

      for (const file of sqlFiles) {
        const content = readFileSync(file, "utf-8");
        expect(content.trim().length).toBeGreaterThan(0);
        // Models should contain SQL or Jinja macros
        const hasSQL = content.toUpperCase().includes("SELECT");
        const hasJinja = hasJinjaTemplates(content);
        expect(hasSQL || hasJinja).toBe(true);
      }
    });
  });
});
