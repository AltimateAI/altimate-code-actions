-- Clean: All non-aggregated columns in GROUP BY
SELECT
    d.department_name,
    e.job_title,
    COUNT(e.employee_id) AS headcount,
    AVG(e.salary) AS avg_salary,
    MIN(e.hire_date) AS earliest_hire,
    MAX(e.hire_date) AS latest_hire
FROM employees e
INNER JOIN departments d ON e.department_id = d.department_id
WHERE e.is_active = TRUE
GROUP BY d.department_name, e.job_title
HAVING COUNT(e.employee_id) >= 3
ORDER BY d.department_name, headcount DESC;
