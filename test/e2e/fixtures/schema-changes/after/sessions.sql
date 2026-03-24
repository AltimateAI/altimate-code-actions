-- After: Column added (device_type) — NON-BREAKING change
-- Existing queries continue to work; new column is additive.
CREATE TABLE sessions (
    session_id    VARCHAR(64) PRIMARY KEY,
    user_id       INTEGER NOT NULL,
    started_at    TIMESTAMP NOT NULL,
    ended_at      TIMESTAMP,
    ip_address    INET,
    user_agent    TEXT,
    device_type   VARCHAR(20) DEFAULT 'unknown'
);

SELECT
    session_id,
    user_id,
    started_at,
    ended_at,
    ip_address,
    user_agent,
    device_type
FROM sessions
WHERE started_at >= '2024-01-01';
