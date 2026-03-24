-- Before: Column will be renamed (username -> user_name)
CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(100) NOT NULL,
    email       VARCHAR(255) NOT NULL UNIQUE,
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

SELECT
    id,
    username,
    email,
    created_at,
    is_active
FROM users
WHERE is_active = TRUE
ORDER BY created_at DESC;
