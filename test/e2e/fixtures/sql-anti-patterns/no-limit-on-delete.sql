-- Anti-pattern: DELETE without LIMIT or specific condition
-- A broad DELETE can lock large portions of the table and
-- generate enormous transaction logs, potentially crashing replication.
DELETE FROM event_logs
WHERE created_at < '2023-01-01';
