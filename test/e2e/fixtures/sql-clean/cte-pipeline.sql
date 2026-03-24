-- Clean: CTE pipeline with clear naming and explicit columns
WITH daily_orders AS (
    SELECT
        order_date,
        COUNT(order_id) AS order_count,
        SUM(total_amount) AS daily_revenue
    FROM orders
    WHERE order_date >= '2024-01-01'
      AND order_date < '2025-01-01'
    GROUP BY order_date
),

rolling_avg AS (
    SELECT
        order_date,
        order_count,
        daily_revenue,
        AVG(daily_revenue) OVER (
            ORDER BY order_date
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
        ) AS seven_day_avg_revenue
    FROM daily_orders
)

SELECT
    order_date,
    order_count,
    daily_revenue,
    seven_day_avg_revenue,
    daily_revenue - seven_day_avg_revenue AS revenue_vs_avg
FROM rolling_avg
ORDER BY order_date;
