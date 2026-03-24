-- Clean: Parameterized date boundaries (deterministic, testable)
-- In production, these would come from a scheduling framework
-- or be passed as variables. Here they are explicit literals.
SELECT
    DATE_TRUNC('month', order_date) AS order_month,
    COUNT(DISTINCT customer_id) AS unique_customers,
    COUNT(order_id) AS total_orders,
    SUM(total_amount) AS monthly_revenue,
    SUM(total_amount) / COUNT(order_id) AS avg_order_value
FROM orders
WHERE order_date >= '2024-01-01'
  AND order_date < '2024-07-01'
GROUP BY DATE_TRUNC('month', order_date)
ORDER BY order_month;
