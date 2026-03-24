/** Severity levels for review findings, ordered from least to most severe. */
export enum Severity {
  Info = "info",
  Warning = "warning",
  Error = "error",
  Critical = "critical",
}

/** Numeric weight for each severity — used for sorting and threshold comparisons. */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  [Severity.Info]: 0,
  [Severity.Warning]: 1,
  [Severity.Error]: 2,
  [Severity.Critical]: 3,
};

/** A single issue found by SQL static analysis or AI review. */
export interface SQLIssue {
  /** Relative file path within the repo. */
  file: string;
  /** 1-based line number where the issue starts, if available. */
  line?: number;
  /** 1-based end line, if the issue spans multiple lines. */
  endLine?: number;
  /** Human-readable description of the issue. */
  message: string;
  /** Severity classification. */
  severity: Severity;
  /** Short rule/check identifier, e.g. "no-select-star". */
  rule?: string;
  /** Suggested fix, if available. */
  suggestion?: string;
}

/** Result of impact analysis on dbt DAG changes. */
export interface ImpactResult {
  /** Models that were directly modified in this PR. */
  modifiedModels: string[];
  /** Downstream models affected by the change. */
  downstreamModels: string[];
  /** Exposures (dashboards, reports) that reference affected models. */
  affectedExposures: string[];
  /** Tests that cover the modified or downstream models. */
  affectedTests: string[];
  /** Aggregate impact score 0-100 (higher = more risk). */
  impactScore: number;
}

/** Cost estimate for a single file or model. */
export interface CostEstimate {
  /** Relative file path. */
  file: string;
  /** Model name if applicable. */
  model?: string;
  /** Estimated monthly cost before the change in USD. */
  costBefore?: number;
  /** Estimated monthly cost after the change in USD. */
  costAfter?: number;
  /** Delta = costAfter - costBefore. Negative means savings. */
  costDelta: number;
  /** Currency string (always "USD" for now). */
  currency: string;
  /** Human-readable explanation of the estimate. */
  explanation?: string;
}

/** Aggregated review report for the entire PR. */
export interface ReviewReport {
  /** All SQL issues found across files. */
  issues: SQLIssue[];
  /** Impact analysis result, if impact analysis was enabled and a dbt project was found. */
  impact?: ImpactResult;
  /** Cost estimates per file, if cost estimation was enabled. */
  costEstimates?: CostEstimate[];
  /** Total number of files analyzed. */
  filesAnalyzed: number;
  /** Total number of issues found (convenience: issues.length). */
  issuesFound: number;
  /** Aggregate impact score 0-100, or undefined if impact analysis was skipped. */
  impactScore?: number;
  /** Aggregate monthly cost delta in USD, or undefined if cost estimation was skipped. */
  estimatedCostDelta?: number;
  /** Whether the action should fail based on fail_on threshold. */
  shouldFail: boolean;
  /** Review mode that was used. */
  mode: ReviewMode;
  /** Timestamp of the analysis. */
  timestamp: string;
}

/** Parsed input configuration for the action. */
export interface ActionConfig {
  model: string;
  sqlReview: boolean;
  impactAnalysis: boolean;
  costEstimation: boolean;
  piiCheck: boolean;
  mode: ReviewMode;
  interactive: boolean;
  mentions: string[];
  dbtProjectDir?: string;
  dbtVersion?: string;
  manifestPath?: string;
  warehouseType?: string;
  warehouseConnection?: Record<string, unknown>;
  useGithubToken: boolean;
  maxFiles: number;
  severityThreshold: Severity;
  commentMode: CommentMode;
  failOn: FailOn;
}

export type ReviewMode = "full" | "static" | "ai";
export type CommentMode = "single" | "inline" | "both";
export type FailOn = "none" | "error" | "critical";

/** A single changed file in the PR diff. */
export interface ChangedFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch?: string;
}

/** Parsed unified diff hunk. */
export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface ParsedDiff {
  file: string;
  hunks: DiffHunk[];
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
}

/** dbt manifest model metadata. */
export interface DBTModel {
  uniqueId: string;
  name: string;
  resourceType: string;
  filePath: string;
  dependsOn: string[];
  description?: string;
  schema?: string;
  database?: string;
}

/** Minimal dbt manifest structure. */
export interface DBTManifest {
  nodes: Record<string, DBTManifestNode>;
  sources: Record<string, DBTManifestNode>;
  exposures: Record<string, DBTManifestNode>;
  childMap: Record<string, string[]>;
  parentMap: Record<string, string[]>;
}

export interface DBTManifestNode {
  unique_id: string;
  name: string;
  resource_type: string;
  original_file_path?: string;
  path?: string;
  depends_on?: { nodes?: string[] };
  description?: string;
  schema?: string;
  database?: string;
}

/** An inline review comment to post on a specific diff line. */
export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

/** CLI execution result. */
export interface CLIResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Parsed JSON output, if the CLI returned JSON. */
  json?: unknown;
}
