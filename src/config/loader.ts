import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as core from "@actions/core";
import { Severity } from "../analysis/types.js";
import type { CommentMode } from "../analysis/types.js";
import { DEFAULT_CONFIG } from "./defaults.js";
import type {
  AltimateConfig,
  Dialect,
} from "./schema.js";

/**
 * Minimal YAML parser — handles the flat/nested key-value structures we need
 * without pulling in a full YAML library. Supports:
 *   - Scalars (strings, numbers, booleans)
 *   - Nested objects via indentation
 *   - Arrays with `- item` syntax
 *   - Comments with `#`
 *
 * For production use this should be replaced with `yaml` or `js-yaml`, but
 * keeping zero runtime deps for the action is preferable.
 */
function parseYAML(text: string): Record<string, unknown> {
  const rawLines = text.split("\n");
  const root: Record<string, unknown> = {};

  // Stack tracks nested objects: { indent, obj, key (if this obj is a value under a key) }
  const stack: Array<{
    indent: number;
    obj: Record<string, unknown>;
  }> = [{ indent: -2, obj: root }];

  // Track current array context: which parent obj, which key, and at what indent
  let arrayCtx: {
    parent: Record<string, unknown>;
    key: string;
    indent: number;
  } | null = null;

  for (const rawLine of rawLines) {
    // Strip inline comments (not inside quotes — good enough for config)
    let line = rawLine;
    if (!line.trimStart().startsWith("#")) {
      const commentIdx = line.indexOf(" #");
      if (commentIdx >= 0) {
        line = line.slice(0, commentIdx);
      }
    }

    // Skip blank lines and full-line comments
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trimStart();

    // If indent drops below current array context, clear it
    if (arrayCtx && indent < arrayCtx.indent) {
      arrayCtx = null;
    }

    // ── Array item: "- value" or "- key: value, key: value" ──
    if (trimmed.startsWith("- ")) {
      const itemContent = trimmed.slice(2).trim();

      // If we have no array context yet, we need to create one.
      // The array should be the value of the last key set on the parent at
      // the indentation level just above this one.
      if (!arrayCtx || indent !== arrayCtx.indent) {
        // Pop stack so the top is the correct parent for this indent
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }

        // Strategy: look at the current top of stack. If it's an empty object
        // placeholder (created by "key:" with no value), then the PARENT of
        // this stack entry owns the key. Pop one more and convert that key's
        // value from {} to [].
        let found = false;
        const topEntry = stack[stack.length - 1];

        if (
          stack.length > 1 &&
          Object.keys(topEntry.obj).length === 0
        ) {
          // This empty object is the value of some key in the parent
          const parentObj = stack[stack.length - 2].obj;
          const keys = Object.keys(parentObj);
          for (let k = keys.length - 1; k >= 0; k--) {
            if (parentObj[keys[k]] === topEntry.obj) {
              parentObj[keys[k]] = [];
              // Pop the empty obj from the stack since it's now an array
              stack.pop();
              arrayCtx = { parent: parentObj, key: keys[k], indent };
              found = true;
              break;
            }
          }
        }

        if (!found) {
          // Look for an empty object placeholder among the top's own keys
          const parentObj = topEntry.obj;
          const keys = Object.keys(parentObj);
          for (let k = keys.length - 1; k >= 0; k--) {
            const val = parentObj[keys[k]];
            if (
              typeof val === "object" &&
              val !== null &&
              !Array.isArray(val) &&
              Object.keys(val).length === 0
            ) {
              parentObj[keys[k]] = [];
              arrayCtx = { parent: parentObj, key: keys[k], indent };
              found = true;
              break;
            }
          }
        }

        if (!found) {
          // Cannot determine which key this array belongs to — skip
          continue;
        }
      }

      const arr = arrayCtx!.parent[arrayCtx!.key] as unknown[];

      // Check if it's a map item (has colon with a key-like prefix)
      const mapMatch = itemContent.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/,
      );
      if (mapMatch) {
        const mapObj: Record<string, unknown> = {};
        parseInlineMap(itemContent, mapObj);
        arr.push(mapObj);
      } else {
        arr.push(parseScalar(itemContent));
      }
      continue;
    }

    // ── Key-value pair: "key: value" or "key:" ──
    const kvMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawValue = kvMatch[2].trim();

      // Clear array context when we encounter a non-array line
      arrayCtx = null;

      // Pop stack to find the right parent for this indent level
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      const parent = stack[stack.length - 1].obj;

      if (rawValue === "" || rawValue === "|" || rawValue === ">") {
        // Nested object or block scalar — create object placeholder
        // (may be converted to array if "- " items follow)
        const child: Record<string, unknown> = {};
        parent[key] = child;
        stack.push({ indent, obj: child });
      } else if (rawValue.startsWith("[") || rawValue.startsWith("{")) {
        // Inline JSON array or object
        try {
          parent[key] = JSON.parse(rawValue);
        } catch {
          parent[key] = rawValue;
        }
      } else {
        parent[key] = parseScalar(rawValue);
      }
      continue;
    }
  }

  return root;
}

function parseInlineMap(text: string, target: Record<string, unknown>): void {
  // Parse "key: value" pairs separated by newlines or within a single line
  const parts = text.split(/,\s*/);
  for (const part of parts) {
    const m = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/);
    if (m) {
      target[m[1]] = parseScalar(m[2].trim());
    }
  }
}

function parseScalar(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return "";
  // Strip surrounding quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  const num = Number(value);
  if (!isNaN(num) && value !== "") return num;
  return value;
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
  const filePath = resolve(configPath ?? ".altimate.yml");

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
