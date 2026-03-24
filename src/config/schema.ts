import { Severity } from "../analysis/types.js";
import type { CommentMode } from "../analysis/types.js";

/** Supported SQL dialects. */
export type Dialect =
  | "auto"
  | "snowflake"
  | "bigquery"
  | "postgres"
  | "redshift"
  | "databricks"
  | "mysql";

/** Per-rule configuration. */
export interface RuleConfig {
  /** Whether this rule is enabled. */
  enabled: boolean;
  /** Override the default severity for this rule. */
  severity: Severity;
}

/** A custom SQL pattern to flag during review. */
export interface CustomPattern {
  /** Human-readable name for this pattern. */
  name: string;
  /** Regular expression pattern to match against SQL content. */
  pattern: string;
  /** Message to display when the pattern is matched. */
  message: string;
  /** Severity of the finding. */
  severity: Severity;
}

/** A custom PII column pattern. */
export interface PIIPattern {
  /** Human-readable name for this PII pattern. */
  name: string;
  /** Regex to match column names that may contain PII. */
  column_pattern: string;
  /** Severity of the finding. */
  severity: Severity;
}

/** SQL review configuration. */
export interface SQLReviewConfig {
  enabled: boolean;
  severity_threshold: Severity;

  rules: {
    select_star: RuleConfig;
    cartesian_join: RuleConfig;
    missing_partition: RuleConfig;
    non_deterministic: RuleConfig;
    correlated_subquery: RuleConfig;
    implicit_type_cast: RuleConfig;
    or_in_join: RuleConfig;
    missing_group_by: RuleConfig;
    order_by_ordinal: RuleConfig;
    union_without_all: RuleConfig;
    nested_subquery: RuleConfig;
    missing_where_clause: RuleConfig;
    leading_wildcard_like: RuleConfig;
    duplicate_column_alias: RuleConfig;
    function_on_indexed_column: RuleConfig;
    not_in_with_nulls: RuleConfig;
    distinct_masking_bad_join: RuleConfig;
    count_for_existence: RuleConfig;
    no_limit_on_delete: RuleConfig;
  };

  /** Glob patterns for files to include. */
  include: string[];
  /** Glob patterns for files to exclude. */
  exclude: string[];

  /** Custom SQL patterns to flag. */
  custom_patterns: CustomPattern[];
}

/** Impact analysis configuration. */
export interface ImpactAnalysisConfig {
  enabled: boolean;
  /** Warn if more than this many downstream models are affected. */
  warn_threshold: number;
  /** Fail if more than this many downstream models are affected. */
  fail_threshold: number;
}

/** Cost estimation configuration. */
export interface CostEstimationConfig {
  enabled: boolean;
  /** Warn if monthly cost delta exceeds this amount in USD. */
  warn_threshold: number;
  /** Fail if monthly cost delta exceeds this amount in USD. 0 = disabled. */
  fail_threshold: number;
}

/** PII detection configuration. */
export interface PIIDetectionConfig {
  enabled: boolean;
  /** Built-in PII categories to check. */
  categories: string[];
  /** Custom PII column patterns. */
  custom_patterns: PIIPattern[];
}

/** Comment rendering configuration. */
export interface CommentConfig {
  /** How to post results: single summary, inline per-line, or both. */
  mode: CommentMode;
  /** Maximum number of issues to show in the summary comment. */
  max_issues_shown: number;
  /** Whether to list files that had no issues. */
  show_clean_files: boolean;
}

/**
 * Top-level configuration schema for `.altimate.yml`.
 *
 * All fields are required in the fully-resolved config (after defaults are
 * applied). The raw YAML file may omit any field — `loadConfig` fills in
 * defaults from `DEFAULT_CONFIG`.
 */
export interface AltimateConfig {
  /** Schema version — currently always 1. */
  version: 1;

  sql_review: SQLReviewConfig;
  impact_analysis: ImpactAnalysisConfig;
  cost_estimation: CostEstimationConfig;
  pii_detection: PIIDetectionConfig;
  comment: CommentConfig;

  /** SQL dialect for analysis. "auto" attempts detection from file content. */
  dialect: Dialect;
}

/**
 * Partial version of AltimateConfig — every field is optional, matching what
 * users actually write in their `.altimate.yml`. The loader deep-merges this
 * with `DEFAULT_CONFIG` to produce a fully resolved `AltimateConfig`.
 */
export type PartialAltimateConfig = {
  version?: number;
  sql_review?: Partial<
    Omit<SQLReviewConfig, "rules" | "custom_patterns"> & {
      rules?: Partial<Record<keyof SQLReviewConfig["rules"], Partial<RuleConfig>>>;
      custom_patterns?: CustomPattern[];
    }
  >;
  impact_analysis?: Partial<ImpactAnalysisConfig>;
  cost_estimation?: Partial<CostEstimationConfig>;
  pii_detection?: Partial<
    Omit<PIIDetectionConfig, "custom_patterns"> & {
      custom_patterns?: PIIPattern[];
    }
  >;
  comment?: Partial<CommentConfig>;
  dialect?: Dialect;
};

// ---------------------------------------------------------------------------
// V2 Configuration — maps to `altimate-code check` CLI options
// ---------------------------------------------------------------------------

/** Per-check configuration for the v2 `altimate-code check` integration. */
export interface CheckConfig {
  enabled: boolean;
}

export interface LintCheckConfig extends CheckConfig {
  /** Rule IDs to disable even if they would otherwise fire. */
  disabled_rules?: string[];
  /** Override the default severity for specific rules. */
  severity_overrides?: Record<string, Severity>;
}

export interface PolicyCheckConfig extends CheckConfig {
  /** Path to a policy file. If omitted, the CLI looks for `.altimate-policy.yml`. */
  file?: string;
}

export interface PIICheckConfig extends CheckConfig {
  /** PII categories to scan for (e.g. "email", "ssn"). */
  categories?: string[];
}

export interface SchemaConfig {
  /** Where the CLI should resolve schema from. */
  source: string;
  /** Explicit schema file paths. */
  paths?: string[];
  /** dbt-specific schema resolution. */
  dbt?: { manifest_path?: string };
}

/**
 * V2 configuration schema for `.altimate.yml`. When `version: 2` is set,
 * the action delegates all static checks to `altimate-code check` instead
 * of the built-in regex rule engine.
 */
export interface AltimateConfigV2 {
  version: 2;
  checks: {
    lint: LintCheckConfig;
    validate: CheckConfig;
    safety: CheckConfig;
    policy: PolicyCheckConfig;
    pii: PIICheckConfig;
    semantic: CheckConfig;
    grade: CheckConfig;
  };
  schema?: SchemaConfig;
  policy?: Record<string, unknown>;
  dialect?: Dialect;
  comment?: Partial<CommentConfig>;
}

/**
 * Build `CheckCommandOptions` from a v2 config, collecting all enabled
 * check names and passing through schema/policy/dialect settings.
 */
export function buildCheckOptionsFromV2(
  config: AltimateConfigV2,
): { checks: string[]; schemaPath?: string; policyPath?: string; dialect?: string } {
  const checks: string[] = [];
  for (const [name, checkConfig] of Object.entries(config.checks)) {
    if (checkConfig.enabled) {
      checks.push(name);
    }
  }

  return {
    checks,
    schemaPath: config.schema?.paths?.[0],
    policyPath: config.checks.policy?.file,
    dialect: config.dialect !== "auto" ? config.dialect : undefined,
  };
}
