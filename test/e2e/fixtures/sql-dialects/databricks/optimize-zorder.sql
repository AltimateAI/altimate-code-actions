-- Databricks: OPTIMIZE and ZORDER for query performance
OPTIMIZE gold.fct_orders
ZORDER BY (customer_id, order_date);

-- Vacuum to remove old files (7-day retention)
VACUUM gold.fct_orders RETAIN 168 HOURS;

-- Describe history for auditing
DESCRIBE HISTORY gold.fct_orders LIMIT 20;
