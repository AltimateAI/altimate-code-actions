import { describe, it, expect } from "bun:test";
import { buildCheckOptionsFromV2 } from "../../src/config/schema.js";
import type { AltimateConfigV2 } from "../../src/config/schema.js";

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
});
