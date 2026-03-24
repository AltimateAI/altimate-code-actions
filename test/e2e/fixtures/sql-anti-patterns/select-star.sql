-- Anti-pattern: SELECT * in production query
-- Using SELECT * pulls all columns including large BLOBs, future columns,
-- and makes the query fragile to schema changes.
SELECT * FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.created_at > '2024-01-01';
