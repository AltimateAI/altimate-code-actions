-- Redshift: Window function with explicit frame specification
SELECT
    order_date,
    daily_revenue,
    SUM(daily_revenue) OVER (
        ORDER BY order_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_revenue,
    AVG(daily_revenue) OVER (
        ORDER BY order_date
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) AS seven_day_avg,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY daily_revenue)
        OVER (PARTITION BY DATE_TRUNC('month', order_date)) AS monthly_median
FROM (
    SELECT
        order_date,
        SUM(total_amount) AS daily_revenue
    FROM analytics.fct_orders
    WHERE order_date >= '2024-01-01'
    GROUP BY order_date
) daily_agg
ORDER BY order_date;
