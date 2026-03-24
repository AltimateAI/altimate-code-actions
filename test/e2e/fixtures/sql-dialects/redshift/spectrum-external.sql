-- Redshift Spectrum: External table for S3 data lake querying
CREATE EXTERNAL TABLE spectrum.events (
    event_id      VARCHAR(36),
    event_type    VARCHAR(50),
    user_id       BIGINT,
    event_payload VARCHAR(MAX),
    event_date    DATE
)
PARTITIONED BY (event_date)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
STORED AS INPUTFORMAT 'org.apache.hadoop.mapred.TextInputFormat'
OUTPUTFORMAT 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat'
LOCATION 's3://data-lake/events/';

-- Query that combines local and external tables
SELECT
    e.event_type,
    c.customer_name,
    COUNT(*) AS event_count
FROM spectrum.events e
INNER JOIN analytics.dim_customers c ON e.user_id = c.customer_id
WHERE e.event_date >= '2024-01-01'
  AND e.event_date < '2024-04-01'
GROUP BY e.event_type, c.customer_name
ORDER BY event_count DESC
LIMIT 100;
