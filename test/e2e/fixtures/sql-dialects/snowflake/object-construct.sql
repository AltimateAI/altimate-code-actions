-- Snowflake: OBJECT_CONSTRUCT and ARRAY_AGG for JSON assembly
SELECT
    customer_id,
    OBJECT_CONSTRUCT(
        'name', customer_name,
        'email', email,
        'orders', ARRAY_AGG(
            OBJECT_CONSTRUCT(
                'order_id', order_id,
                'total', order_total,
                'date', order_date
            )
        ) WITHIN GROUP (ORDER BY order_date DESC)
    ) AS customer_json
FROM customers c
INNER JOIN orders o ON c.customer_id = o.customer_id
GROUP BY c.customer_id, c.customer_name, c.email;
