-- Anti-pattern: Non-deterministic query (uses CURRENT_DATE)
-- Results change depending on when the query runs, making it
-- impossible to reproduce or validate in tests.
SELECT user_id, order_date, CURRENT_DATE as run_date
FROM orders
WHERE order_date >= CURRENT_DATE - INTERVAL '30 days';
