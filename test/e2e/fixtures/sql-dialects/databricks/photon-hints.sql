-- Databricks: Query with broadcast join hint for small dimension table
SELECT /*+ BROADCAST(d) */
    f.order_date,
    d.product_category,
    COUNT(*) AS order_count,
    SUM(f.total_amount) AS total_revenue,
    AVG(f.total_amount) AS avg_order_value
FROM main.gold.fct_orders f
INNER JOIN main.gold.dim_products d ON f.product_id = d.product_id
WHERE f.order_date >= '2024-01-01'
  AND f.order_date < '2024-07-01'
GROUP BY f.order_date, d.product_category
ORDER BY f.order_date, total_revenue DESC;
