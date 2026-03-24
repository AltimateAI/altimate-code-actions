import * as core from "@actions/core";
import { runCLI } from "../util/cli.js";
import { getFileContent, getHeadSHA } from "../util/octokit.js";
import type { ChangedFile, SQLIssue, ActionConfig } from "./types.js";
import { Severity } from "./types.js";

/**
 * Run SQL quality analysis on the given files using the altimate-code CLI.
 *
 * For each SQL file, fetches the full content at the PR head and runs
 * `altimate-code run --format json` with a sql_analyze prompt. Results are
 * parsed into structured SQLIssue objects.
 */
export async function analyzeSQLFiles(
  files: ChangedFile[],
  config: ActionConfig,
): Promise<SQLIssue[]> {
  if (files.length === 0) {
    core.info("No SQL files to analyze");
    return [];
  }

  core.info(`Analyzing ${files.length} SQL file(s)...`);
  const allIssues: SQLIssue[] = [];

  // Process files in batches to avoid overwhelming the CLI
  const batchSize = 5;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchPromises = batch.map((file) =>
      analyzeOneFile(file, config).catch((err) => {
        core.warning(
          `Failed to analyze ${file.filename}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [] as SQLIssue[];
      }),
    );
    const batchResults = await Promise.all(batchPromises);
    for (const issues of batchResults) {
      allIssues.push(...issues);
    }
  }

  core.info(`SQL analysis found ${allIssues.length} issue(s) total`);
  return allIssues;
}

async function analyzeOneFile(
  file: ChangedFile,
  config: ActionConfig,
): Promise<SQLIssue[]> {
  core.debug(`Analyzing SQL file: ${file.filename}`);

  let sqlContent: string;
  try {
    sqlContent = await getFileContent(file.filename, getHeadSHA());
  } catch {
    core.debug(`Could not fetch content for ${file.filename} — using patch`);
    sqlContent = file.patch ?? "";
  }

  if (!sqlContent.trim()) {
    return [];
  }

  const prompt = buildAnalysisPrompt(file.filename, sqlContent, config);

  const result = await runCLI(
    ["run", "--format", "json", "--prompt", prompt],
    {
      parseJson: true,
      env: { MODEL: config.model },
      timeout: 60_000,
    },
  );

  if (result.exitCode !== 0) {
    core.warning(
      `CLI returned exit code ${result.exitCode} for ${file.filename}`,
    );
    // Try to parse partial output anyway
  }

  return parseAnalysisOutput(file.filename, result.json ?? result.stdout);
}

function buildAnalysisPrompt(
  filename: string,
  content: string,
  config: ActionConfig,
): string {
  const checks: string[] = [];

  checks.push(
    "Analyze the following SQL for quality issues, anti-patterns, and potential bugs.",
  );

  if (config.piiCheck) {
    checks.push(
      "Also check for potential PII exposure (column names suggesting personal data without masking).",
    );
  }

  checks.push(
    "Return a JSON array of issues. Each issue must have: file (string), line (number or null), " +
      "severity (info|warning|error|critical), rule (short identifier), message (description), " +
      "suggestion (fix suggestion or null).",
  );

  checks.push(`File: ${filename}`);
  checks.push("```sql");
  checks.push(content);
  checks.push("```");

  return checks.join("\n");
}

function parseAnalysisOutput(
  filename: string,
  output: unknown,
): SQLIssue[] {
  if (!output) return [];

  // If the CLI returned a JSON array directly
  if (Array.isArray(output)) {
    return output.map((item) => normalizeIssue(filename, item));
  }

  // If the CLI returned an object with an issues/results array
  if (typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>;
    const issues = obj.issues ?? obj.results ?? obj.findings;
    if (Array.isArray(issues)) {
      return issues.map((item) => normalizeIssue(filename, item));
    }
  }

  // If it's a string, try to extract JSON from it
  if (typeof output === "string") {
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => normalizeIssue(filename, item));
        }
      } catch {
        core.debug(`Could not parse JSON from CLI output for ${filename}`);
      }
    }
  }

  return [];
}

function normalizeIssue(
  defaultFile: string,
  raw: unknown,
): SQLIssue {
  if (typeof raw !== "object" || raw === null) {
    return {
      file: defaultFile,
      message: String(raw),
      severity: Severity.Warning,
    };
  }

  const obj = raw as Record<string, unknown>;

  return {
    file: typeof obj.file === "string" ? obj.file : defaultFile,
    line: typeof obj.line === "number" ? obj.line : undefined,
    endLine: typeof obj.endLine === "number" ? obj.endLine : undefined,
    message: typeof obj.message === "string" ? obj.message : JSON.stringify(obj),
    severity: parseSeverity(obj.severity),
    rule: typeof obj.rule === "string" ? obj.rule : undefined,
    suggestion: typeof obj.suggestion === "string" ? obj.suggestion : undefined,
  };
}

function parseSeverity(value: unknown): Severity {
  if (typeof value !== "string") return Severity.Warning;

  const lower = value.toLowerCase();
  if (lower === "info") return Severity.Info;
  if (lower === "warning" || lower === "warn") return Severity.Warning;
  if (lower === "error") return Severity.Error;
  if (lower === "critical" || lower === "fatal") return Severity.Critical;

  return Severity.Warning;
}
