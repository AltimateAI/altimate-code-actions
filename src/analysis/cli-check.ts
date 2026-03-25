import { runCLI } from "../util/cli.js";
import {
  Severity,
  type SQLIssue,
  type ChangedFile,
  type ValidationSummary,
  type CategorySummary,
} from "./types.js";
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

/** Result from `runCheckCommand` including issues and validation metadata. */
export interface CheckCommandResult {
  issues: SQLIssue[];
  validationSummary: ValidationSummary;
}

/** Static metadata about each check category for display in PR comments. */
export const CATEGORY_META: Record<
  string,
  { label: string; method: string; ruleCount: number; examples: string[] }
> = {
  lint: {
    label: "Anti-Patterns",
    ruleCount: 26,
    method: "AST analysis",
    examples: ["SELECT *", "cartesian joins", "missing GROUP BY", "non-deterministic functions"],
  },
  safety: {
    label: "Injection Safety",
    ruleCount: 10,
    method: "Pattern scan",
    examples: ["SQL injection", "stacked queries", "tautology", "UNION-based"],
  },
  validate: {
    label: "SQL Syntax",
    ruleCount: 0,
    method: "DataFusion",
    examples: [],
  },
  pii: {
    label: "PII Exposure",
    ruleCount: 9,
    method: "Column classification",
    examples: ["email", "SSN", "phone", "credit card", "IP address"],
  },
  policy: {
    label: "Policy Guardrails",
    ruleCount: 0,
    method: "YAML policy rules",
    examples: [],
  },
  semantic: {
    label: "Semantic Checks",
    ruleCount: 10,
    method: "Plan analysis",
    examples: ["cartesian products", "wrong JOINs", "NULL misuse"],
  },
  grade: {
    label: "Quality Grade",
    ruleCount: 0,
    method: "Composite scoring",
    examples: [],
  },
};

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
 * Run `altimate-code check` on the given files and return structured issues
 * along with a validation summary that describes what was checked and how.
 *
 * Invokes the CLI once with all files and all requested checks, parses the
 * JSON output, and maps findings to the common `SQLIssue[]` format.
 */
export async function runCheckCommand(
  files: ChangedFile[],
  options: CheckCommandOptions = {},
): Promise<CheckCommandResult> {
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
    return { issues: [], validationSummary: buildEmptyValidationSummary(checksArg.split(",")) };
  }

  if (!result.json) {
    core.warning("altimate-code check produced no JSON output");
    return { issues: [], validationSummary: buildEmptyValidationSummary(checksArg.split(",")) };
  }

  const output = result.json as CheckOutput;
  return {
    issues: parseCheckOutput(output),
    validationSummary: extractValidationSummary(output),
  };
}

/**
 * Extract a structured validation summary from CLI check output.
 * This captures what was checked, how, and whether each category passed.
 */
export function extractValidationSummary(output: CheckOutput): ValidationSummary {
  const categories: Record<string, CategorySummary> = {};

  const checksRun = output.checks_run ?? [];
  const schemaResolved = output.schema_resolved ?? false;

  for (const check of checksRun) {
    const meta = CATEGORY_META[check];
    const result = output.results?.[check];
    const findingsCount = result?.findings?.length ?? 0;

    if (meta) {
      const methodWithContext =
        check === "validate" && schemaResolved && output.files_checked > 0
          ? `${meta.method} against ${output.files_checked} table schemas`
          : meta.method;

      // Always show example patterns in the "How" column — this demonstrates
      // what we checked even when everything passes
      const methodDisplay =
        meta.examples.length > 0
          ? `${methodWithContext}: ${meta.examples.join(", ")}`
          : methodWithContext;

      categories[check] = {
        label: meta.ruleCount > 0 ? `${meta.label} (${meta.ruleCount} rules)` : meta.label,
        method: methodDisplay,
        rulesChecked: meta.ruleCount,
        findingsCount,
        passed: findingsCount === 0,
      };
    } else {
      categories[check] = {
        label: check.charAt(0).toUpperCase() + check.slice(1),
        method: "Static analysis",
        rulesChecked: 0,
        findingsCount,
        passed: findingsCount === 0,
      };
    }
  }

  return { checksRun, schemaResolved, categories };
}

/** Build a minimal validation summary when CLI output is unavailable. */
function buildEmptyValidationSummary(checks: string[]): ValidationSummary {
  const categories: Record<string, CategorySummary> = {};
  for (const check of checks) {
    const meta = CATEGORY_META[check];
    categories[check] = {
      label: meta
        ? meta.ruleCount > 0
          ? `${meta.label} (${meta.ruleCount} rules)`
          : meta.label
        : check,
      method: meta?.method ?? "Static analysis",
      rulesChecked: meta?.ruleCount ?? 0,
      findingsCount: 0,
      passed: true,
    };
  }
  return { checksRun: checks, schemaResolved: false, categories };
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
