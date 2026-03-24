import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as core from "@actions/core";
import yaml from "js-yaml";
import { Severity } from "../analysis/types.js";
import type { CommentMode } from "../analysis/types.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import type {
  AltimateConfig,
  Dialect,
} from "./schema.js";

/**
 * Parse YAML text into a plain object using js-yaml.
 */
function parseYAML(text: string): Record<string, unknown> {
  const result = yaml.load(text);
  if (result === null || result === undefined) return {};
  if (typeof result !== "object" || Array.isArray(result)) return {};
  return result as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SEVERITIES = new Set(Object.values(Severity));
const VALID_DIALECTS = new Set<string>([
  "auto",
  "snowflake",
  "bigquery",
  "postgres",
  "redshift",
  "databricks",
  "mysql",
]);
const VALID_COMMENT_MODES = new Set<string>(["single", "inline", "both"]);
const VALID_PII_CATEGORIES = new Set<string>([
  "email",
  "ssn",
  "phone",
  "credit_card",
  "ip_address",
  "name",
  "address",
  "date_of_birth",
]);

/** Validation errors collected during config loading. */
export class ConfigValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid .altimate.yml:\n  - ${errors.join("\n  - ")}`);
    this.name = "ConfigValidationError";
  }
}

function validateRawConfig(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  // Version check
  if ("version" in raw && raw.version !== 1) {
    errors.push(`Unsupported config version: ${raw.version}. Only version 1 is supported.`);
  }

  // Dialect
  if ("dialect" in raw && !VALID_DIALECTS.has(String(raw.dialect))) {
    errors.push(
      `Invalid dialect '${raw.dialect}'. Must be one of: ${[...VALID_DIALECTS].join(", ")}`,
    );
  }

  // SQL review
  const sqlReview = raw.sql_review as Record<string, unknown> | undefined;
  if (sqlReview) {
    if (
      "severity_threshold" in sqlReview &&
      !VALID_SEVERITIES.has(sqlReview.severity_threshold as Severity)
    ) {
      errors.push(
        `Invalid sql_review.severity_threshold '${sqlReview.severity_threshold}'`,
      );
    }

    const rules = sqlReview.rules as Record<string, unknown> | undefined;
    if (rules) {
      for (const [name, ruleVal] of Object.entries(rules)) {
        if (typeof ruleVal === "object" && ruleVal !== null) {
          const r = ruleVal as Record<string, unknown>;
          if ("severity" in r && !VALID_SEVERITIES.has(r.severity as Severity)) {
            errors.push(
              `Invalid severity '${r.severity}' for rule '${name}'`,
            );
          }
        }
      }
    }

    const patterns = sqlReview.custom_patterns;
    if (Array.isArray(patterns)) {
      for (let i = 0; i < patterns.length; i++) {
        const p = patterns[i] as Record<string, unknown>;
        if (!p.name) errors.push(`custom_patterns[${i}] missing 'name'`);
        if (!p.pattern) errors.push(`custom_patterns[${i}] missing 'pattern'`);
        if (!p.message) errors.push(`custom_patterns[${i}] missing 'message'`);
        if (p.pattern) {
          try {
            new RegExp(String(p.pattern), "gi");
          } catch {
            errors.push(`custom_patterns[${i}] has invalid regex: ${p.pattern}`);
          }
        }
      }
    }
  }

  // Comment config
  const comment = raw.comment as Record<string, unknown> | undefined;
  if (comment && "mode" in comment && !VALID_COMMENT_MODES.has(String(comment.mode))) {
    errors.push(
      `Invalid comment.mode '${comment.mode}'. Must be one of: ${[...VALID_COMMENT_MODES].join(", ")}`,
    );
  }

  // PII categories
  const pii = raw.pii_detection as Record<string, unknown> | undefined;
  if (pii && Array.isArray(pii.categories)) {
    for (const cat of pii.categories) {
      if (!VALID_PII_CATEGORIES.has(String(cat))) {
        errors.push(
          `Unknown PII category '${cat}'. Valid: ${[...VALID_PII_CATEGORIES].join(", ")}`,
        );
      }
    }
  }

  // Numeric thresholds
  const impact = raw.impact_analysis as Record<string, unknown> | undefined;
  if (impact) {
    if ("warn_threshold" in impact && Number(impact.warn_threshold) < 0) {
      errors.push("impact_analysis.warn_threshold must be >= 0");
    }
    if ("fail_threshold" in impact && Number(impact.fail_threshold) < 0) {
      errors.push("impact_analysis.fail_threshold must be >= 0");
    }
  }

  const cost = raw.cost_estimation as Record<string, unknown> | undefined;
  if (cost) {
    if ("warn_threshold" in cost && Number(cost.warn_threshold) < 0) {
      errors.push("cost_estimation.warn_threshold must be >= 0");
    }
    if ("fail_threshold" in cost && Number(cost.fail_threshold) < 0) {
      errors.push("cost_estimation.fail_threshold must be >= 0");
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Deep merge
// ---------------------------------------------------------------------------

/**
 * Deep-merge `partial` into a clone of `defaults`. Arrays in `partial` replace
 * (not concatenate) the default arrays. Scalar values in `partial` override
 * defaults.
 */
function deepMerge<T extends Record<string, unknown>>(
  defaults: T,
  partial: Record<string, unknown>,
): T {
  const result = { ...defaults };

  for (const key of Object.keys(partial)) {
    const pVal = partial[key];
    const dVal = (defaults as Record<string, unknown>)[key];

    if (pVal === undefined || pVal === null) continue;

    if (
      Array.isArray(pVal)
    ) {
      // Arrays in the user config replace defaults entirely
      (result as Record<string, unknown>)[key] = pVal;
    } else if (
      typeof pVal === "object" &&
      !Array.isArray(pVal) &&
      typeof dVal === "object" &&
      dVal !== null &&
      !Array.isArray(dVal)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        dVal as Record<string, unknown>,
        pVal as Record<string, unknown>,
      );
    } else {
      (result as Record<string, unknown>)[key] = pVal;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and validate the `.altimate.yml` configuration file. Returns a fully
 * resolved `AltimateConfig` with defaults applied for any omitted fields.
 *
 * @param configPath  Path to the config file. Defaults to `.altimate.yml` in cwd.
 * @returns Fully resolved config.
 * @throws {ConfigValidationError} if the config file has invalid values.
 */
export function loadConfig(configPath?: string): AltimateConfig {
  if (!configPath?.trim()) {
    configPath = ".altimate.yml";
  }
  const filePath = resolve(configPath);

  if (!existsSync(filePath)) {
    core.info(`No config file at ${filePath} — using defaults`);
    return { ...DEFAULT_CONFIG };
  }

  core.info(`Loading config from ${filePath}`);
  let raw: Record<string, unknown>;

  try {
    const text = readFileSync(filePath, "utf-8");
    raw = parseYAML(text);
  } catch (err) {
    throw new Error(
      `Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const errors = validateRawConfig(raw);
  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }

  const merged = deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    raw,
  ) as unknown as AltimateConfig;

  // Force version to 1
  merged.version = 1;

  return merged;
}

