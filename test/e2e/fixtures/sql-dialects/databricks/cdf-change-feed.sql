-- Databricks: Change Data Feed (CDF) for incremental reads
-- Enable CDF on table
ALTER TABLE gold.dim_customers
SET TBLPROPERTIES (delta.enableChangeDataFeed = true);

-- Read changes since version 10
SELECT
    customer_id,
    customer_name,
    email,
    _change_type,
    _commit_version,
    _commit_timestamp
FROM table_changes('gold.dim_customers', 10)
WHERE _change_type IN ('insert', 'update_postimage')
ORDER BY _commit_timestamp;
