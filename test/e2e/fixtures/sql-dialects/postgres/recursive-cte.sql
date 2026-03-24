-- PostgreSQL: Recursive CTE for hierarchical data (org chart)
WITH RECURSIVE org_tree AS (
    -- Anchor: top-level managers (no manager_id)
    SELECT
        employee_id,
        employee_name,
        manager_id,
        1 AS depth,
        ARRAY[employee_id] AS path
    FROM employees
    WHERE manager_id IS NULL

    UNION ALL

    -- Recursive: each level of reports
    SELECT
        e.employee_id,
        e.employee_name,
        e.manager_id,
        ot.depth + 1,
        ot.path || e.employee_id
    FROM employees e
    INNER JOIN org_tree ot ON e.manager_id = ot.employee_id
    WHERE ot.depth < 10  -- safety limit
)

SELECT
    employee_id,
    employee_name,
    manager_id,
    depth,
    path
FROM org_tree
ORDER BY path;
