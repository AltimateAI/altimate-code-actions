import { describe, it, expect } from "bun:test";
import { parseCheckOutput } from "../../src/analysis/cli-check.js";
import type { CheckOutput } from "../../src/analysis/cli-check.js";
import { Severity } from "../../src/analysis/types.js";

function makeCheckOutput(overrides?: Partial<CheckOutput>): CheckOutput {
  return {
    version: 1,
    files_checked: 2,
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

describe("parseCheckOutput", () => {
  it("returns empty array for output with no results", () => {
    const output = makeCheckOutput();
    expect(parseCheckOutput(output)).toEqual([]);
  });

  it("returns empty array for output with empty findings arrays", () => {
    const output = makeCheckOutput({
      results: {
        lint: { findings: [], error_count: 0, warning_count: 0 },
        safety: { findings: [], safe: true },
      },
    });
    expect(parseCheckOutput(output)).toEqual([]);
  });

  it("parses lint findings with code prefix", () => {
    const output = makeCheckOutput({
      results: {
        lint: {
          findings: [
            {
              file: "models/stg_orders.sql",
              line: 5,
              code: "L001",
              rule: "select_star",
              severity: "warning",
              message: "SELECT * detected",
              suggestion: "List columns explicitly",
            },
          ],
          error_count: 0,
          warning_count: 1,
        },
      },
    });

    const issues = parseCheckOutput(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].file).toBe("models/stg_orders.sql");
    expect(issues[0].line).toBe(5);
    expect(issues[0].rule).toBe("lint/L001");
    expect(issues[0].severity).toBe(Severity.Warning);
    expect(issues[0].message).toBe("SELECT * detected");
    expect(issues[0].suggestion).toBe("List columns explicitly");
  });

  it("parses safety findings with rule prefix", () => {
    const output = makeCheckOutput({
      results: {
        safety: {
          findings: [
            {
              file: "scripts/adhoc.sql",
              line: 12,
              rule: "injection",
              severity: "critical",
              message: "Possible SQL injection via string concatenation",
            },
          ],
          safe: false,
        },
      },
    });

    const issues = parseCheckOutput(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("safety/injection");
    expect(issues[0].severity).toBe(Severity.Critical);
    expect(issues[0].suggestion).toBeUndefined();
  });

  it("parses pii findings", () => {
    const output = makeCheckOutput({
      results: {
        pii: {
          findings: [
            {
              file: "models/dim_users.sql",
              line: 3,
              rule: "email",
              severity: "warning",
              message: "Column 'user_email' may contain PII (email)",
              suggestion: "Apply masking or hashing",
            },
          ],
          risk_level: "Medium",
        },
      },
    });

    const issues = parseCheckOutput(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("pii/email");
    expect(issues[0].severity).toBe(Severity.Warning);
  });

  it("handles findings without line numbers", () => {
    const output = makeCheckOutput({
      results: {
        validate: {
          findings: [
            {
              file: "models/broken.sql",
              severity: "error",
              message: "Parse error: unexpected token near 'SELEC'",
            },
          ],
          valid: false,
        },
      },
    });

    const issues = parseCheckOutput(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBeUndefined();
    expect(issues[0].rule).toBe("validate/unknown");
    expect(issues[0].severity).toBe(Severity.Error);
  });

  it("combines findings from multiple categories", () => {
    const output = makeCheckOutput({
      checks_run: ["lint", "safety", "pii"],
      results: {
        lint: {
          findings: [
            { file: "a.sql", line: 1, code: "L001", severity: "warning", message: "SELECT *" },
            { file: "a.sql", line: 10, code: "L003", severity: "info", message: "ORDER BY ordinal" },
          ],
          warning_count: 1,
        },
        safety: {
          findings: [
            { file: "b.sql", line: 5, rule: "injection", severity: "critical", message: "Injection risk" },
          ],
          safe: false,
        },
        pii: {
          findings: [],
          risk_level: "None",
        },
      },
    });

    const issues = parseCheckOutput(output);
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => i.rule)).toEqual(["lint/L001", "lint/L003", "safety/injection"]);
  });

  it("maps severity strings correctly", () => {
    const severityCases: Array<[string, Severity]> = [
      ["info", Severity.Info],
      ["warning", Severity.Warning],
      ["warn", Severity.Warning],
      ["error", Severity.Error],
      ["critical", Severity.Critical],
      ["fatal", Severity.Critical],
      ["UNKNOWN", Severity.Warning], // unmapped defaults to warning
    ];

    for (const [input, expected] of severityCases) {
      const output = makeCheckOutput({
        results: {
          lint: {
            findings: [{ file: "t.sql", severity: input, message: "test" }],
          },
        },
      });
      const issues = parseCheckOutput(output);
      expect(issues[0].severity).toBe(expected);
    }
  });

  it("handles malformed results gracefully", () => {
    // results with a category that has no findings array
    const output = makeCheckOutput({
      results: {
        lint: { findings: null as unknown as never[] },
        safety: {} as never,
      },
    });

    const issues = parseCheckOutput(output);
    expect(issues).toEqual([]);
  });

  it("prefers code over rule for the rule suffix", () => {
    const output = makeCheckOutput({
      results: {
        lint: {
          findings: [
            {
              file: "a.sql",
              code: "L001",
              rule: "select_star",
              severity: "warning",
              message: "test",
            },
          ],
        },
      },
    });

    const issues = parseCheckOutput(output);
    // code takes precedence over rule
    expect(issues[0].rule).toBe("lint/L001");
  });

  it("uses rule when code is absent", () => {
    const output = makeCheckOutput({
      results: {
        policy: {
          findings: [
            {
              file: "a.sql",
              rule: "no_drop_table",
              severity: "error",
              message: "DROP TABLE not allowed",
            },
          ],
          allowed: false,
        },
      },
    });

    const issues = parseCheckOutput(output);
    expect(issues[0].rule).toBe("policy/no_drop_table");
  });

  // -------------------------------------------------------------------
  // Additional edge-case tests
  // -------------------------------------------------------------------

  it("handles null results gracefully", () => {
    const output = makeCheckOutput({
      results: null as unknown as Record<string, never>,
    });
    expect(parseCheckOutput(output)).toEqual([]);
  });

  it("handles undefined results gracefully", () => {
    const output = makeCheckOutput({
      results: undefined as unknown as Record<string, never>,
    });
    expect(parseCheckOutput(output)).toEqual([]);
  });

  it("handles results with no findings key", () => {
    const output = makeCheckOutput({
      results: {
        lint: { error_count: 0, warning_count: 0 } as never,
        safety: { safe: true } as never,
      },
    });
    const issues = parseCheckOutput(output);
    expect(issues).toEqual([]);
  });

  it("handles findings with missing fields (no line, no code, no suggestion)", () => {
    const output = makeCheckOutput({
      results: {
        lint: {
          findings: [
            {
              file: "test.sql",
              severity: "warning",
              message: "Some issue found",
              // no line, no code, no rule, no suggestion
            },
          ],
        },
      },
    });

    const issues = parseCheckOutput(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBeUndefined();
    expect(issues[0].rule).toBe("lint/unknown");
    expect(issues[0].suggestion).toBeUndefined();
    expect(issues[0].message).toBe("Some issue found");
  });

  it("handles very large output (1000+ findings)", () => {
    const findings = Array.from({ length: 1500 }, (_, i) => ({
      file: `models/model_${i}.sql`,
      line: i + 1,
      code: `L${String(i % 26 + 1).padStart(3, "0")}`,
      severity: "warning",
      message: `Issue ${i}`,
    }));

    const output = makeCheckOutput({
      results: {
        lint: { findings },
      },
    });

    const issues = parseCheckOutput(output);
    expect(issues).toHaveLength(1500);
    expect(issues[0].file).toBe("models/model_0.sql");
    expect(issues[1499].file).toBe("models/model_1499.sql");
  });

  it("handles nested category results (multiple categories with findings)", () => {
    const output = makeCheckOutput({
      checks_run: ["lint", "safety", "validate", "policy", "pii", "semantic", "grade"],
      results: {
        lint: {
          findings: [
            { file: "a.sql", code: "L001", severity: "warning", message: "SELECT *" },
          ],
        },
        safety: {
          findings: [
            { file: "a.sql", rule: "injection", severity: "critical", message: "Injection" },
          ],
        },
        validate: {
          findings: [
            { file: "b.sql", severity: "error", message: "Parse error" },
          ],
        },
        policy: {
          findings: [
            { file: "c.sql", rule: "no_drop", severity: "error", message: "DROP not allowed" },
          ],
        },
        pii: {
          findings: [
            { file: "d.sql", rule: "email", severity: "warning", message: "PII found" },
          ],
        },
        semantic: {
          findings: [
            { file: "e.sql", rule: "join_mismatch", severity: "error", message: "Type mismatch" },
          ],
        },
        grade: {
          findings: [
            { file: "f.sql", rule: "low_score", severity: "info", message: "Grade: D" },
          ],
        },
      },
    });

    const issues = parseCheckOutput(output);
    expect(issues).toHaveLength(7);

    const categories = issues.map((i) => i.rule!.split("/")[0]);
    expect(categories).toContain("lint");
    expect(categories).toContain("safety");
    expect(categories).toContain("validate");
    expect(categories).toContain("policy");
    expect(categories).toContain("pii");
    expect(categories).toContain("semantic");
    expect(categories).toContain("grade");
  });

  it("maps all severity values correctly including case variations", () => {
    const cases: Array<[string, Severity]> = [
      ["info", Severity.Info],
      ["INFO", Severity.Info],
      ["Info", Severity.Info],
      ["warning", Severity.Warning],
      ["WARNING", Severity.Warning],
      ["warn", Severity.Warning],
      ["WARN", Severity.Warning],
      ["error", Severity.Error],
      ["ERROR", Severity.Error],
      ["Error", Severity.Error],
      ["critical", Severity.Critical],
      ["CRITICAL", Severity.Critical],
      ["fatal", Severity.Critical],
      ["FATAL", Severity.Critical],
      ["something_else", Severity.Warning],
      ["", Severity.Warning],
    ];

    for (const [input, expected] of cases) {
      const output = makeCheckOutput({
        results: {
          lint: {
            findings: [{ file: "t.sql", severity: input, message: "test" }],
          },
        },
      });
      const issues = parseCheckOutput(output);
      expect(issues[0].severity).toBe(expected);
    }
  });

  it("constructs rule prefix correctly for all categories", () => {
    const categoryRulePairs: Array<[string, string, string]> = [
      ["lint", "L001", "lint/L001"],
      ["safety", "injection", "safety/injection"],
      ["policy", "blocked_column", "policy/blocked_column"],
      ["pii", "email", "pii/email"],
      ["validate", "syntax_error", "validate/syntax_error"],
      ["semantic", "type_mismatch", "semantic/type_mismatch"],
      ["grade", "low_score", "grade/low_score"],
    ];

    for (const [category, rule, expectedRule] of categoryRulePairs) {
      const output = makeCheckOutput({
        results: {
          [category]: {
            findings: [
              { file: "t.sql", rule, severity: "warning", message: "test" },
            ],
          },
        },
      });
      const issues = parseCheckOutput(output);
      expect(issues[0].rule).toBe(expectedRule);
    }
  });

  it("handles check output with grade section metadata", () => {
    const output = makeCheckOutput({
      results: {
        grade: {
          findings: [
            {
              file: "models/fct_orders.sql",
              rule: "grade_d",
              severity: "warning",
              message: "SQL quality grade: D (42/100)",
              suggestion: "Improve by removing SELECT * and adding explicit joins",
            },
          ],
        },
      },
    });

    const issues = parseCheckOutput(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("grade/grade_d");
    expect(issues[0].message).toContain("grade: D");
    expect(issues[0].suggestion).toBeDefined();
  });

  it("handles line as non-number gracefully", () => {
    const output = makeCheckOutput({
      results: {
        lint: {
          findings: [
            {
              file: "test.sql",
              line: "not-a-number" as unknown as number,
              code: "L001",
              severity: "warning",
              message: "test",
            },
          ],
        },
      },
    });

    const issues = parseCheckOutput(output);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBeUndefined();
  });

  it("handles results as non-object gracefully", () => {
    const output = makeCheckOutput({
      results: "not-an-object" as unknown as Record<string, never>,
    });
    expect(parseCheckOutput(output)).toEqual([]);
  });

  it("handles results as array gracefully", () => {
    const output = makeCheckOutput({
      results: [] as unknown as Record<string, never>,
    });
    // Array is an object in JS, but Object.entries on [] returns []
    expect(parseCheckOutput(output)).toEqual([]);
  });
});
