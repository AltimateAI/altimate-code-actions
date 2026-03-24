-- Anti-pattern: LIKE with leading wildcard
-- A leading % prevents any index from being used on the column,
-- causing a full table scan on every query execution.
SELECT user_id, email, full_name
FROM users
WHERE email LIKE '%@gmail.com'
   OR full_name LIKE '%smith%';
