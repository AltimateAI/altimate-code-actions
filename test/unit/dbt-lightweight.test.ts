import { describe, it, expect, beforeAll } from "bun:test";
import { join } from "node:path";
import {
  extractRefs,
  extractSources,
  findSQLFiles,
  buildLightweightDAG,
  analyzeLightweightImpact,
} from "../../src/context/dbt-lightweight.js";
import type { ChangedFile } from "../../src/analysis/types.js";

const JAFFLE_SHOP = join(
  import.meta.dir,
  "..",
  "e2e",
  "fixtures",
  "jaffle-shop",
);

// ---------------------------------------------------------------------------
// extractRefs
// ---------------------------------------------------------------------------

describe("extractRefs", () => {
  it("extracts single-quoted refs", () => {
    const sql = "select * from {{ ref('stg_orders') }}";
    expect(extractRefs(sql)).toEqual(["stg_orders"]);
  });

  it("extracts double-quoted refs", () => {
    const sql = 'select * from {{ ref("stg_orders") }}';
    expect(extractRefs(sql)).toEqual(["stg_orders"]);
  });

  it("handles multiple refs", () => {
    const sql = `
      select * from {{ ref('stg_orders') }}
      join {{ ref('stg_customers') }} on 1=1
    `;
    expect(extractRefs(sql)).toEqual(["stg_orders", "stg_customers"]);
  });

  it("deduplicates refs", () => {
    const sql = `
      select * from {{ ref('stg_orders') }}
      union all
      select * from {{ ref('stg_orders') }}
    `;
    expect(extractRefs(sql)).toEqual(["stg_orders"]);
  });

  it("handles extra whitespace", () => {
    const sql = "select * from {{  ref(  'stg_orders'  )  }}";
    expect(extractRefs(sql)).toEqual(["stg_orders"]);
  });

  it("returns empty array when no refs", () => {
    const sql = "select 1 as id from raw_table";
    expect(extractRefs(sql)).toEqual([]);
  });

  it("ignores source() calls", () => {
    const sql = "select * from {{ source('ecom', 'raw_orders') }}";
    expect(extractRefs(sql)).toEqual([]);
  });

  it("handles mixed ref and source calls", () => {
    const sql = `
      select * from {{ ref('stg_orders') }}
      join {{ source('ecom', 'raw_customers') }} on 1=1
    `;
    expect(extractRefs(sql)).toEqual(["stg_orders"]);
  });
});

// ---------------------------------------------------------------------------
// extractSources
// ---------------------------------------------------------------------------

describe("extractSources", () => {
  it("extracts source references", () => {
    const sql = "select * from {{ source('ecom', 'raw_orders') }}";
    expect(extractSources(sql)).toEqual(["ecom.raw_orders"]);
  });

  it("handles double quotes", () => {
    const sql = 'select * from {{ source("ecom", "raw_orders") }}';
    expect(extractSources(sql)).toEqual(["ecom.raw_orders"]);
  });

  it("handles multiple sources", () => {
    const sql = `
      select * from {{ source('ecom', 'raw_orders') }}
      join {{ source('ecom', 'raw_customers') }} on 1=1
    `;
    expect(extractSources(sql)).toEqual([
      "ecom.raw_orders",
      "ecom.raw_customers",
    ]);
  });

  it("deduplicates sources", () => {
    const sql = `
      select * from {{ source('ecom', 'raw_orders') }}
      union all
      select * from {{ source('ecom', 'raw_orders') }}
    `;
    expect(extractSources(sql)).toEqual(["ecom.raw_orders"]);
  });

  it("returns empty array when no sources", () => {
    const sql = "select * from {{ ref('stg_orders') }}";
    expect(extractSources(sql)).toEqual([]);
  });

  it("handles extra whitespace", () => {
    const sql = "select * from {{  source(  'ecom' ,  'raw_orders'  )  }}";
    expect(extractSources(sql)).toEqual(["ecom.raw_orders"]);
  });
});

