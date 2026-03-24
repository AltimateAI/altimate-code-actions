-- Clean: EXISTS for existence check (efficient short-circuit)
SELECT
    d.department_id,
    d.department_name
FROM departments d
WHERE EXISTS (
    SELECT 1
    FROM employees e
    WHERE e.department_id = d.department_id
      AND e.hire_date >= '2024-01-01'
)
ORDER BY d.department_name;
