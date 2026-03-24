-- Snowflake: MERGE with multiple match conditions
MERGE INTO target.dim_customers t
USING staging.customers_delta s
ON t.customer_id = s.customer_id
WHEN MATCHED AND s.is_deleted = TRUE THEN
    UPDATE SET t.is_active = FALSE, t.deleted_at = CURRENT_TIMESTAMP()
WHEN MATCHED AND s.is_deleted = FALSE THEN
    UPDATE SET
        t.customer_name = s.customer_name,
        t.email = s.email,
        t.updated_at = s.updated_at
WHEN NOT MATCHED AND s.is_deleted = FALSE THEN
    INSERT (customer_id, customer_name, email, is_active, created_at, updated_at)
    VALUES (s.customer_id, s.customer_name, s.email, TRUE, CURRENT_TIMESTAMP(), s.updated_at);
