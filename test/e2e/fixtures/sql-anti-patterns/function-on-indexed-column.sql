-- Anti-pattern: Function applied to indexed column in WHERE
-- Wrapping the indexed column in a function prevents index usage,
-- forcing a full table scan.
SELECT order_id, order_date, total
FROM orders
WHERE YEAR(order_date) = 2024
  AND MONTH(order_date) = 3;
