-- Redshift: COPY from S3 and UNLOAD to S3
COPY staging.raw_orders
FROM 's3://data-pipeline/orders/2024/'
IAM_ROLE 'arn:aws:iam::123456789012:role/RedshiftS3Access'
FORMAT AS PARQUET;

-- UNLOAD query results to S3
UNLOAD ('
    SELECT
        order_id,
        customer_id,
        order_date,
        total_amount
    FROM analytics.fct_orders
    WHERE order_date >= ''2024-01-01''
      AND order_date < ''2024-04-01''
')
TO 's3://data-exports/orders/q1-2024/'
IAM_ROLE 'arn:aws:iam::123456789012:role/RedshiftS3Access'
FORMAT AS PARQUET
ALLOWOVERWRITE;
