-- Anti-pattern: Missing join condition (cartesian product)
-- Comma-separated FROM with no relationship between tables produces
-- a cross join, potentially generating billions of rows.
SELECT o.id, p.name
FROM orders o, products p
WHERE o.status = 'completed';
