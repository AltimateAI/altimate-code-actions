-- Databricks: Unity Catalog three-level namespace
-- catalog.schema.table pattern
SELECT
    o.order_id,
    o.order_date,
    c.customer_name,
    p.product_name,
    oi.quantity,
    oi.unit_price
FROM main.gold.fct_orders o
INNER JOIN main.gold.dim_customers c ON o.customer_id = c.customer_id
INNER JOIN main.gold.fct_order_items oi ON o.order_id = oi.order_id
INNER JOIN main.gold.dim_products p ON oi.product_id = p.product_id
WHERE o.order_date >= '2024-01-01'
  AND c.customer_segment = 'enterprise'
ORDER BY o.order_date DESC
LIMIT 1000;
