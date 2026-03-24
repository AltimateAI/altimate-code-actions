-- Clean: Proper query with explicit columns, joins, and filters
SELECT
    o.order_id,
    o.order_date,
    c.customer_name,
    SUM(oi.quantity * oi.unit_price) AS total_amount
FROM orders o
INNER JOIN customers c ON o.customer_id = c.customer_id
INNER JOIN order_items oi ON o.order_id = oi.order_id
WHERE o.order_date >= '2024-01-01'
  AND o.order_date < '2025-01-01'
GROUP BY o.order_id, o.order_date, c.customer_name
ORDER BY total_amount DESC;
