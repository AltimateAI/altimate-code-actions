-- Clean: Incremental merge pattern with explicit column list
MERGE INTO target_orders t
USING (
    SELECT
        order_id,
        customer_id,
        order_date,
        total_amount,
        updated_at
    FROM staging_orders
    WHERE updated_at >= '2024-06-01'
) s ON t.order_id = s.order_id
WHEN MATCHED AND s.updated_at > t.updated_at THEN
    UPDATE SET
        t.customer_id = s.customer_id,
        t.order_date = s.order_date,
        t.total_amount = s.total_amount,
        t.updated_at = s.updated_at
WHEN NOT MATCHED THEN
    INSERT (order_id, customer_id, order_date, total_amount, updated_at)
    VALUES (s.order_id, s.customer_id, s.order_date, s.total_amount, s.updated_at);
