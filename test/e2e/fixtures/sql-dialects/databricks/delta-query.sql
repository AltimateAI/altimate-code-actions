-- Databricks-specific: Delta Lake, DESCRIBE HISTORY, QUALIFY, named params
SELECT
    user_id,
    event_type,
    event_timestamp,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY event_timestamp DESC) AS rn
FROM catalog.schema.events
WHERE event_timestamp >= CURRENT_TIMESTAMP() - INTERVAL 7 DAYS
QUALIFY rn = 1;
