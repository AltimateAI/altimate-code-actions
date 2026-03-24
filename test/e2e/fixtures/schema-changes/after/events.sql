-- After: Table renamed (events -> activity_log) — BREAKING CHANGE
-- All references to the old table name will fail.
CREATE TABLE activity_log (
    event_id      SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL,
    event_type    VARCHAR(50) NOT NULL,
    event_data    JSONB,
    occurred_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

SELECT
    event_id,
    user_id,
    event_type,
    event_data,
    occurred_at
FROM activity_log
WHERE occurred_at >= '2024-01-01'
ORDER BY occurred_at DESC;
