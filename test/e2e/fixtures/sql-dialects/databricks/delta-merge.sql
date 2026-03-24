-- Databricks: Delta Lake MERGE with schema evolution
MERGE INTO gold.dim_customers t
USING silver.customers_updates s
ON t.customer_id = s.customer_id
WHEN MATCHED AND s._change_type = 'delete' THEN
    UPDATE SET t.is_deleted = TRUE, t.deleted_at = current_timestamp()
WHEN MATCHED AND s._change_type = 'update' THEN
    UPDATE SET *
WHEN NOT MATCHED AND s._change_type = 'insert' THEN
    INSERT *;
