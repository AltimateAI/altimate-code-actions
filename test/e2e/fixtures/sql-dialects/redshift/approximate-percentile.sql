-- Redshift: Approximate percentile for large datasets
SELECT
    product_category,
    COUNT(*) AS order_count,
    SUM(total_amount) AS total_revenue,
    APPROXIMATE PERCENTILE_DISC(0.50) WITHIN GROUP (ORDER BY total_amount) AS median_order_value,
    APPROXIMATE PERCENTILE_DISC(0.90) WITHIN GROUP (ORDER BY total_amount) AS p90_order_value,
    APPROXIMATE PERCENTILE_DISC(0.99) WITHIN GROUP (ORDER BY total_amount) AS p99_order_value
FROM analytics.fct_orders o
INNER JOIN analytics.dim_products p ON o.product_id = p.product_id
WHERE o.order_date >= '2024-01-01'
GROUP BY product_category
ORDER BY total_revenue DESC;
