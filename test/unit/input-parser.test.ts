import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  Severity,
  type ActionConfig,
  type ReviewMode,
  type CommentMode,
  type FailOn,
} from "../../src/analysis/types.js";

/**
 * Input parser that reads GitHub Actions inputs from environment variables.
 * This implements the expected parsing logic; when the real module is built,
 * tests should be updated to import from it.
 */

const VALID_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-opus-4-0-20250514",
  "gpt-4o",
  "gpt-4o-mini",
];
const VALID_SEVERITIES: Severity[] = [
  Severity.Info,
  Severity.Warning,
  Severity.Error,
  Severity.Critical,
];
const VALID_MODES: ReviewMode[] = ["full", "static", "ai"];
const VALID_COMMENT_MODES: CommentMode[] = ["single", "inline", "both"];
const VALID_FAIL_ON: FailOn[] = ["none", "error", "critical"];

function getInput(name: string): string {
  const envKey = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`;
  return process.env[envKey]?.trim() ?? "";
}

function getBoolInput(name: string, defaultVal = false): boolean {
  const val = getInput(name).toLowerCase();
  if (val === "") return defaultVal;
  return val === "true" || val === "1" || val === "yes";
}

function parseInputs(): ActionConfig {
  const model = getInput("model") || "claude-sonnet-4-20250514";
  const mode = (getInput("mode") || "full") as ReviewMode;
  const commentMode = (getInput("comment_mode") || "single") as CommentMode;
  const failOn = (getInput("fail_on") || "none") as FailOn;
  const severityStr = getInput("severity_threshold") || "warning";
  const severityThreshold = severityStr as Severity;
  const maxFiles = parseInt(getInput("max_files") || "50", 10);

  // Validate model
  if (!VALID_MODELS.includes(model) && !model.startsWith("claude-") && !model.startsWith("gpt-")) {
    throw new Error(
      `Invalid model: "${model}". Expected one of: ${VALID_MODELS.join(", ")} or a model starting with "claude-" or "gpt-"`,
    );
  }

  // Validate severity
  if (!VALID_SEVERITIES.includes(severityThreshold)) {
    throw new Error(
      `Invalid severity_threshold: "${severityStr}". Expected one of: ${VALID_SEVERITIES.join(", ")}`,
    );
  }

  // Validate mode
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Invalid mode: "${mode}". Expected one of: ${VALID_MODES.join(", ")}`);
  }

  // Validate comment_mode
  if (!VALID_COMMENT_MODES.includes(commentMode)) {
    throw new Error(
      `Invalid comment_mode: "${commentMode}". Expected one of: ${VALID_COMMENT_MODES.join(", ")}`,
    );
  }

  // Validate fail_on
  if (!VALID_FAIL_ON.includes(failOn)) {
    throw new Error(`Invalid fail_on: "${failOn}". Expected one of: ${VALID_FAIL_ON.join(", ")}`);
  }

  // Validate max_files
  if (isNaN(maxFiles) || maxFiles < 1) {
    throw new Error(`Invalid max_files: must be a positive integer`);
  }

  const mentionsStr = getInput("mentions");
  const mentions = mentionsStr
    ? mentionsStr
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
    : [];

  return {
    model,
    sqlReview: getBoolInput("sql_review", true),
    impactAnalysis: getBoolInput("impact_analysis", false),
    costEstimation: getBoolInput("cost_estimation", false),
    piiCheck: getBoolInput("pii_check", false),
    mode,
    interactive: getBoolInput("interactive", false),
    mentions,
    dbtProjectDir: getInput("dbt_project_dir") || undefined,
    dbtVersion: getInput("dbt_version") || undefined,
    manifestPath: getInput("manifest_path") || undefined,
    warehouseType: getInput("warehouse_type") || undefined,
    useGithubToken: getBoolInput("use_github_token", true),
    maxFiles,
    severityThreshold,
    commentMode,
    failOn,
  };
}

// Helper to set env and clear after
function setInputEnv(inputs: Record<string, string>): void {
  for (const [key, value] of Object.entries(inputs)) {
    process.env[`INPUT_${key.toUpperCase().replace(/-/g, "_")}`] = value;
  }
}

function clearInputEnv(keys: string[]): void {
  for (const key of keys) {
    delete process.env[`INPUT_${key.toUpperCase().replace(/-/g, "_")}`];
  }
}

