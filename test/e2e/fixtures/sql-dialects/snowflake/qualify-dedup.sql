-- Snowflake: QUALIFY clause for deduplication (no subquery needed)
SELECT
    customer_id,
    email,
    updated_at,
    full_name
FROM raw.customers
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY customer_id
    ORDER BY updated_at DESC
) = 1;
