-- PostgreSQL: generate_series for date spine
WITH date_spine AS (
    SELECT d::DATE AS calendar_date
    FROM generate_series(
        '2024-01-01'::DATE,
        '2024-12-31'::DATE,
        '1 day'::INTERVAL
    ) AS d
),

daily_orders AS (
    SELECT
        order_date::DATE AS order_day,
        COUNT(*) AS order_count,
        SUM(total_amount) AS daily_revenue
    FROM orders
    GROUP BY order_date::DATE
)

SELECT
    ds.calendar_date,
    COALESCE(do.order_count, 0) AS order_count,
    COALESCE(do.daily_revenue, 0.00) AS daily_revenue
FROM date_spine ds
LEFT JOIN daily_orders do ON ds.calendar_date = do.order_day
ORDER BY ds.calendar_date;
