-- Table with no PII-sensitive columns
CREATE TABLE product_metrics (
    product_id BIGINT PRIMARY KEY,
    product_name VARCHAR(255),
    category VARCHAR(100),
    price DECIMAL(10, 2),
    inventory_count INT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

SELECT
    product_id,
    product_name,
    category,
    price,
    inventory_count
FROM product_metrics
WHERE category = 'electronics';
