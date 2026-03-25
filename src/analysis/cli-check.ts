import { runCLI } from "../util/cli.js";
import { Severity, type SQLIssue, type ChangedFile } from "./types.js";
import * as core from "@actions/core";

/** Structured output from `altimate-code check --format json`. */
export interface CheckOutput {
  version: number;
  files_checked: number;
  checks_run: string[];
  schema_resolved?: boolean;
  results: Record<string, CheckCategoryResult>;
  summary: {
    total_findings: number;
    errors: number;
    warnings: number;
    info: number;
    pass: boolean;
  };
}

interface CheckCategoryResult {
  findings: Finding[];
  error_count?: number;
  warning_count?: number;
  safe?: boolean;
  valid?: boolean;
  allowed?: boolean;
  risk_level?: string;
}

interface Finding {
  file: string;
  line?: number;
  code?: string;
  rule?: string;
  severity: string;
  message: string;
  suggestion?: string;
}

export interface CheckCommandOptions {
  checks?: string[];
  schemaPath?: string;
  policyPath?: string;
  dialect?: string;
  severity?: string;
}

/**
 * Detect whether the `altimate-code` CLI is available and supports the
 * `check` subcommand. Returns true if the CLI responds to `check --help`.
 */
export async function isCheckCommandAvailable(): Promise<boolean> {
  try {
    const result = await runCLI(["check", "--help"], { timeout: 10_000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Run `altimate-code check` on the given files and return structured issues.
 *
 * Invokes the CLI once with all files and all requested checks, parses the
 * JSON output, and maps findings to the common `SQLIssue[]` format.
 */
export async function runCheckCommand(
  files: ChangedFile[],
  options: CheckCommandOptions = {},
): Promise<SQLIssue[]> {
  const filePaths = files.map((f) => f.filename);
  const checksArg = (options.checks ?? ["lint", "safety"]).join(",");

  const args = [
    "check",
    ...filePaths,
    "--format",
    "json",
    "--checks",
    checksArg,
    "--severity",
    options.severity ?? "info",
  ];

  if (options.schemaPath) args.push("--schema", options.schemaPath);
  if (options.policyPath) args.push("--policy", options.policyPath);
  if (options.dialect) args.push("--dialect", options.dialect);

  const result = await runCLI(args, { timeout: 120_000, parseJson: true });

  if (result.exitCode !== 0 && !result.json) {
    core.warning(`altimate-code check failed (exit ${result.exitCode}): ${result.stderr}`);
    return [];
  }

  if (!result.json) {
    core.warning("altimate-code check produced no JSON output");
    return [];
  }

  return parseCheckOutput(result.json as CheckOutput);
}

/**
 * Parse the structured JSON output from `altimate-code check` into a flat
 * array of `SQLIssue` objects. Each finding is prefixed with its category
 * (e.g. `lint/L001`, `safety/injection`, `pii/email`).
 */
export function parseCheckOutput(output: CheckOutput): SQLIssue[] {
  const issues: SQLIssue[] = [];

  if (!output.results || typeof output.results !== "object") {
    return issues;
  }

  for (const [category, result] of Object.entries(output.results)) {
    if (!result.findings || !Array.isArray(result.findings)) continue;

    for (const finding of result.findings) {
      const ruleCode = finding.code ?? finding.rule ?? "unknown";
      issues.push({
        file: finding.file,
        line: typeof finding.line === "number" ? finding.line : undefined,
        message: finding.message,
        severity: mapSeverity(finding.severity),
        rule: `${category}/${ruleCode}`,
        suggestion: finding.suggestion,
      });
    }
  }

  return issues;
}

function mapSeverity(value: string): Severity {
  const lower = value.toLowerCase();
  if (lower === "info") return Severity.Info;
  if (lower === "warning" || lower === "warn") return Severity.Warning;
  if (lower === "error") return Severity.Error;
  if (lower === "critical" || lower === "fatal") return Severity.Critical;
  return Severity.Warning;
}
