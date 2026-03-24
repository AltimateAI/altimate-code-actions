SELECT
    id AS user_id,
    name AS user_name,
    email,
    created_at
FROM {{ source('raw', 'users') }}
