-- Anti-pattern: Deeply nested subqueries (hard to read, hard to optimize)
-- Three levels of nesting make this query unmaintainable and
-- prevent the optimizer from finding efficient plans.
SELECT *
FROM (
    SELECT customer_id, total_spend
    FROM (
        SELECT customer_id, SUM(amount) as total_spend
        FROM (
            SELECT o.customer_id, oi.quantity * oi.price as amount
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            WHERE o.status != 'cancelled'
        ) raw_amounts
        GROUP BY customer_id
    ) customer_totals
    WHERE total_spend > 1000
) high_value_customers
ORDER BY total_spend DESC;
