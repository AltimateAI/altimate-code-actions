-- After: Column removed (shipping_address) — BREAKING CHANGE
-- Downstream queries referencing shipping_address will fail.
CREATE TABLE orders (
    order_id         SERIAL PRIMARY KEY,
    customer_id      INTEGER NOT NULL REFERENCES customers(id),
    order_date       DATE NOT NULL,
    status           VARCHAR(20) NOT NULL,
    total_amount     DECIMAL(12,2) NOT NULL,
    notes            TEXT,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

SELECT
    order_id,
    customer_id,
    order_date,
    status,
    total_amount,
    notes
FROM orders
WHERE order_date >= '2024-01-01';
