import { describe, it, expect } from "bun:test";
import {
  formatInlineComment,
  selectInlineIssues,
  buildInlineComments,
} from "../../src/reporting/inline.js";
import { Severity } from "../../src/analysis/types.js";
import type { SQLIssue } from "../../src/analysis/types.js";

function makeIssue(overrides: Partial<SQLIssue> = {}): SQLIssue {
  return {
    file: "models/staging/stg_orders.sql",
    line: 10,
    message: "Avoid SELECT *",
    severity: Severity.Warning,
    rule: "no-select-star",
    ...overrides,
  };
}

describe("formatInlineComment", () => {
  it("formats a critical issue with the rotating_light icon", () => {
    const result = formatInlineComment(
      makeIssue({ severity: Severity.Critical, rule: "no-drop-table", message: "DROP TABLE detected" }),
    );
    expect(result).toContain(":rotating_light:");
    expect(result).toContain("**[no-drop-table] DROP TABLE detected**");
  });

  it("formats an error issue with the x icon", () => {
    const result = formatInlineComment(
      makeIssue({ severity: Severity.Error, rule: "missing-where", message: "DELETE without WHERE" }),
    );
    expect(result).toContain(":x:");
    expect(result).toContain("**[missing-where] DELETE without WHERE**");
  });

  it("formats a warning issue with the warning icon", () => {
    const result = formatInlineComment(makeIssue());
    expect(result).toContain(":warning:");
    expect(result).toContain("**[no-select-star] Avoid SELECT ***");
  });

  it("uses 'issue' as the default rule when rule is undefined", () => {
    const result = formatInlineComment(makeIssue({ rule: undefined }));
    expect(result).toContain("**[issue] Avoid SELECT ***");
  });

  it("includes a suggestion when provided", () => {
    const result = formatInlineComment(
      makeIssue({ suggestion: "List columns explicitly" }),
    );
    expect(result).toContain(":bulb: **Suggestion:** List columns explicitly");
  });

  it("omits suggestion section when no suggestion is provided", () => {
    const result = formatInlineComment(makeIssue({ suggestion: undefined }));
    expect(result).not.toContain("Suggestion");
  });
});

describe("selectInlineIssues", () => {
  it("always includes critical issues", () => {
    const issues = [
      makeIssue({ severity: Severity.Critical, line: 1 }),
      makeIssue({ severity: Severity.Info, line: 2 }),
    ];
    const selected = selectInlineIssues(issues);
    expect(selected).toHaveLength(1);
    expect(selected[0].severity).toBe(Severity.Critical);
  });

  it("always includes error issues", () => {
    const issues = [
      makeIssue({ severity: Severity.Error, line: 5 }),
      makeIssue({ severity: Severity.Info, line: 6 }),
    ];
    const selected = selectInlineIssues(issues);
    expect(selected).toHaveLength(1);
    expect(selected[0].severity).toBe(Severity.Error);
  });

  it("includes warnings when there are 5 or fewer", () => {
    const issues = Array.from({ length: 5 }, (_, i) =>
      makeIssue({ severity: Severity.Warning, line: i + 1 }),
    );
    const selected = selectInlineIssues(issues);
    expect(selected).toHaveLength(5);
  });

  it("excludes warnings when there are more than 5", () => {
    const issues = Array.from({ length: 6 }, (_, i) =>
      makeIssue({ severity: Severity.Warning, line: i + 1 }),
    );
    const selected = selectInlineIssues(issues);
    expect(selected).toHaveLength(0);
  });

  it("includes critical + warnings when warnings <= 5", () => {
    const issues = [
      makeIssue({ severity: Severity.Critical, line: 1 }),
      makeIssue({ severity: Severity.Warning, line: 2 }),
      makeIssue({ severity: Severity.Warning, line: 3 }),
    ];
    const selected = selectInlineIssues(issues);
    expect(selected).toHaveLength(3);
  });

  it("includes critical but excludes warnings when warnings > 5", () => {
    const issues = [
      makeIssue({ severity: Severity.Critical, line: 1 }),
      ...Array.from({ length: 6 }, (_, i) =>
        makeIssue({ severity: Severity.Warning, line: i + 10 }),
      ),
    ];
    const selected = selectInlineIssues(issues);
    expect(selected).toHaveLength(1);
    expect(selected[0].severity).toBe(Severity.Critical);
  });

  it("never includes info issues", () => {
    const issues = [
      makeIssue({ severity: Severity.Info, line: 1 }),
      makeIssue({ severity: Severity.Info, line: 2 }),
    ];
    const selected = selectInlineIssues(issues);
    expect(selected).toHaveLength(0);
  });

  it("excludes issues without a line number", () => {
    const issues = [
      makeIssue({ severity: Severity.Critical, line: undefined }),
      makeIssue({ severity: Severity.Critical, line: 5 }),
    ];
    const selected = selectInlineIssues(issues);
    expect(selected).toHaveLength(1);
    expect(selected[0].line).toBe(5);
  });

  it("caps at 10 inline comments", () => {
    const issues = Array.from({ length: 15 }, (_, i) =>
      makeIssue({ severity: Severity.Critical, line: i + 1 }),
    );
    const selected = selectInlineIssues(issues);
    expect(selected).toHaveLength(10);
  });

  it("returns empty array for empty input", () => {
    const selected = selectInlineIssues([]);
    expect(selected).toHaveLength(0);
  });
});

describe("buildInlineComments", () => {
  it("builds InlineComment objects with path, line, and body", () => {
    const issues = [
      makeIssue({
        severity: Severity.Critical,
        file: "models/core.sql",
        line: 42,
        rule: "no-drop",
        message: "DROP detected",
      }),
    ];
    const comments = buildInlineComments(issues);
    expect(comments).toHaveLength(1);
    expect(comments[0].path).toBe("models/core.sql");
    expect(comments[0].line).toBe(42);
    expect(comments[0].body).toContain("**[no-drop] DROP detected**");
  });

  it("returns empty array when no issues are eligible", () => {
    const issues = [makeIssue({ severity: Severity.Info, line: 1 })];
    const comments = buildInlineComments(issues);
    expect(comments).toHaveLength(0);
  });
});
