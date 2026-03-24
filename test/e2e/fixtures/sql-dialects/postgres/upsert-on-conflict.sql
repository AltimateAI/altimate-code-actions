-- PostgreSQL: INSERT ON CONFLICT (upsert)
INSERT INTO dim_customers (customer_id, customer_name, email, updated_at)
SELECT
    customer_id,
    customer_name,
    email,
    updated_at
FROM staging.customers_delta
ON CONFLICT (customer_id)
DO UPDATE SET
    customer_name = EXCLUDED.customer_name,
    email = EXCLUDED.email,
    updated_at = EXCLUDED.updated_at
WHERE dim_customers.updated_at < EXCLUDED.updated_at;
