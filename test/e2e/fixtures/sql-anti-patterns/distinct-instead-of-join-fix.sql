-- Anti-pattern: DISTINCT used to mask a bad join that produces duplicates
-- Rather than fixing the join condition, DISTINCT hides the problem
-- and adds a costly sort/hash operation.
SELECT DISTINCT
    o.order_id,
    o.order_date,
    c.customer_name
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
JOIN order_items oi ON o.order_id = oi.order_id;
