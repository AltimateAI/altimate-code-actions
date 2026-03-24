-- Clean aggregation query with proper GROUP BY
SELECT
    department_id,
    COUNT(*) AS employee_count,
    AVG(salary) AS avg_salary,
    MAX(hire_date) AS latest_hire
FROM employees
WHERE is_active = true
GROUP BY department_id
HAVING COUNT(*) > 5
ORDER BY avg_salary DESC;
