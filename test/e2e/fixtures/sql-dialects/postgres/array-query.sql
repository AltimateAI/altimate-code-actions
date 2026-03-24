-- PostgreSQL-specific: array ops, JSONB, generate_series, CTE
WITH date_series AS (
    SELECT generate_series(
        '2024-01-01'::DATE,
        '2024-12-31'::DATE,
        '1 month'::INTERVAL
    )::DATE AS month_start
)
SELECT
    ds.month_start,
    u.id,
    u.tags[1] AS primary_tag,
    u.metadata->>'role' AS user_role,
    array_agg(DISTINCT o.status) AS order_statuses
FROM date_series ds
LEFT JOIN users u ON u.created_at >= ds.month_start
    AND u.created_at < ds.month_start + INTERVAL '1 month'
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY ds.month_start, u.id, u.tags[1], u.metadata->>'role';