describe("Input Parser", () => {
  const allKeys = [
    "model",
    "sql_review",
    "impact_analysis",
    "cost_estimation",
    "pii_check",
    "mode",
    "interactive",
    "mentions",
    "dbt_project_dir",
    "dbt_version",
    "manifest_path",
    "warehouse_type",
    "use_github_token",
    "max_files",
    "severity_threshold",
    "comment_mode",
    "fail_on",
  ];

  beforeEach(() => {
    clearInputEnv(allKeys);
  });

  afterEach(() => {
    clearInputEnv(allKeys);
  });

  it("parses all env var inputs", () => {
    setInputEnv({
      model: "gpt-4o",
      sql_review: "true",
      impact_analysis: "true",
      cost_estimation: "false",
      pii_check: "true",
      mode: "full",
      severity_threshold: "error",
      fail_on: "critical",
      comment_mode: "both",
      max_files: "100",
      mentions: "@alice, @bob",
      dbt_project_dir: "./dbt",
      dbt_version: "1.8",
      warehouse_type: "snowflake",
    });

    const config = parseInputs();

    expect(config.model).toBe("gpt-4o");
    expect(config.sqlReview).toBe(true);
    expect(config.impactAnalysis).toBe(true);
    expect(config.costEstimation).toBe(false);
    expect(config.piiCheck).toBe(true);
    expect(config.mode).toBe("full");
    expect(config.severityThreshold).toBe(Severity.Error);
    expect(config.failOn).toBe("critical");
    expect(config.commentMode).toBe("both");
    expect(config.maxFiles).toBe(100);
    expect(config.mentions).toEqual(["@alice", "@bob"]);
    expect(config.dbtProjectDir).toBe("./dbt");
    expect(config.dbtVersion).toBe("1.8");
    expect(config.warehouseType).toBe("snowflake");
  });

  it("applies defaults when no inputs provided", () => {
    const config = parseInputs();

    expect(config.model).toBe("claude-sonnet-4-20250514");
    expect(config.sqlReview).toBe(true);
    expect(config.impactAnalysis).toBe(false);
    expect(config.costEstimation).toBe(false);
    expect(config.piiCheck).toBe(false);
    expect(config.mode).toBe("full");
    expect(config.severityThreshold).toBe("warning");
    expect(config.failOn).toBe("none");
    expect(config.commentMode).toBe("single");
    expect(config.maxFiles).toBe(50);
    expect(config.mentions).toEqual([]);
    expect(config.dbtProjectDir).toBeUndefined();
    expect(config.warehouseType).toBeUndefined();
  });

  it("validates model format", () => {
    setInputEnv({ model: "invalid-model-xyz" });
    expect(() => parseInputs()).toThrow(/Invalid model/);
  });

  it("accepts models starting with claude- or gpt-", () => {
    setInputEnv({ model: "claude-3-haiku-20240307" });
    expect(() => parseInputs()).not.toThrow();

    setInputEnv({ model: "gpt-4-turbo" });
    expect(() => parseInputs()).not.toThrow();
  });

  it("validates severity threshold", () => {
    setInputEnv({ severity_threshold: "banana" });
    expect(() => parseInputs()).toThrow(/Invalid severity_threshold/);
  });

  it("accepts all valid severity levels", () => {
    for (const sev of ["info", "warning", "error", "critical"]) {
      clearInputEnv(allKeys);
      setInputEnv({ severity_threshold: sev });
      expect(() => parseInputs()).not.toThrow();
    }
  });

  it("validates fail_on setting", () => {
    setInputEnv({ fail_on: "always" });
    expect(() => parseInputs()).toThrow(/Invalid fail_on/);
  });

  it("accepts all valid fail_on values", () => {
    for (const val of ["none", "error", "critical"]) {
      clearInputEnv(allKeys);
      setInputEnv({ fail_on: val });
      expect(() => parseInputs()).not.toThrow();
    }
  });

  it("validates mode", () => {
    setInputEnv({ mode: "invalid" });
    expect(() => parseInputs()).toThrow(/Invalid mode/);
  });

  it("validates comment_mode", () => {
    setInputEnv({ comment_mode: "magic" });
    expect(() => parseInputs()).toThrow(/Invalid comment_mode/);
  });

  it("validates max_files is positive", () => {
    setInputEnv({ max_files: "0" });
    expect(() => parseInputs()).toThrow(/Invalid max_files/);

    clearInputEnv(allKeys);
    setInputEnv({ max_files: "-5" });
    expect(() => parseInputs()).toThrow(/Invalid max_files/);
  });

  it("validates max_files is a number", () => {
    setInputEnv({ max_files: "abc" });
    expect(() => parseInputs()).toThrow(/Invalid max_files/);
  });

  it("parses boolean inputs correctly", () => {
    setInputEnv({ sql_review: "false" });
    expect(parseInputs().sqlReview).toBe(false);

    clearInputEnv(allKeys);
    setInputEnv({ sql_review: "1" });
    expect(parseInputs().sqlReview).toBe(true);

    clearInputEnv(allKeys);
    setInputEnv({ sql_review: "yes" });
    expect(parseInputs().sqlReview).toBe(true);

    clearInputEnv(allKeys);
    setInputEnv({ sql_review: "no" });
    expect(parseInputs().sqlReview).toBe(false);
  });

  it("trims whitespace from inputs", () => {
    setInputEnv({ model: "  gpt-4o  " });
    expect(parseInputs().model).toBe("gpt-4o");
  });

  it("parses comma-separated mentions", () => {
    setInputEnv({ mentions: "@alice, @bob , @charlie" });
    expect(parseInputs().mentions).toEqual(["@alice", "@bob", "@charlie"]);
  });

  it("handles empty mentions gracefully", () => {
    setInputEnv({ mentions: "" });
    expect(parseInputs().mentions).toEqual([]);
  });
});
