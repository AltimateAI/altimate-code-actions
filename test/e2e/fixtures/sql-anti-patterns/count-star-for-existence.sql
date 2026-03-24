-- Anti-pattern: COUNT(*) > 0 to check existence
-- Counting all matching rows when you only need to know if one exists.
-- EXISTS or LIMIT 1 short-circuits after the first match.
SELECT department
FROM departments d
WHERE (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id) > 0;
