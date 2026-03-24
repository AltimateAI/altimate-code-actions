-- Anti-pattern: UNION where UNION ALL is sufficient
-- UNION performs an implicit DISTINCT sort which is expensive.
-- When duplicates are impossible or acceptable, use UNION ALL.
SELECT order_id, customer_id, 'online' as channel FROM online_orders
UNION
SELECT order_id, customer_id, 'retail' as channel FROM retail_orders
UNION
SELECT order_id, customer_id, 'wholesale' as channel FROM wholesale_orders;
