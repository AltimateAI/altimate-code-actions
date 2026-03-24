-- Anti-pattern: Full table scan (no partition filter on partitioned table)
-- Without a filter on the partition column (date), the query scans
-- every partition, which is extremely expensive at scale.
SELECT COUNT(*) as total_orders
FROM analytics.orders_partitioned_by_date
WHERE status = 'shipped';
