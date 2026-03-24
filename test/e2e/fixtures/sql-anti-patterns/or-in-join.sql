-- Anti-pattern: OR condition in JOIN (prevents index usage)
-- OR in a JOIN condition forces the optimizer to do a full scan
-- instead of using indexed lookups on either column.
SELECT a.id, b.name
FROM table_a a
JOIN table_b b ON a.id = b.a_id OR a.alt_id = b.a_id;