/**
 * Action inputs that can override config file values. These come from the
 * GitHub Action `with:` block.
 */
export interface ActionInputOverrides {
  severity_threshold?: string;
  dialect?: string;
  fail_on?: string;
  comment_mode?: string;
  max_files?: number;
  include?: string;
  exclude?: string;
}

/**
 * Merge action inputs on top of a loaded config. Action inputs take precedence
 * over the config file (which takes precedence over defaults).
 *
 * This allows users to set base config in `.altimate.yml` and override
 * specific values per-workflow via the action's `with:` block.
 */
export function mergeWithInputs(
  config: AltimateConfig,
  inputs: ActionInputOverrides,
): AltimateConfig {
  const result = structuredClone(config);

  if (inputs.severity_threshold && VALID_SEVERITIES.has(inputs.severity_threshold as Severity)) {
    result.sql_review.severity_threshold = inputs.severity_threshold as Severity;
  }

  if (inputs.dialect && VALID_DIALECTS.has(inputs.dialect)) {
    result.dialect = inputs.dialect as Dialect;
  }

  if (inputs.comment_mode && VALID_COMMENT_MODES.has(inputs.comment_mode)) {
    result.comment.mode = inputs.comment_mode as CommentMode;
  }

  if (inputs.include) {
    result.sql_review.include = inputs.include
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (inputs.exclude) {
    result.sql_review.exclude = inputs.exclude
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (inputs.max_files !== undefined && inputs.max_files > 0) {
    result.comment.max_issues_shown = inputs.max_files;
  }

  return result;
}
