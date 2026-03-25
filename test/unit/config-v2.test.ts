import { describe, it, expect } from "bun:test";
import {
  buildCheckOptionsFromV2,
  type AltimateConfigV2,
  type LintCheckConfig,
  type PolicyCheckConfig,
  type PIICheckConfig,
} from "../../src/config/schema.js";
import { Severity } from "../../src/analysis/types.js";

function makeV2Config(overrides?: Partial<AltimateConfigV2>): AltimateConfigV2 {
  return {
    version: 2,
    checks: {
      lint: { enabled: true },
      validate: { enabled: true },
      safety: { enabled: true },
      policy: { enabled: false },
      pii: { enabled: false },
      semantic: { enabled: false },
      grade: { enabled: false },
    },
    dialect: "auto",
    ...overrides,
  };
}

describe("buildCheckOptionsFromV2", () => {
  it("collects enabled check names", () => {
    const config = makeV2Config();
    const options = buildCheckOptionsFromV2(config);
    expect(options.checks).toEqual(["lint", "validate", "safety"]);
  });

  it("returns empty checks when all disabled", () => {
    const config = makeV2Config({
      checks: {
        lint: { enabled: false },
        validate: { enabled: false },
        safety: { enabled: false },
        policy: { enabled: false },
        pii: { enabled: false },
        semantic: { enabled: false },
        grade: { enabled: false },
      },
    });
    const options = buildCheckOptionsFromV2(config);
    expect(options.checks).toEqual([]);
  });

  it("passes through dialect when not auto", () => {
    const config = makeV2Config({ dialect: "snowflake" });
    const options = buildCheckOptionsFromV2(config);
    expect(options.dialect).toBe("snowflake");
  });

  it("omits dialect when auto", () => {
    const config = makeV2Config({ dialect: "auto" });
    const options = buildCheckOptionsFromV2(config);
    expect(options.dialect).toBeUndefined();
  });

  it("passes through policy file path", () => {
    const config = makeV2Config({
      checks: {
        lint: { enabled: true },
        validate: { enabled: false },
        safety: { enabled: false },
        policy: { enabled: true, file: ".altimate-policy.yml" },
        pii: { enabled: false },
        semantic: { enabled: false },
        grade: { enabled: false },
      },
    });
    const options = buildCheckOptionsFromV2(config);
    expect(options.policyPath).toBe(".altimate-policy.yml");
    expect(options.checks).toContain("policy");
  });

  it("passes through schema path", () => {
    const config = makeV2Config({
      schema: {
        source: "files",
        paths: ["schema/warehouse.yml"],
      },
    });
    const options = buildCheckOptionsFromV2(config);
    expect(options.schemaPath).toBe("schema/warehouse.yml");
  });

  it("omits schema path when not configured", () => {
    const config = makeV2Config();
    const options = buildCheckOptionsFromV2(config);
    expect(options.schemaPath).toBeUndefined();
  });

  // -------------------------------------------------------------------
  // Additional v2 config tests
  // -------------------------------------------------------------------

  it("collects all enabled checks when everything is on", () => {
    const config = makeV2Config({
      checks: {
        lint: { enabled: true },
        validate: { enabled: true },
        safety: { enabled: true },
        policy: { enabled: true },
        pii: { enabled: true },
        semantic: { enabled: true },
        grade: { enabled: true },
      },
    });
    const options = buildCheckOptionsFromV2(config);
    expect(options.checks).toEqual([
      "lint",
      "validate",
      "safety",
      "policy",
      "pii",
      "semantic",
      "grade",
    ]);
  });

  it("collects only enabled checks in mixed config", () => {
    const config = makeV2Config({
      checks: {
        lint: { enabled: true },
        validate: { enabled: false },
        safety: { enabled: true },
        policy: { enabled: false },
        pii: { enabled: true },
        semantic: { enabled: false },
        grade: { enabled: false },
      },
    });
    const options = buildCheckOptionsFromV2(config);
    expect(options.checks).toEqual(["lint", "safety", "pii"]);
  });

  it("passes through bigquery dialect", () => {
    const config = makeV2Config({ dialect: "bigquery" });
    const options = buildCheckOptionsFromV2(config);
    expect(options.dialect).toBe("bigquery");
  });

  it("passes through postgres dialect", () => {
    const config = makeV2Config({ dialect: "postgres" });
    const options = buildCheckOptionsFromV2(config);
    expect(options.dialect).toBe("postgres");
  });

  it("passes through redshift dialect", () => {
    const config = makeV2Config({ dialect: "redshift" });
    const options = buildCheckOptionsFromV2(config);
    expect(options.dialect).toBe("redshift");
  });

  it("uses first schema path when multiple are provided", () => {
    const config = makeV2Config({
      schema: {
        source: "files",
        paths: ["schema/first.yml", "schema/second.yml", "schema/third.yml"],
      },
    });
    const options = buildCheckOptionsFromV2(config);
    expect(options.schemaPath).toBe("schema/first.yml");
  });

  it("omits schema path when schema has no paths", () => {
    const config = makeV2Config({
      schema: {
        source: "dbt",
        dbt: { manifest_path: "target/manifest.json" },
      },
    });
    const options = buildCheckOptionsFromV2(config);
    expect(options.schemaPath).toBeUndefined();
  });

  it("omits schema path when paths array is empty", () => {
    const config = makeV2Config({
      schema: {
        source: "files",
        paths: [],
      },
    });
    const options = buildCheckOptionsFromV2(config);
    expect(options.schemaPath).toBeUndefined();
  });

  it("omits policy path when policy has no file", () => {
    const config = makeV2Config({
      checks: {
        lint: { enabled: true },
        validate: { enabled: false },
        safety: { enabled: false },
        policy: { enabled: true },
        pii: { enabled: false },
        semantic: { enabled: false },
        grade: { enabled: false },
      },
    });
    const options = buildCheckOptionsFromV2(config);
    expect(options.checks).toContain("policy");
    expect(options.policyPath).toBeUndefined();
  });

  it("handles missing optional fields gracefully", () => {
    // Minimal v2 config — no schema, no policy, no dialect
    const config: AltimateConfigV2 = {
      version: 2,
      checks: {
        lint: { enabled: true },
        validate: { enabled: false },
        safety: { enabled: false },
        policy: { enabled: false },
        pii: { enabled: false },
        semantic: { enabled: false },
        grade: { enabled: false },
      },
    };
    const options = buildCheckOptionsFromV2(config);
    expect(options.checks).toEqual(["lint"]);
    expect(options.schemaPath).toBeUndefined();
    expect(options.policyPath).toBeUndefined();
    expect(options.dialect).toBeUndefined();
  });

  it("omits dialect when dialect is undefined", () => {
    const config: AltimateConfigV2 = {
      version: 2,
      checks: {
        lint: { enabled: true },
        validate: { enabled: false },
        safety: { enabled: false },
        policy: { enabled: false },
        pii: { enabled: false },
        semantic: { enabled: false },
        grade: { enabled: false },
      },
      // dialect intentionally omitted
    };
    const options = buildCheckOptionsFromV2(config);
    // dialect is undefined, which is not "auto", so the code path is:
    // config.dialect !== "auto" ? config.dialect : undefined
    // undefined !== "auto" is true, so it returns undefined
    expect(options.dialect).toBeUndefined();
  });
});

