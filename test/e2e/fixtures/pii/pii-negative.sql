-- PII NEGATIVE: Queries with safe column names, no PII exposure

-- Aggregated metrics only
SELECT
    DATE_TRUNC('month', order_date) AS order_month,
    COUNT(DISTINCT customer_id) AS unique_customers,
    COUNT(order_id) AS total_orders,
    SUM(total_amount) AS monthly_revenue
FROM orders
WHERE order_date >= '2024-01-01'
GROUP BY DATE_TRUNC('month', order_date)
ORDER BY order_month;

-- Product analytics
SELECT
    product_category,
    product_subcategory,
    COUNT(*) AS units_sold,
    AVG(unit_price) AS avg_price,
    SUM(revenue) AS total_revenue
FROM sales_facts
GROUP BY product_category, product_subcategory
ORDER BY total_revenue DESC;

-- System metrics
SELECT
    service_name,
    endpoint_path,
    COUNT(*) AS request_count,
    AVG(response_time_ms) AS avg_latency,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) AS p99_latency
FROM api_metrics
WHERE metric_date >= '2024-06-01'
GROUP BY service_name, endpoint_path
ORDER BY request_count DESC;

-- Inventory levels
SELECT
    warehouse_id,
    sku,
    product_name,
    quantity_on_hand,
    reorder_point,
    CASE WHEN quantity_on_hand <= reorder_point THEN 'reorder' ELSE 'ok' END AS stock_status
FROM inventory
ORDER BY stock_status, quantity_on_hand;

-- Feature flags
SELECT
    feature_name,
    is_enabled,
    rollout_percentage,
    created_at,
    updated_at
FROM feature_flags
WHERE is_enabled = TRUE
ORDER BY feature_name;
