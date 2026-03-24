import { Severity } from "../analysis/types.js";
import type { AltimateConfig, RuleConfig } from "./schema.js";

/** Helper to create a rule config with a default severity. */
function rule(severity: Severity, enabled = true): RuleConfig {
  return { enabled, severity };
}

/**
 * Default configuration used when no `.altimate.yml` exists or when fields are
 * omitted. Every field has a sensible production default so the action works
 * out of the box with zero configuration.
 */
export const DEFAULT_CONFIG: AltimateConfig = {
  version: 1,

  sql_review: {
    enabled: true,
    severity_threshold: Severity.Warning,

    rules: {
      select_star: rule(Severity.Warning),
      cartesian_join: rule(Severity.Error),
      missing_partition: rule(Severity.Warning),
      non_deterministic: rule(Severity.Warning),
      correlated_subquery: rule(Severity.Warning),
      implicit_type_cast: rule(Severity.Info),
      or_in_join: rule(Severity.Warning),
      missing_group_by: rule(Severity.Error),
      order_by_ordinal: rule(Severity.Info),
      union_without_all: rule(Severity.Info),
      nested_subquery: rule(Severity.Warning),
      missing_where_clause: rule(Severity.Warning),
      leading_wildcard_like: rule(Severity.Info),
      duplicate_column_alias: rule(Severity.Error),
      function_on_indexed_column: rule(Severity.Warning),
      not_in_with_nulls: rule(Severity.Warning),
      distinct_masking_bad_join: rule(Severity.Warning),
      count_for_existence: rule(Severity.Warning),
      no_limit_on_delete: rule(Severity.Info),
    },

    include: ["**/*.sql", "**/*.sqlx"],
    exclude: [],
    custom_patterns: [],
  },

  impact_analysis: {
    enabled: true,
    warn_threshold: 10,
    fail_threshold: 50,
  },

  cost_estimation: {
    enabled: false,
    warn_threshold: 100,
    fail_threshold: 0,
  },

  pii_detection: {
    enabled: true,
    categories: ["email", "ssn", "phone", "credit_card", "ip_address"],
    custom_patterns: [],
  },

  comment: {
    mode: "single",
    max_issues_shown: 20,
    show_clean_files: false,
  },

  dialect: "auto",
};
