-- Anti-pattern: NOT IN with nullable column
-- If the subquery returns any NULL, NOT IN evaluates to UNKNOWN
-- for every row, returning zero results unexpectedly.
SELECT customer_id, customer_name
FROM customers
WHERE customer_id NOT IN (
    SELECT customer_id FROM orders WHERE cancelled_at IS NOT NULL
);
