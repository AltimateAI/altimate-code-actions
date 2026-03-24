-- Clean: UNION ALL when duplicates are impossible (disjoint sources)
SELECT
    order_id,
    customer_id,
    order_date,
    total_amount,
    'online' AS channel
FROM online_orders
WHERE order_date >= '2024-01-01'

UNION ALL

SELECT
    order_id,
    customer_id,
    order_date,
    total_amount,
    'retail' AS channel
FROM retail_orders
WHERE order_date >= '2024-01-01'

ORDER BY order_date DESC;
