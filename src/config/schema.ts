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
