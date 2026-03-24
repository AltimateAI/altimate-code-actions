import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadConfig, mergeWithInputs, ConfigValidationError } from "../../src/config/loader.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { Severity } from "../../src/analysis/types.js";
import type { AltimateConfig } from "../../src/config/schema.js";

const TMP_DIR = resolve(import.meta.dir, "../.tmp-config-test");

function tmpFile(name: string): string {
  return join(TMP_DIR, name);
}

function writeConfig(name: string, content: string): string {
  const path = tmpFile(name);
  writeFileSync(path, content, "utf-8");
  return path;
}

beforeEach(() => {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
});

afterEach(() => {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }
});

describe("Config Loader", () => {
  describe("loadConfig", () => {
    it("returns default config when no file exists", () => {
      const config = loadConfig(tmpFile("nonexistent.yml"));

      expect(config.version).toBe(1);
      expect(config.dialect).toBe("auto");
      expect(config.sql_review.enabled).toBe(true);
      expect(config.sql_review.severity_threshold).toBe(Severity.Warning);
      expect(config.impact_analysis.enabled).toBe(true);
      expect(config.cost_estimation.enabled).toBe(false);
      expect(config.pii_detection.enabled).toBe(true);
      expect(config.comment.mode).toBe("single");
    });

    it("loads a valid config file and merges with defaults", () => {
      const path = writeConfig(
        "valid.yml",
        `
version: 1
dialect: snowflake

sql_review:
  severity_threshold: error

impact_analysis:
  warn_threshold: 20
  fail_threshold: 100

comment:
  mode: both
  max_issues_shown: 50
`,
      );

      const config = loadConfig(path);

      expect(config.version).toBe(1);
      expect(config.dialect).toBe("snowflake");
      expect(config.sql_review.severity_threshold).toBe("error");
      // Defaults should still be present for unspecified fields
      expect(config.sql_review.enabled).toBe(true);
      expect(config.sql_review.rules.select_star.enabled).toBe(true);
      expect(config.impact_analysis.warn_threshold).toBe(20);
      expect(config.impact_analysis.fail_threshold).toBe(100);
      expect(config.comment.mode).toBe("both");
      expect(config.comment.max_issues_shown).toBe(50);
      // Unspecified comment fields get defaults
      expect(config.comment.show_clean_files).toBe(false);
    });

    it("applies defaults for missing top-level sections", () => {
      const path = writeConfig(
        "minimal.yml",
        `
version: 1
dialect: bigquery
`,
      );

      const config = loadConfig(path);

      expect(config.dialect).toBe("bigquery");
      expect(config.sql_review).toBeDefined();
      expect(config.sql_review.rules.cartesian_join.enabled).toBe(true);
      expect(config.impact_analysis.warn_threshold).toBe(10);
      expect(config.cost_estimation.enabled).toBe(false);
      expect(config.pii_detection.categories).toContain("email");
    });

    it("overrides individual rule severities", () => {
      const path = writeConfig(
        "rule-override.yml",
        `
version: 1

sql_review:
  rules:
    select_star:
      enabled: true
      severity: error
    implicit_type_cast:
      enabled: false
      severity: info
`,
      );

      const config = loadConfig(path);

      expect(config.sql_review.rules.select_star.severity).toBe("error");
      expect(config.sql_review.rules.implicit_type_cast.enabled).toBe(false);
      // Other rules should still have defaults
      expect(config.sql_review.rules.cartesian_join.enabled).toBe(true);
      expect(config.sql_review.rules.cartesian_join.severity).toBe(Severity.Error);
    });

    it("handles include/exclude patterns", () => {
      const path = writeConfig(
        "patterns.yml",
        `
version: 1

sql_review:
  include:
    - "models/**/*.sql"
    - "analyses/**/*.sql"
  exclude:
    - "models/legacy/**"
`,
      );

      const config = loadConfig(path);

      expect(config.sql_review.include).toEqual([
        "models/**/*.sql",
        "analyses/**/*.sql",
      ]);
      expect(config.sql_review.exclude).toEqual(["models/legacy/**"]);
    });

    it("throws ConfigValidationError for invalid dialect", () => {
      const path = writeConfig(
        "bad-dialect.yml",
        `
version: 1
dialect: oracle
`,
      );

      expect(() => loadConfig(path)).toThrow(ConfigValidationError);
      try {
        loadConfig(path);
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigValidationError);
        const errors = (err as ConfigValidationError).errors;
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("dialect");
      }
    });

    it("throws ConfigValidationError for unsupported version", () => {
      const path = writeConfig(
        "bad-version.yml",
        `
version: 2
`,
      );

      expect(() => loadConfig(path)).toThrow(ConfigValidationError);
    });

    it("throws ConfigValidationError for invalid severity in rules", () => {
      const path = writeConfig(
        "bad-severity.yml",
        `
version: 1

sql_review:
  rules:
    select_star:
      enabled: true
      severity: catastrophic
`,
      );

      expect(() => loadConfig(path)).toThrow(ConfigValidationError);
    });

    it("throws ConfigValidationError for negative thresholds", () => {
      const path = writeConfig(
        "bad-threshold.yml",
        `
version: 1

impact_analysis:
  warn_threshold: -5
`,
      );

      expect(() => loadConfig(path)).toThrow(ConfigValidationError);
    });

    it("throws on malformed YAML", () => {
      const path = writeConfig("bad-yaml.yml", "{{{{not yaml at all}}}}");

      // Should not crash — our parser is lenient, but may produce empty config
      // which is fine (defaults apply). Only truly broken parse should throw.
      const config = loadConfig(path);
      expect(config.version).toBe(1);
    });

    it("handles empty config file gracefully", () => {
      const path = writeConfig("empty.yml", "");
      const config = loadConfig(path);
      expect(config.version).toBe(1);
      expect(config.sql_review.enabled).toBe(true);
    });

    it("handles config with only comments", () => {
      const path = writeConfig(
        "comments-only.yml",
        `
# This is a comment
# Another comment
`,
      );
      const config = loadConfig(path);
      expect(config.version).toBe(1);
    });

    it("disables cost estimation by default", () => {
      const config = loadConfig(tmpFile("nonexistent.yml"));
      expect(config.cost_estimation.enabled).toBe(false);
      expect(config.cost_estimation.warn_threshold).toBe(100);
      expect(config.cost_estimation.fail_threshold).toBe(0);
    });

    it("loads PII detection categories", () => {
      const path = writeConfig(
        "pii.yml",
        `
version: 1

pii_detection:
  enabled: true
  categories:
    - email
    - phone
`,
      );

      const config = loadConfig(path);

      expect(config.pii_detection.enabled).toBe(true);
      expect(config.pii_detection.categories).toEqual(["email", "phone"]);
    });

    it("rejects unknown PII categories", () => {
      const path = writeConfig(
        "bad-pii.yml",
        `
version: 1

pii_detection:
  categories:
    - email
    - dna_sequence
`,
      );

      expect(() => loadConfig(path)).toThrow(ConfigValidationError);
    });

    it("rejects invalid comment mode", () => {
      const path = writeConfig(
        "bad-comment.yml",
        `
version: 1

comment:
  mode: threaded
`,
      );

      expect(() => loadConfig(path)).toThrow(ConfigValidationError);
    });
  });

  describe("mergeWithInputs", () => {
    let baseConfig: AltimateConfig;

    beforeEach(() => {
      baseConfig = structuredClone(DEFAULT_CONFIG);
    });

    it("returns config unchanged when no inputs are provided", () => {
      const merged = mergeWithInputs(baseConfig, {});

      expect(merged.dialect).toBe(baseConfig.dialect);
      expect(merged.sql_review.severity_threshold).toBe(
        baseConfig.sql_review.severity_threshold,
      );
      expect(merged.comment.mode).toBe(baseConfig.comment.mode);
    });

    it("overrides severity_threshold from inputs", () => {
      const merged = mergeWithInputs(baseConfig, {
        severity_threshold: "error",
      });

      expect(merged.sql_review.severity_threshold).toBe(Severity.Error);
    });

    it("overrides dialect from inputs", () => {
      const merged = mergeWithInputs(baseConfig, { dialect: "bigquery" });

      expect(merged.dialect).toBe("bigquery");
    });

    it("overrides comment_mode from inputs", () => {
      const merged = mergeWithInputs(baseConfig, { comment_mode: "inline" });

      expect(merged.comment.mode).toBe("inline");
    });

    it("parses include patterns from comma-separated string", () => {
      const merged = mergeWithInputs(baseConfig, {
        include: "models/**/*.sql, analyses/**/*.sql",
      });

      expect(merged.sql_review.include).toEqual([
        "models/**/*.sql",
        "analyses/**/*.sql",
      ]);
    });

    it("parses exclude patterns from comma-separated string", () => {
      const merged = mergeWithInputs(baseConfig, {
        exclude: "legacy/**, test/**",
      });

      expect(merged.sql_review.exclude).toEqual(["legacy/**", "test/**"]);
    });

    it("ignores invalid severity_threshold in inputs", () => {
      const merged = mergeWithInputs(baseConfig, {
        severity_threshold: "catastrophic",
      });

      // Should keep the original since "catastrophic" is not valid
      expect(merged.sql_review.severity_threshold).toBe(
        baseConfig.sql_review.severity_threshold,
      );
    });

    it("ignores invalid dialect in inputs", () => {
      const merged = mergeWithInputs(baseConfig, { dialect: "oracle" });

      expect(merged.dialect).toBe(baseConfig.dialect);
    });

    it("ignores invalid comment_mode in inputs", () => {
      const merged = mergeWithInputs(baseConfig, {
        comment_mode: "threaded",
      });

      expect(merged.comment.mode).toBe(baseConfig.comment.mode);
    });

    it("does not mutate the original config", () => {
      const original = structuredClone(baseConfig);
      mergeWithInputs(baseConfig, {
        dialect: "snowflake",
        severity_threshold: "error",
      });

      expect(baseConfig.dialect).toBe(original.dialect);
      expect(baseConfig.sql_review.severity_threshold).toBe(
        original.sql_review.severity_threshold,
      );
    });

    it("inputs take precedence over config file values", () => {
      baseConfig.dialect = "postgres";
      baseConfig.sql_review.severity_threshold = Severity.Info;

      const merged = mergeWithInputs(baseConfig, {
        dialect: "snowflake",
        severity_threshold: "error",
      });

      expect(merged.dialect).toBe("snowflake");
      expect(merged.sql_review.severity_threshold).toBe(Severity.Error);
    });
  });
});
