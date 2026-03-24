-- Before: Column type will change (price from INTEGER to DECIMAL)
CREATE TABLE products (
    product_id    SERIAL PRIMARY KEY,
    product_name  VARCHAR(200) NOT NULL,
    category      VARCHAR(50) NOT NULL,
    price         INTEGER NOT NULL,
    is_available  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

SELECT
    product_id,
    product_name,
    category,
    price,
    is_available
FROM products
WHERE is_available = TRUE
ORDER BY price DESC;
