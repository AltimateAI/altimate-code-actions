import { describe, it, expect } from "bun:test";
import type {
  ReviewReport,
  SQLIssue,
} from "../../src/analysis/types.js";
import { Severity } from "../../src/analysis/types.js";
import { parseCheckOutput } from "../../src/analysis/cli-check.js";
import type { CheckOutput } from "../../src/analysis/cli-check.js";
import { buildCheckOptionsFromV2 } from "../../src/config/schema.js";
import type { AltimateConfigV2 } from "../../src/config/schema.js";
import {
  buildComment,
  buildIssuesSection,
} from "../../src/reporting/comment.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeV2Config(overrides?: Partial<AltimateConfigV2>): AltimateConfigV2 {
  return {
    version: 2,
    checks: {
      lint: { enabled: true },
      validate: { enabled: true },
      safety: { enabled: true },
      policy: { enabled: false },
      pii: { enabled: false },
      semantic: { enabled: false },
      grade: { enabled: false },
    },
    dialect: "auto",
    ...overrides,
  };
}

function makeCheckOutput(overrides?: Partial<CheckOutput>): CheckOutput {
  return {
    version: 1,
    files_checked: 3,
    checks_run: ["lint", "safety"],
    schema_resolved: false,
    results: {},
    summary: {
      total_findings: 0,
      errors: 0,
      warnings: 0,
      info: 0,
      pass: true,
    },
    ...overrides,
  };
}

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

// ---------------------------------------------------------------------------
// E2E tests: v2 check integration
// ---------------------------------------------------------------------------

