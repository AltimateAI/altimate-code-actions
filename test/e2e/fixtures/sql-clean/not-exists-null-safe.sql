-- Clean: NOT EXISTS instead of NOT IN (NULL-safe)
SELECT
    c.customer_id,
    c.customer_name,
    c.email
FROM customers c
WHERE NOT EXISTS (
    SELECT 1
    FROM orders o
    WHERE o.customer_id = c.customer_id
      AND o.order_date >= '2024-01-01'
)
ORDER BY c.customer_name;
