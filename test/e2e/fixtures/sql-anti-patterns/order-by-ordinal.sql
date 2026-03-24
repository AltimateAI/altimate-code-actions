-- Anti-pattern: ORDER BY ordinal position
-- Using column numbers instead of names makes the query fragile:
-- adding or removing a column silently changes the sort order.
SELECT
    customer_id,
    customer_name,
    email,
    created_at,
    lifetime_value
FROM customers
WHERE lifetime_value > 500
ORDER BY 5 DESC, 4 ASC, 2;
