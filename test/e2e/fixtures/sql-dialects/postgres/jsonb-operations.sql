-- PostgreSQL: JSONB operators and functions
SELECT
    e.event_id,
    e.created_at,
    e.payload->>'event_type' AS event_type,
    e.payload->'user'->>'id' AS user_id,
    e.payload->'user'->>'email' AS user_email,
    jsonb_array_length(e.payload->'items') AS item_count
FROM events e
WHERE e.payload @> '{"event_type": "purchase"}'
  AND e.payload->'user'->>'country' = 'US'
  AND e.created_at >= '2024-01-01'
ORDER BY e.created_at DESC;