// ---------------------------------------------------------------------------
// findSQLFiles
// ---------------------------------------------------------------------------

describe("findSQLFiles", () => {
  it("finds all SQL files in jaffle-shop models", () => {
    const files = findSQLFiles(join(JAFFLE_SHOP, "models"));
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.every((f) => f.endsWith(".sql"))).toBe(true);
  });

  it("returns empty array for non-existent directory", () => {
    expect(findSQLFiles("/nonexistent/path")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildLightweightDAG
// ---------------------------------------------------------------------------

describe("buildLightweightDAG", () => {
  it("builds DAG from jaffle-shop fixture", () => {
    const dag = buildLightweightDAG(JAFFLE_SHOP);

    // Should find all models
    expect(dag.nodes.size).toBeGreaterThanOrEqual(10);

    // Verify known models exist
    expect(dag.nodes.has("stg_orders")).toBe(true);
    expect(dag.nodes.has("stg_customers")).toBe(true);
    expect(dag.nodes.has("orders")).toBe(true);
    expect(dag.nodes.has("customers")).toBe(true);
    expect(dag.nodes.has("order_items")).toBe(true);
  });

  it("builds correct parent-child relationships", () => {
    const dag = buildLightweightDAG(JAFFLE_SHOP);

    // stg_orders is referenced by order_items and orders
    const stgOrdersChildren = dag.childMap.get("stg_orders") ?? [];
    expect(stgOrdersChildren).toContain("order_items");
    expect(stgOrdersChildren).toContain("orders");

    // stg_customers is referenced by customers
    const stgCustomersChildren = dag.childMap.get("stg_customers") ?? [];
    expect(stgCustomersChildren).toContain("customers");

    // order_items is referenced by orders
    const orderItemsChildren = dag.childMap.get("order_items") ?? [];
    expect(orderItemsChildren).toContain("orders");
  });

  it("extracts refs correctly for each model", () => {
    const dag = buildLightweightDAG(JAFFLE_SHOP);

    // order_items refs: stg_order_items, stg_orders, stg_products, stg_supplies
    const orderItemsNode = dag.nodes.get("order_items");
    expect(orderItemsNode).toBeDefined();
    expect(orderItemsNode!.refs).toContain("stg_order_items");
    expect(orderItemsNode!.refs).toContain("stg_orders");
    expect(orderItemsNode!.refs).toContain("stg_products");
    expect(orderItemsNode!.refs).toContain("stg_supplies");

    // customers refs: stg_customers, orders
    const customersNode = dag.nodes.get("customers");
    expect(customersNode).toBeDefined();
    expect(customersNode!.refs).toContain("stg_customers");
    expect(customersNode!.refs).toContain("orders");
  });

  it("extracts sources for staging models", () => {
    const dag = buildLightweightDAG(JAFFLE_SHOP);

    const stgOrders = dag.nodes.get("stg_orders");
    expect(stgOrders).toBeDefined();
    expect(stgOrders!.sources).toContain("ecom.raw_orders");

    const stgCustomers = dag.nodes.get("stg_customers");
    expect(stgCustomers).toBeDefined();
    expect(stgCustomers!.sources).toContain("ecom.raw_customers");
  });
});

// ---------------------------------------------------------------------------
// analyzeLightweightImpact
// ---------------------------------------------------------------------------

describe("analyzeLightweightImpact", () => {
  it("returns null when no models found", () => {
    const result = analyzeLightweightImpact([], "/nonexistent/path");
    expect(result).toBeNull();
  });

  it("returns empty result when no changed files match models", () => {
    const changedFiles: ChangedFile[] = [
      {
        filename: "some/random/file.sql",
        status: "modified",
        additions: 1,
        deletions: 0,
      },
    ];

    const result = analyzeLightweightImpact(changedFiles, JAFFLE_SHOP);
    expect(result).toBeDefined();
    expect(result!.modifiedModels).toEqual([]);
    expect(result!.downstreamModels).toEqual([]);
    expect(result!.impactScore).toBe(0);
  });

  it("finds downstream models when staging model changes", () => {
    const changedFiles: ChangedFile[] = [
      {
        filename: "models/staging/stg_orders.sql",
        status: "modified",
        additions: 5,
        deletions: 2,
      },
    ];

    // Set GITHUB_WORKSPACE so path resolution works
    const origWorkspace = process.env.GITHUB_WORKSPACE;
    process.env.GITHUB_WORKSPACE = JAFFLE_SHOP;

    try {
      const result = analyzeLightweightImpact(changedFiles, JAFFLE_SHOP);
      expect(result).toBeDefined();
      expect(result!.modifiedModels).toContain("stg_orders");
      expect(result!.downstreamModels.length).toBeGreaterThan(0);
      // order_items and orders both ref stg_orders
      expect(result!.downstreamModels).toContain("order_items");
      expect(result!.downstreamModels).toContain("orders");
      // customers refs orders, so it should be downstream too
      expect(result!.downstreamModels).toContain("customers");
    } finally {
      if (origWorkspace !== undefined) {
        process.env.GITHUB_WORKSPACE = origWorkspace;
      } else {
        delete process.env.GITHUB_WORKSPACE;
      }
    }
  });

  it("produces edges for Mermaid rendering", () => {
    const changedFiles: ChangedFile[] = [
      {
        filename: "models/staging/stg_customers.sql",
        status: "modified",
        additions: 1,
        deletions: 0,
      },
    ];

    const origWorkspace = process.env.GITHUB_WORKSPACE;
    process.env.GITHUB_WORKSPACE = JAFFLE_SHOP;

    try {
      const result = analyzeLightweightImpact(changedFiles, JAFFLE_SHOP);
      expect(result).toBeDefined();
      expect(result!.edges).toBeDefined();
      expect(result!.edges!.length).toBeGreaterThan(0);

      // stg_customers -> customers edge should exist
      const hasEdge = result!.edges!.some(
        (e) => e.from === "stg_customers" && e.to === "customers",
      );
      expect(hasEdge).toBe(true);
    } finally {
      if (origWorkspace !== undefined) {
        process.env.GITHUB_WORKSPACE = origWorkspace;
      } else {
        delete process.env.GITHUB_WORKSPACE;
      }
    }
  });

  it("computes a non-zero impact score", () => {
    const changedFiles: ChangedFile[] = [
      {
        filename: "models/staging/stg_orders.sql",
        status: "modified",
        additions: 5,
        deletions: 2,
      },
    ];

    const origWorkspace = process.env.GITHUB_WORKSPACE;
    process.env.GITHUB_WORKSPACE = JAFFLE_SHOP;

    try {
      const result = analyzeLightweightImpact(changedFiles, JAFFLE_SHOP);
      expect(result).toBeDefined();
      expect(result!.impactScore).toBeGreaterThan(0);
    } finally {
      if (origWorkspace !== undefined) {
        process.env.GITHUB_WORKSPACE = origWorkspace;
      } else {
        delete process.env.GITHUB_WORKSPACE;
      }
    }
  });

  it("handles exposures and tests as empty (lightweight mode)", () => {
    const changedFiles: ChangedFile[] = [
      {
        filename: "models/staging/stg_orders.sql",
        status: "modified",
        additions: 1,
        deletions: 0,
      },
    ];

    const origWorkspace = process.env.GITHUB_WORKSPACE;
    process.env.GITHUB_WORKSPACE = JAFFLE_SHOP;

    try {
      const result = analyzeLightweightImpact(changedFiles, JAFFLE_SHOP);
      expect(result).toBeDefined();
      expect(result!.affectedExposures).toEqual([]);
      expect(result!.affectedTests).toEqual([]);
    } finally {
      if (origWorkspace !== undefined) {
        process.env.GITHUB_WORKSPACE = origWorkspace;
      } else {
        delete process.env.GITHUB_WORKSPACE;
      }
    }
  });
});
