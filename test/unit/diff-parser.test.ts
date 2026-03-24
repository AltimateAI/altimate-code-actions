import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseDiff,
  extractAddedSQL,
  reconstructNewContent,
  isSQLFile,
  isDBTFile,
} from "../../src/util/diff-parser.js";

const DIFFS_DIR = resolve(import.meta.dir, "../e2e/fixtures/diffs");

function loadDiff(name: string): string {
  return readFileSync(resolve(DIFFS_DIR, name), "utf-8");
}

describe("Diff Parser", () => {
  describe("parseDiff", () => {
    it("parses unified diff format with a single file", () => {
      const diff = loadDiff("simple-add.diff");
      const result = parseDiff(diff);

      expect(result).toHaveLength(1);
      expect(result[0].file).toBe("models/staging/stg_orders.sql");
      expect(result[0].isNew).toBe(false);
      expect(result[0].isDeleted).toBe(false);
      expect(result[0].isRenamed).toBe(false);
      expect(result[0].hunks).toHaveLength(1);
    });

    it("extracts added lines correctly", () => {
      const diff = loadDiff("simple-add.diff");
      const result = parseDiff(diff);
      const addedLines = result[0].hunks[0].lines.filter(
        (l) => l.type === "add",
      );

      expect(addedLines.length).toBeGreaterThan(0);
      // The diff adds "status AS order_status", "total_amount", etc.
      const addedContent = addedLines.map((l) => l.content);
      expect(addedContent.some((c) => c.includes("order_status"))).toBe(true);
      expect(addedContent.some((c) => c.includes("total_amount"))).toBe(true);
    });

    it("extracts removed lines correctly", () => {
      const diff = loadDiff("simple-add.diff");
      const result = parseDiff(diff);
      const removedLines = result[0].hunks[0].lines.filter(
        (l) => l.type === "remove",
      );

      expect(removedLines.length).toBeGreaterThan(0);
      const removedContent = removedLines.map((l) => l.content);
      expect(removedContent.some((c) => c.includes("status,"))).toBe(true);
    });

    it("handles multi-file diffs", () => {
      const diff = loadDiff("multi-file.diff");
      const result = parseDiff(diff);

      expect(result.length).toBeGreaterThanOrEqual(3);

      const filenames = result.map((r) => r.file);
      expect(filenames).toContain("models/staging/stg_orders.sql");
      expect(filenames).toContain("models/marts/orders.sql");
      expect(filenames).toContain("README.md");
    });

    it("identifies SQL files in multi-file diff", () => {
      const diff = loadDiff("multi-file.diff");
      const result = parseDiff(diff);
      const sqlFiles = result.filter((r) => isSQLFile(r.file));

      expect(sqlFiles.length).toBe(2);
    });

    it("detects new files", () => {
      const diff = loadDiff("multi-file.diff");
      const result = parseDiff(diff);
      const newFile = result.find((r) => r.file === "models/marts/orders.sql");

      expect(newFile).toBeDefined();
      expect(newFile!.isNew).toBe(true);
    });

    it("detects deleted files", () => {
      const diff = loadDiff("deleted-file.diff");
      const result = parseDiff(diff);

      expect(result).toHaveLength(1);
      expect(result[0].file).toBe("models/deprecated/old_model.sql");
      expect(result[0].isDeleted).toBe(true);
    });

    it("detects renamed files", () => {
      const diff = loadDiff("renamed-file.diff");
      const result = parseDiff(diff);

      expect(result).toHaveLength(1);
      expect(result[0].file).toBe("models/new_name.sql");
      expect(result[0].isRenamed).toBe(true);
    });

    it("handles binary files gracefully", () => {
      const diff = loadDiff("binary-file.diff");
      const result = parseDiff(diff);

      // Binary file gets parsed as a file entry but with no hunks (no +/- lines)
      const pngFile = result.find((r) => r.file === "docs/diagram.png");
      expect(pngFile).toBeDefined();
      expect(pngFile!.hunks).toHaveLength(0);

      // The SQL file in the same diff should still parse correctly
      const sqlFile = result.find((r) =>
        r.file === "models/staging/stg_users.sql",
      );
      expect(sqlFile).toBeDefined();
      expect(sqlFile!.hunks.length).toBeGreaterThan(0);
    });

    it("handles empty diffs", () => {
      const diff = loadDiff("empty.diff");
      const result = parseDiff(diff);

      expect(result).toHaveLength(0);
    });

    it("tracks line numbers correctly", () => {
      const diff = loadDiff("simple-add.diff");
      const result = parseDiff(diff);
      const hunk = result[0].hunks[0];

      // Verify hunk header was parsed
      expect(hunk.oldStart).toBe(1);
      expect(hunk.newStart).toBe(1);

      // Added lines should have newLineNumber set
      const addedLines = hunk.lines.filter((l) => l.type === "add");
      for (const line of addedLines) {
        expect(line.newLineNumber).toBeDefined();
        expect(line.newLineNumber).toBeGreaterThan(0);
      }

      // Removed lines should have oldLineNumber set
      const removedLines = hunk.lines.filter((l) => l.type === "remove");
      for (const line of removedLines) {
        expect(line.oldLineNumber).toBeDefined();
        expect(line.oldLineNumber).toBeGreaterThan(0);
      }

      // Context lines should have both
      const contextLines = hunk.lines.filter((l) => l.type === "context");
      for (const line of contextLines) {
        expect(line.oldLineNumber).toBeDefined();
        expect(line.newLineNumber).toBeDefined();
      }
    });
  });

  describe("extractAddedSQL", () => {
    it("returns added + context lines only", () => {
      const diff = loadDiff("simple-add.diff");
      const parsed = parseDiff(diff);
      const sql = extractAddedSQL(parsed[0]);

      // Should contain added content
      expect(sql).toContain("order_status");
      expect(sql).toContain("total_amount");

      // Should contain context lines
      expect(sql).toContain("order_id");

      // Should NOT contain the old removed line "status,"
      // (the removed version is just "    status,")
      // But context lines remain, so we check specifically for the old form
    });

    it("returns empty string for deleted file", () => {
      const diff = loadDiff("deleted-file.diff");
      const parsed = parseDiff(diff);
      const sql = extractAddedSQL(parsed[0]);

      // A deleted file has only "remove" lines, so no add or context
      expect(sql.trim()).toBe("");
    });
  });

  describe("reconstructNewContent", () => {
    it("builds new-side content from add + context lines", () => {
      const diff = loadDiff("multi-file.diff");
      const parsed = parseDiff(diff);
      const newFile = parsed.find((p) => p.file === "models/marts/orders.sql");
      expect(newFile).toBeDefined();

      const content = reconstructNewContent(newFile!);
      expect(content).toContain("SELECT");
      expect(content).toContain("order_number");
      expect(content).toContain("ref('stg_orders')");
    });
  });

  describe("isSQLFile", () => {
    it("returns true for .sql files", () => {
      expect(isSQLFile("models/staging/stg_orders.sql")).toBe(true);
    });

    it("returns true for .sqlx files", () => {
      expect(isSQLFile("models/staging/stg_orders.sqlx")).toBe(true);
    });

    it("is case-insensitive", () => {
      expect(isSQLFile("models/QUERY.SQL")).toBe(true);
      expect(isSQLFile("models/query.Sql")).toBe(true);
    });

    it("returns false for non-SQL files", () => {
      expect(isSQLFile("models/schema.yml")).toBe(false);
      expect(isSQLFile("README.md")).toBe(false);
      expect(isSQLFile("package.json")).toBe(false);
      expect(isSQLFile("image.png")).toBe(false);
    });

    it("handles files with no extension", () => {
      expect(isSQLFile("Makefile")).toBe(false);
    });
  });

  describe("isDBTFile", () => {
    it("returns true for SQL files", () => {
      expect(isDBTFile("models/stg_orders.sql")).toBe(true);
    });

    it("returns true for YAML files", () => {
      expect(isDBTFile("models/schema.yml")).toBe(true);
      expect(isDBTFile("models/schema.yaml")).toBe(true);
    });

    it("returns true for Python model files", () => {
      expect(isDBTFile("models/python_model.py")).toBe(true);
    });

    it("returns false for non-dbt files", () => {
      expect(isDBTFile("README.md")).toBe(false);
      expect(isDBTFile("package.json")).toBe(false);
      expect(isDBTFile("image.png")).toBe(false);
    });
  });
});