describe("V2 config type structure", () => {
  it("LintCheckConfig supports disabled_rules", () => {
    const lint: LintCheckConfig = {
      enabled: true,
      disabled_rules: ["L001", "L009"],
    };
    expect(lint.disabled_rules).toEqual(["L001", "L009"]);
  });

  it("LintCheckConfig supports severity_overrides", () => {
    const lint: LintCheckConfig = {
      enabled: true,
      severity_overrides: {
        L002: Severity.Error,
        L012: Severity.Critical,
      },
    };
    expect(lint.severity_overrides).toBeDefined();
    expect(lint.severity_overrides!["L002"]).toBe(Severity.Error);
    expect(lint.severity_overrides!["L012"]).toBe(Severity.Critical);
  });

  it("PolicyCheckConfig supports file path", () => {
    const policy: PolicyCheckConfig = {
      enabled: true,
      file: ".altimate-policy.yml",
    };
    expect(policy.file).toBe(".altimate-policy.yml");
  });

  it("PIICheckConfig supports categories", () => {
    const pii: PIICheckConfig = {
      enabled: true,
      categories: ["email", "ssn", "phone"],
    };
    expect(pii.categories).toEqual(["email", "ssn", "phone"]);
  });

  it("AltimateConfigV2 version is 2", () => {
    const config = makeV2Config();
    expect(config.version).toBe(2);
  });

  it("AltimateConfigV2 defaults: lint enabled, safety enabled, policy disabled", () => {
    const config = makeV2Config();
    expect(config.checks.lint.enabled).toBe(true);
    expect(config.checks.safety.enabled).toBe(true);
    expect(config.checks.policy.enabled).toBe(false);
    expect(config.checks.semantic.enabled).toBe(false);
    expect(config.checks.grade.enabled).toBe(false);
  });

  it("inline policy is a generic Record", () => {
    const config = makeV2Config({
      policy: {
        rules: [{ name: "no_drop", pattern: "\\bDROP\\b", message: "no drop", severity: "error" }],
      },
    });
    expect(config.policy).toBeDefined();
    expect((config.policy as Record<string, unknown>)["rules"]).toBeDefined();
  });

  it("empty policy section is handled", () => {
    const config = makeV2Config({ policy: {} });
    expect(config.policy).toBeDefined();
    expect(Object.keys(config.policy!)).toHaveLength(0);
  });
});
