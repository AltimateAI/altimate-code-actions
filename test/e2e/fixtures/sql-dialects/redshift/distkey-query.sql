-- Redshift-specific: DISTKEY, SORTKEY, ENCODE, APPROXIMATE COUNT
SELECT
    customer_id,
    APPROXIMATE COUNT(DISTINCT order_id) AS approx_orders,
    LISTAGG(DISTINCT status, ',') WITHIN GROUP (ORDER BY status) AS statuses,
    GETDATE() AS run_at
FROM orders
WHERE order_date >= DATEADD('month', -3, GETDATE())
GROUP BY customer_id
HAVING APPROXIMATE COUNT(DISTINCT order_id) > 5;
