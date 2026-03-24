-- Snowflake: Zero-copy clone for testing
CREATE TABLE analytics.orders_staging
    CLONE analytics.orders_production;

-- Time travel query
SELECT COUNT(*) as row_count
FROM analytics.orders_production
AT (TIMESTAMP => '2024-06-01 00:00:00'::TIMESTAMP_NTZ);
