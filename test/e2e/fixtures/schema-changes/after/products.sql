-- After: Column type changed (price INTEGER -> DECIMAL(10,2)) — POTENTIALLY BREAKING
-- Code expecting integer division or integer comparisons may produce different results.
CREATE TABLE products (
    product_id    SERIAL PRIMARY KEY,
    product_name  VARCHAR(200) NOT NULL,
    category      VARCHAR(50) NOT NULL,
    price         DECIMAL(10,2) NOT NULL,
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
