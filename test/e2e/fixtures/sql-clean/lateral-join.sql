-- Clean: Top-N per group using ROW_NUMBER (portable across dialects)
WITH ranked_orders AS (
    SELECT
        c.customer_id,
        c.customer_name,
        o.order_id,
        o.order_date,
        o.total_amount,
        ROW_NUMBER() OVER (
            PARTITION BY c.customer_id
            ORDER BY o.total_amount DESC
        ) AS rn
    FROM customers c
    INNER JOIN orders o ON c.customer_id = o.customer_id
    WHERE o.order_date >= '2024-01-01'
)

SELECT
    customer_id,
    customer_name,
    order_id,
    order_date,
    total_amount
FROM ranked_orders
WHERE rn <= 3
ORDER BY customer_id, rn;
