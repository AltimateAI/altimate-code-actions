-- Anti-pattern: Implicit type cast in WHERE (string compared to int)
-- Comparing an integer column to a string literal forces a cast on
-- every row, preventing index usage.
SELECT * FROM users WHERE id = '12345';
