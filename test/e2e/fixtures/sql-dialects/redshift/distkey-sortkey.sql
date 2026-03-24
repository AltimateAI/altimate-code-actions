-- Redshift: Table with DISTKEY and SORTKEY for optimized query patterns
CREATE TABLE analytics.fct_orders (
    order_id        BIGINT        NOT NULL ENCODE az64,
    customer_id     BIGINT        NOT NULL ENCODE az64,
    order_date      DATE          NOT NULL ENCODE az64,
    order_status    VARCHAR(20)   ENCODE lzo,
    total_amount    DECIMAL(12,2) ENCODE az64,
    created_at      TIMESTAMP     ENCODE az64
)
DISTKEY (customer_id)
COMPOUND SORTKEY (order_date, customer_id);
