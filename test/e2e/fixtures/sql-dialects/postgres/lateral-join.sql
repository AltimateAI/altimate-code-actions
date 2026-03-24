-- PostgreSQL: LATERAL join for top-N per group
SELECT
    c.customer_id,
    c.customer_name,
    recent_orders.order_id,
    recent_orders.order_date,
    recent_orders.total_amount
FROM customers c
CROSS JOIN LATERAL (
    SELECT o.order_id, o.order_date, o.total_amount
    FROM orders o
    WHERE o.customer_id = c.customer_id
    ORDER BY o.order_date DESC
    LIMIT 3
) recent_orders
ORDER BY c.customer_id, recent_orders.order_date DESC;
