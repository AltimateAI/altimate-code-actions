-- Anti-pattern: Non-aggregated column not in GROUP BY
-- employee_name is not aggregated and not in GROUP BY.
-- Some engines silently pick an arbitrary value; others error.
SELECT department, employee_name, COUNT(*) as cnt
FROM employees
GROUP BY department;
