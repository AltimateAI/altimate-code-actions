-- Anti-pattern: Correlated subquery (could be a JOIN)
-- The subquery re-executes for every row in the outer query,
-- turning an O(n) operation into O(n^2).
SELECT e.name, e.department,
  (SELECT AVG(salary) FROM employees e2 WHERE e2.department = e.department) as dept_avg
FROM employees e
WHERE e.salary > (SELECT AVG(salary) FROM employees e3 WHERE e3.department = e.department);
