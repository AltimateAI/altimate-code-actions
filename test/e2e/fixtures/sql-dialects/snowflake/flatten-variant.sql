-- Snowflake: FLATTEN to unnest semi-structured VARIANT data
SELECT
    e.event_id,
    e.event_timestamp,
    f.value:item_id::STRING AS item_id,
    f.value:quantity::INTEGER AS quantity,
    f.value:price::DECIMAL(10,2) AS price
FROM events e,
    LATERAL FLATTEN(input => e.payload:items) f
WHERE e.event_timestamp >= '2024-01-01'
ORDER BY e.event_timestamp;
