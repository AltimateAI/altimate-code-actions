import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { checkCLIAvailable, runCLI } from "./helpers/cli-runner.js";

const FIXTURES = resolve(import.meta.dir, "fixtures");
const DBT_VERSIONS_DIR = resolve(FIXTURES, "dbt-versions");
const JAFFLE_SHOP = resolve(FIXTURES, "jaffle-shop");

let cliAvailable = false;

beforeAll(async () => {
  cliAvailable = await checkCLIAvailable();
});

/** Read and parse a YAML file (minimal parser for dbt_project.yml). */
function parseProjectYml(path: string): Record<string, unknown> {
  const content = readFileSync(path, "utf-8");
  const result: Record<string, unknown> = {};

  for (const line of content.split("\n")) {
    const match = line.match(/^(\w[\w-]*)\s*:\s*['"]?([^'"#\n]+?)['"]?\s*$/);
    if (match) {
      result[match[1]] = match[2].trim();
    }
  }
  return result;
}

/** Recursively find all .sql files in a directory. */
function findSQLFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSQLFiles(fullPath));
    } else if (entry.name.endsWith(".sql")) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Check if a SQL file contains Jinja template tags (dbt-style). */
function containsJinja(content: string): boolean {
  return /\{\{.*\}\}|\{%.*%\}/s.test(content);
}

describe.each(["v1.7", "v1.8", "v1.9"])("dbt %s compatibility", (version) => {
  const versionDir = resolve(DBT_VERSIONS_DIR, version);
  const projectFile = resolve(versionDir, "dbt_project.yml");

  it("has a dbt_project.yml file", () => {
    expect(existsSync(projectFile)).toBe(true);
  });

  it("parses dbt_project.yml", () => {
    const config = parseProjectYml(projectFile);
    const versionNum = version.replace("v", "");

    expect(config.name).toBeDefined();
    expect(typeof config.name).toBe("string");
    expect(config["config-version"]).toBe("2");
    expect((config.name as string)).toContain(versionNum.replace(".", ""));
  });

  it("has model SQL files", () => {
    const modelsDir = resolve(versionDir, "models");
    const sqlFiles = findSQLFiles(modelsDir);

    expect(sqlFiles.length).toBeGreaterThan(0);
  });

  it("model SQL files contain valid SQL", () => {
    const modelsDir = resolve(versionDir, "models");
    const sqlFiles = findSQLFiles(modelsDir);

    for (const file of sqlFiles) {
      const content = readFileSync(file, "utf-8");
      expect(content.trim().length).toBeGreaterThan(0);
      // Should contain SELECT (all dbt models produce a SELECT)
      expect(content.toUpperCase()).toContain("SELECT");
    }
  });

  it("has staging and marts model directories", () => {
    expect(existsSync(resolve(versionDir, "models/staging"))).toBe(true);
    expect(existsSync(resolve(versionDir, "models/marts"))).toBe(true);
  });

  it("models use Jinja ref/source macros", () => {
    const sqlFiles = findSQLFiles(resolve(versionDir, "models"));
    const hasJinja = sqlFiles.some((f) =>
      containsJinja(readFileSync(f, "utf-8")),
    );

    expect(hasJinja).toBe(true);
  });
});

describe("dbt project detection (jaffle-shop)", () => {
  const projectFile = resolve(JAFFLE_SHOP, "dbt_project.yml");

  it("detects dbt project by dbt_project.yml", () => {
    expect(existsSync(projectFile)).toBe(true);
  });

  it("parses project name and version", () => {
    const config = parseProjectYml(projectFile);
    expect(config.name).toBe("jaffle_shop");
  });

  it("has model-paths configured", () => {
    const content = readFileSync(projectFile, "utf-8");
    expect(content).toContain("model-paths");
    expect(content).toContain("models");
  });

  it("contains staging and marts models", () => {
    const stagingFiles = findSQLFiles(resolve(JAFFLE_SHOP, "models/staging"));
    const martsFiles = findSQLFiles(resolve(JAFFLE_SHOP, "models/marts"));

    expect(stagingFiles.length).toBeGreaterThan(0);
    expect(martsFiles.length).toBeGreaterThan(0);
  });

  it("models contain dbt Jinja refs", () => {
    const allModels = findSQLFiles(resolve(JAFFLE_SHOP, "models"));
    const modelsWithRefs = allModels.filter((f) => {
      const content = readFileSync(f, "utf-8");
      return /\{\{\s*ref\s*\(/.test(content) || /\{\{\s*source\s*\(/.test(content);
    });

    expect(modelsWithRefs.length).toBeGreaterThan(0);
  });

  it("has YAML schema files for documentation", () => {
    const modelsDir = resolve(JAFFLE_SHOP, "models");
    const yamlFiles: string[] = [];

    function findYAML(dir: string): void {
      if (!existsSync(dir)) return;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) findYAML(fullPath);
        else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
          yamlFiles.push(fullPath);
        }
      }
    }
    findYAML(modelsDir);

    expect(yamlFiles.length).toBeGreaterThan(0);
  });
});
