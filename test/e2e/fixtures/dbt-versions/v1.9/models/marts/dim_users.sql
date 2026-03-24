SELECT
    user_id,
    user_name,
    email,
    created_at
FROM {{ ref('stg_users') }}
WHERE user_name IS NOT NULL
