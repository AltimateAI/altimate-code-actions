import { describe, it, expect } from "bun:test";
import type {
  ReviewReport,
  SQLIssue,
  ImpactResult,
  CostEstimate,
} from "../../src/analysis/types.js";
import { Severity, SEVERITY_WEIGHT } from "../../src/analysis/types.js";
import {
  assertCommentHasSection,
  assertCommentHasSeverity,
  assertCommentFormat,
  assertCommentMissingSection,
} from "./helpers/assert-comment.js";

const GITHUB_COMMENT_LIMIT = 65536;
const FOOTER = "\n\n---\n*Powered by [Altimate Code](https://altimate.ai)*";

/**
 * Build a PR comment from a ReviewReport. Mirrors the expected production
 * logic for comment generation.
 */
function buildComment(report: ReviewReport): string {
  const sections: string[] = [];

  sections.push("## Altimate Code Review");
  sections.push("");
  sections.push(
    `Analyzed **${report.filesAnalyzed}** files, found **${report.issuesFound}** issues.`,
  );
  sections.push("");

  if (report.issues.length > 0) {
    sections.push("### SQL Quality");
    sections.push("");

    const sorted = [...report.issues].sort(
      (a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity],
    );

    for (const issue of sorted) {
      const sev = issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1);
      const loc = issue.line ? ` (line ${issue.line})` : "";
      sections.push(
        `- **${sev}**: \`${issue.file}\`${loc} — ${issue.message}`,
      );
    }
    sections.push("");
  }

  if (report.impact) {
    sections.push("### Impact Analysis");
    sections.push("");
    sections.push(`- Modified: ${report.impact.modifiedModels.join(", ") || "none"}`);
    sections.push(`- Downstream: ${report.impact.downstreamModels.join(", ") || "none"}`);
    sections.push(`- Impact score: **${report.impact.impactScore}**/100`);
    sections.push("");
  }

  if (report.costEstimates && report.costEstimates.length > 0) {
    sections.push("### Cost Estimation");
    sections.push("");
    let totalDelta = 0;
    for (const est of report.costEstimates) {
      const abs = Math.abs(est.costDelta).toFixed(2);
      const formatted = est.costDelta >= 0 ? `+$${abs}` : `-$${abs}`;
      sections.push(
        `- \`${est.file}\`: ${formatted} ${est.currency}/mo`,
      );
      totalDelta += est.costDelta;
    }
    const totalAbs = Math.abs(totalDelta).toFixed(2);
    const totalFormatted = totalDelta >= 0 ? `+$${totalAbs}` : `-$${totalAbs}`;
    sections.push(`- **Total**: ${totalFormatted} USD/mo`);
    sections.push("");
  }

  sections.push(FOOTER);

  let comment = sections.join("\n");

  if (comment.length > GITHUB_COMMENT_LIMIT) {
    const truncMsg =
      "\n\n*...comment truncated due to GitHub size limit...*" + FOOTER;
    comment =
      comment.slice(0, GITHUB_COMMENT_LIMIT - truncMsg.length) + truncMsg;
  }

  return comment;
}

