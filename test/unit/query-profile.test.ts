import { describe, it, expect } from "bun:test";
import { extractQueryProfile } from "../../src/analysis/query-profile.js";

describe("extractQueryProfile", () => {
  it("extracts basic metadata from a simple query", () => {
    const sql = `
      SELECT id, name, amount
      FROM orders
      WHERE status = 'active'
    `;
    const profile = extractQueryProfile("stg_orders.sql", sql);

    expect(profile.file).toBe("stg_orders.sql");
    expect(profile.complexity).toBe("Low");
    expect(profile.tablesReferenced).toBe(1);
    expect(profile.joinCount).toBe(0);
    expect(profile.joinTypes).toEqual([]);
    expect(profile.hasAggregation).toBe(false);
    expect(profile.hasSubquery).toBe(false);
    expect(profile.hasWindowFunction).toBe(false);
    expect(profile.hasCTE).toBe(false);
  });

  it("detects JOINs and their types", () => {
    const sql = `
      SELECT o.id, c.name
      FROM orders o
      INNER JOIN customers c ON o.customer_id = c.id
      LEFT JOIN payments p ON o.id = p.order_id
    `;
    const profile = extractQueryProfile("model.sql", sql);

    expect(profile.joinCount).toBe(2);
    expect(profile.joinTypes).toContain("INNER");
    expect(profile.joinTypes).toContain("LEFT");
    expect(profile.tablesReferenced).toBe(3);
  });

  it("detects CTEs", () => {
    const sql = `
      WITH active_orders AS (
        SELECT * FROM orders WHERE status = 'active'
      )
      SELECT * FROM active_orders
    `;
    const profile = extractQueryProfile("model.sql", sql);

    expect(profile.hasCTE).toBe(true);
  });

  it("detects aggregation via GROUP BY", () => {
    const sql = `
      SELECT customer_id, COUNT(*) as order_count
      FROM orders
      GROUP BY customer_id
    `;
    const profile = extractQueryProfile("model.sql", sql);

    expect(profile.hasAggregation).toBe(true);
  });

  it("detects aggregation via aggregate functions without GROUP BY", () => {
    const sql = `SELECT COUNT(*) as total FROM orders`;
    const profile = extractQueryProfile("model.sql", sql);

    expect(profile.hasAggregation).toBe(true);
  });

  it("detects subqueries", () => {
    const sql = `
      SELECT *
      FROM orders
      WHERE customer_id IN (SELECT id FROM customers WHERE active = true)
    `;
    const profile = extractQueryProfile("model.sql", sql);

    expect(profile.hasSubquery).toBe(true);
  });

  it("detects window functions", () => {
    const sql = `
      SELECT id, amount,
        ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at) as rn
      FROM orders
    `;
    const profile = extractQueryProfile("model.sql", sql);

    expect(profile.hasWindowFunction).toBe(true);
  });

  it("classifies complex query as High", () => {
    const sql = `
      WITH base AS (
        SELECT * FROM orders
      ),
      enriched AS (
        SELECT b.*, c.name
        FROM base b
        INNER JOIN customers c ON b.customer_id = c.id
        LEFT JOIN payments p ON b.id = p.order_id
        LEFT JOIN refunds r ON b.id = r.order_id
      )
      SELECT
        customer_id,
        COUNT(*) as order_count,
        SUM(amount) as total_amount,
        ROW_NUMBER() OVER (ORDER BY SUM(amount) DESC) as rank
      FROM enriched
      WHERE customer_id IN (SELECT id FROM vip_customers)
      GROUP BY customer_id
      HAVING COUNT(*) > 5
      UNION ALL
      SELECT customer_id, 0, 0, 0
      FROM inactive_customers
    `;
    const profile = extractQueryProfile("complex.sql", sql);

    expect(profile.complexity).toBe("High");
    expect(profile.hasCTE).toBe(true);
    expect(profile.hasAggregation).toBe(true);
    expect(profile.hasWindowFunction).toBe(true);
    expect(profile.hasSubquery).toBe(true);
  });

  it("classifies medium complexity query", () => {
    const sql = `
      SELECT o.id, c.name, p.amount
      FROM orders o
      INNER JOIN customers c ON o.customer_id = c.id
      LEFT JOIN payments p ON o.id = p.order_id
      GROUP BY o.id, c.name, p.amount
    `;
    const profile = extractQueryProfile("medium.sql", sql);

    expect(profile.complexity).toBe("Medium");
  });

  it("handles bare JOIN as INNER", () => {
    const sql = `
      SELECT * FROM orders o
      JOIN customers c ON o.customer_id = c.id
    `;
    const profile = extractQueryProfile("model.sql", sql);

    expect(profile.joinCount).toBe(1);
    expect(profile.joinTypes).toContain("INNER");
  });

  it("detects CROSS JOIN", () => {
    const sql = `
      SELECT * FROM dates d
      CROSS JOIN products p
    `;
    const profile = extractQueryProfile("model.sql", sql);

    expect(profile.joinCount).toBe(1);
    expect(profile.joinTypes).toContain("CROSS");
  });

  it("deduplicates join types", () => {
    const sql = `
      SELECT *
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN payments p ON o.id = p.order_id
    `;
    const profile = extractQueryProfile("model.sql", sql);

    expect(profile.joinCount).toBe(2);
    // joinTypes should have unique values
    expect(profile.joinTypes).toEqual(["LEFT"]);
  });
});