describe("V2 check integration — end to end", () => {
  it("v2 config with lint enabled produces lint/ prefixed issues", () => {
    const v2Config = makeV2Config();
    const options = buildCheckOptionsFromV2(v2Config);
    expect(options.checks).toContain("lint");

    // Simulate CLI output
    const cliOutput = makeCheckOutput({
      checks_run: ["lint", "safety"],
      results: {
        lint: {
          findings: [
            {
              file: "models/stg_orders.sql",
              line: 5,
              code: "L001",
              severity: "warning",
              message: "SELECT * detected",
              suggestion: "List columns explicitly",
            },
            {
              file: "models/stg_orders.sql",
              line: 15,
              code: "L012",
              severity: "warning",
              message: "DELETE without WHERE clause",
              suggestion: "Add a WHERE clause",
            },
          ],
          warning_count: 2,
        },
        safety: {
          findings: [],
          safe: true,
        },
      },
    });

    const issues = parseCheckOutput(cliOutput);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.rule!.startsWith("lint/"))).toBe(true);
    expect(issues[0].rule).toBe("lint/L001");
    expect(issues[1].rule).toBe("lint/L012");
  });

  it("v2 config with all checks disabled produces no issues", () => {
    const v2Config = makeV2Config({
      checks: {
        lint: { enabled: false },
        validate: { enabled: false },
        safety: { enabled: false },
        policy: { enabled: false },
        pii: { enabled: false },
        semantic: { enabled: false },
        grade: { enabled: false },
      },
    });
    const options = buildCheckOptionsFromV2(v2Config);
    expect(options.checks).toEqual([]);
    // When no checks are enabled, no CLI invocation happens, so no issues
  });

  it("v2 config generates correct comment with category sections", () => {
    // Build issues from multiple categories
    const cliOutput = makeCheckOutput({
      checks_run: ["lint", "safety", "pii"],
      results: {
        lint: {
          findings: [
            { file: "a.sql", line: 1, code: "L001", severity: "warning", message: "SELECT * detected" },
            { file: "a.sql", line: 10, code: "L002", severity: "error", message: "Cartesian join" },
          ],
        },
        safety: {
          findings: [
            { file: "b.sql", line: 5, rule: "injection", severity: "critical", message: "SQL injection risk" },
          ],
        },
        pii: {
          findings: [
            { file: "c.sql", line: 3, rule: "email", severity: "warning", message: "PII: email column" },
          ],
        },
      },
    });

    const issues = parseCheckOutput(cliOutput);
    const report = makeReport({
      issues,
      issuesFound: issues.length,
      filesAnalyzed: 3,
    });

    const comment = buildComment(report);
    expect(comment).not.toBeNull();

    // Should contain category subsection headers since there are multiple categories
    expect(comment!).toContain("Lint");
    expect(comment!).toContain("Safety");
    expect(comment!).toContain("PII");
  });

  it("comment groups issues by prefix (Lint, Safety, PII)", () => {
    const issues: SQLIssue[] = [
      { file: "a.sql", line: 1, message: "SELECT *", severity: Severity.Warning, rule: "lint/L001" },
      { file: "a.sql", line: 10, message: "Cartesian", severity: Severity.Error, rule: "lint/L002" },
      { file: "b.sql", line: 5, message: "Injection", severity: Severity.Critical, rule: "safety/injection" },
      { file: "c.sql", line: 3, message: "Email PII", severity: Severity.Warning, rule: "pii/email" },
    ];

    const section = buildIssuesSection(issues);

    // Should have subsection headers for each category
    expect(section).toContain("#### Lint");
    expect(section).toContain("#### Safety");
    expect(section).toContain("#### PII");
  });

  it("comment renders category subsection headers only when multiple categories", () => {
    // Single category — no subsection headers
    const singleCategory: SQLIssue[] = [
      { file: "a.sql", line: 1, message: "SELECT *", severity: Severity.Warning, rule: "lint/L001" },
      { file: "a.sql", line: 10, message: "Cartesian", severity: Severity.Error, rule: "lint/L002" },
    ];

    const section = buildIssuesSection(singleCategory);
    expect(section).not.toContain("#### Lint");

    // Multiple categories — subsection headers appear
    const multiCategory: SQLIssue[] = [
      ...singleCategory,
      { file: "b.sql", line: 5, message: "Injection", severity: Severity.Critical, rule: "safety/injection" },
    ];

    const multiSection = buildIssuesSection(multiCategory);
    expect(multiSection).toContain("#### Lint");
    expect(multiSection).toContain("#### Safety");
  });

  it("issues without category prefix are grouped under SQL Quality", () => {
    // v1-style issues (no slash prefix)
    const issues: SQLIssue[] = [
      { file: "a.sql", line: 1, message: "SELECT *", severity: Severity.Warning, rule: "no-select-star" },
      { file: "b.sql", line: 5, message: "Injection", severity: Severity.Critical, rule: "safety/injection" },
    ];

    const section = buildIssuesSection(issues);
    expect(section).toContain("#### SQL Quality");
    expect(section).toContain("#### Safety");
  });

  it("full flow: v2 config -> buildCheckOptions -> parseOutput -> buildComment", () => {
    // Step 1: Build check options from v2 config
    const v2Config = makeV2Config({
      checks: {
        lint: { enabled: true },
        validate: { enabled: false },
        safety: { enabled: true },
        policy: { enabled: true, file: ".altimate-policy.yml" },
        pii: { enabled: true },
        semantic: { enabled: false },
        grade: { enabled: false },
      },
      dialect: "snowflake",
    });

    const options = buildCheckOptionsFromV2(v2Config);
    expect(options.checks).toEqual(["lint", "safety", "policy", "pii"]);
    expect(options.dialect).toBe("snowflake");
    expect(options.policyPath).toBe(".altimate-policy.yml");

    // Step 2: Simulate CLI JSON output
    const cliOutput = makeCheckOutput({
      checks_run: options.checks,
      results: {
        lint: {
          findings: [
            { file: "models/fct_orders.sql", line: 3, code: "L001", severity: "warning", message: "SELECT * detected" },
          ],
        },
        safety: {
          findings: [],
          safe: true,
        },
        policy: {
          findings: [
            { file: "models/fct_orders.sql", line: 1, rule: "no_drop", severity: "critical", message: "DROP not allowed" },
          ],
          allowed: false,
        },
        pii: {
          findings: [
            { file: "models/dim_users.sql", line: 7, rule: "email", severity: "warning", message: "PII: email" },
          ],
        },
      },
    });

    // Step 3: Parse output
    const issues = parseCheckOutput(cliOutput);
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => i.rule)).toEqual([
      "lint/L001",
      "policy/no_drop",
      "pii/email",
    ]);

    // Step 4: Build comment
    const report = makeReport({
      issues,
      issuesFound: issues.length,
      filesAnalyzed: 2,
    });

    const comment = buildComment(report);
    expect(comment).not.toBeNull();
    expect(comment!).toContain("Altimate Code");
    expect(comment!).toContain("Lint");
    expect(comment!).toContain("Policy");
    expect(comment!).toContain("PII");
    expect(comment!).toContain("1 critical");
    expect(comment!).toContain("fct_orders.sql");
    expect(comment!).toContain("dim_users.sql");
  });

  it("mixed v1 and v2 issues render correctly in the same comment", () => {
    // This can happen if fallback to regex rules produced some issues
    // alongside CLI check issues
    const issues: SQLIssue[] = [
      // v2-style (category prefixed)
      { file: "a.sql", line: 1, message: "SELECT *", severity: Severity.Warning, rule: "lint/L001" },
      // v1-style (no category prefix)
      { file: "b.sql", line: 5, message: "Missing WHERE", severity: Severity.Warning, rule: "missing-where" },
    ];

    const report = makeReport({
      issues,
      issuesFound: issues.length,
      filesAnalyzed: 2,
    });

    const comment = buildComment(report);
    expect(comment).not.toBeNull();
    // Both should be represented — Lint section and SQL Quality (default) section
    expect(comment!).toContain("Lint");
    expect(comment!).toContain("SQL Quality");
  });

  it("comment with only lint issues does not have category subsections", () => {
    const issues: SQLIssue[] = [
      { file: "a.sql", line: 1, message: "SELECT *", severity: Severity.Warning, rule: "lint/L001" },
      { file: "a.sql", line: 10, message: "Cartesian", severity: Severity.Error, rule: "lint/L002" },
    ];

    const report = makeReport({
      issues,
      issuesFound: issues.length,
      filesAnalyzed: 1,
    });

    const comment = buildComment(report);
    expect(comment).not.toBeNull();
    // Single category — no #### subsections
    expect(comment!).not.toContain("#### Lint");
  });
});
