-- BigQuery: Partitioned table creation with clustering
CREATE TABLE `project.dataset.orders_partitioned`
PARTITION BY DATE(order_date)
CLUSTER BY customer_id, status
AS
SELECT
    order_id,
    customer_id,
    order_date,
    status,
    total_amount
FROM `project.dataset.orders_raw`;

-- Query with partition filter (required by partition_filter policy)
SELECT
    DATE(order_date) AS order_day,
    COUNT(*) AS order_count,
    SUM(total_amount) AS daily_revenue
FROM `project.dataset.orders_partitioned`
WHERE DATE(order_date) BETWEEN '2024-01-01' AND '2024-03-31'
GROUP BY order_day
ORDER BY order_day;
