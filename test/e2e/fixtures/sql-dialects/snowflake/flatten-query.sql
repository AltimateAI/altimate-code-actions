-- Snowflake-specific: FLATTEN, VARIANT, IFF
SELECT
    v.value:id::INT AS item_id,
    v.value:name::VARCHAR AS item_name,
    IFF(v.value:active::BOOLEAN, 'Active', 'Inactive') AS status,
    DATEADD('day', -7, CURRENT_TIMESTAMP()) AS week_ago
FROM raw.events,
    LATERAL FLATTEN(input => payload:items) v
WHERE v.value:created_at::TIMESTAMP_NTZ > DATEADD('month', -1, CURRENT_TIMESTAMP());
