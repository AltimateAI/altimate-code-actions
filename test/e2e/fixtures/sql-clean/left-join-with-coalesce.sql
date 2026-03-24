-- Clean: LEFT JOIN with COALESCE for handling NULLs
SELECT
    c.customer_id,
    c.customer_name,
    COALESCE(agg.total_orders, 0) AS total_orders,
    COALESCE(agg.total_spent, 0.00) AS total_spent,
    COALESCE(agg.last_order_date, c.created_at) AS last_activity_date
FROM customers c
LEFT JOIN (
    SELECT
        customer_id,
        COUNT(order_id) AS total_orders,
        SUM(total_amount) AS total_spent,
        MAX(order_date) AS last_order_date
    FROM orders
    WHERE order_date >= '2024-01-01'
    GROUP BY customer_id
) agg ON c.customer_id = agg.customer_id
ORDER BY total_spent DESC;