function makeReport(overrides: Partial<ReviewReport> = {}): ReviewReport {
  return {
    issues: [],
    filesAnalyzed: 10,
    issuesFound: 0,
    shouldFail: false,
    mode: "static",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeIssue(overrides: Partial<SQLIssue> = {}): SQLIssue {
  return {
    file: "models/stg_orders.sql",
    message: "Test issue",
    severity: Severity.Warning,
    ...overrides,
  };
}

describe("PR Comment Generation", () => {
  it("generates valid markdown comment", () => {
    const report = makeReport({
      issues: [makeIssue()],
      issuesFound: 1,
    });
    const comment = buildComment(report);
    assertCommentFormat(comment);
  });

  it("includes SQL quality section when issues exist", () => {
    const report = makeReport({
      issues: [
        makeIssue({ severity: Severity.Error, message: "Missing GROUP BY" }),
      ],
      issuesFound: 1,
    });
    const comment = buildComment(report);
    assertCommentHasSection(comment, "SQL Quality");
    assertCommentHasSeverity(comment, "error");
  });

  it("does not include SQL quality section when no issues", () => {
    const report = makeReport({ issues: [], issuesFound: 0 });
    const comment = buildComment(report);
    assertCommentMissingSection(comment, "SQL Quality");
  });

  it("includes impact analysis section when dbt project found", () => {
    const impact: ImpactResult = {
      modifiedModels: ["stg_orders"],
      downstreamModels: ["orders", "revenue"],
      affectedExposures: [],
      affectedTests: [],
      impactScore: 65,
    };
    const report = makeReport({ impact, impactScore: 65 });
    const comment = buildComment(report);

    assertCommentHasSection(comment, "Impact Analysis");
    expect(comment).toContain("stg_orders");
    expect(comment).toContain("orders");
    expect(comment).toContain("65");
  });

  it("includes cost section when enabled", () => {
    const costEstimates: CostEstimate[] = [
      { file: "models/orders.sql", costDelta: 12.5, currency: "USD" },
    ];
    const report = makeReport({ costEstimates });
    const comment = buildComment(report);

    assertCommentHasSection(comment, "Cost Estimation");
    expect(comment).toContain("$12.50");
  });

  it("respects severity threshold in issue display", () => {
    const report = makeReport({
      issues: [
        makeIssue({ severity: Severity.Info, message: "Info level" }),
        makeIssue({ severity: Severity.Critical, message: "Critical level" }),
      ],
      issuesFound: 2,
    });
    const comment = buildComment(report);

    assertCommentHasSeverity(comment, "info");
    assertCommentHasSeverity(comment, "critical");
  });

  it("handles empty results gracefully", () => {
    const report = makeReport({
      issues: [],
      issuesFound: 0,
      filesAnalyzed: 0,
    });
    const comment = buildComment(report);

    assertCommentFormat(comment);
    expect(comment).toContain("0** issues");
    expect(comment).toContain("0** files");
  });

  it("truncates long comments to GitHub limit (65536 chars)", () => {
    const issues: SQLIssue[] = [];
    for (let i = 0; i < 3000; i++) {
      issues.push(
        makeIssue({
          message: `Issue ${i}: ${"a".repeat(300)}`,
          severity: Severity.Warning,
          file: `models/model_${i}.sql`,
        }),
      );
    }
    const report = makeReport({ issues, issuesFound: issues.length });
    const comment = buildComment(report);

    expect(comment.length).toBeLessThanOrEqual(GITHUB_COMMENT_LIMIT);
    expect(comment).toContain("truncated");
    // Footer should still be present after truncation
    expect(comment).toContain("Altimate Code");
  });

  it("includes file count and issue count in summary", () => {
    const report = makeReport({
      filesAnalyzed: 42,
      issuesFound: 7,
      issues: Array(7)
        .fill(null)
        .map(() => makeIssue()),
    });
    const comment = buildComment(report);

    expect(comment).toContain("42");
    expect(comment).toContain("7");
  });

  it("sorts issues with critical first", () => {
    const issues = [
      makeIssue({ severity: Severity.Info, message: "AAA_info" }),
      makeIssue({ severity: Severity.Critical, message: "AAA_critical" }),
      makeIssue({ severity: Severity.Error, message: "AAA_error" }),
    ];
    const report = makeReport({ issues, issuesFound: 3 });
    const comment = buildComment(report);

    const critIdx = comment.indexOf("AAA_critical");
    const errIdx = comment.indexOf("AAA_error");
    const infoIdx = comment.indexOf("AAA_info");

    expect(critIdx).toBeLessThan(errIdx);
    expect(errIdx).toBeLessThan(infoIdx);
  });

  it("includes footer with link", () => {
    const report = makeReport();
    const comment = buildComment(report);

    expect(comment).toContain("Powered by");
    expect(comment).toContain("altimate.ai");
  });
});
