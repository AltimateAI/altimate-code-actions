-- Clean: SARGable date range filter (no function on column)
SELECT
    order_id,
    order_date,
    customer_id,
    total_amount
FROM orders
WHERE order_date >= '2024-03-01'
  AND order_date < '2024-04-01'
ORDER BY order_date;
