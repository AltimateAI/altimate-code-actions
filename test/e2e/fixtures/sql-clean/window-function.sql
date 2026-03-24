-- Clean: Window functions with proper PARTITION BY and ORDER BY
SELECT
    e.employee_id,
    e.employee_name,
    e.department,
    e.salary,
    RANK() OVER (PARTITION BY e.department ORDER BY e.salary DESC) AS dept_salary_rank,
    e.salary - AVG(e.salary) OVER (PARTITION BY e.department) AS salary_vs_dept_avg,
    SUM(e.salary) OVER (PARTITION BY e.department) AS dept_total_salary
FROM employees e
WHERE e.is_active = TRUE
ORDER BY e.department, dept_salary_rank;
