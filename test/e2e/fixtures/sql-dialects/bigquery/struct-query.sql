-- BigQuery: STRUCT construction and nested field access
SELECT
    customer_id,
    STRUCT(
        billing.street AS street,
        billing.city AS city,
        billing.state AS state,
        billing.zip AS zip
    ) AS billing_address,
    ARRAY_LENGTH(order_history) AS total_orders
FROM `project.dataset.customers`
WHERE address.country = 'US'
  AND ARRAY_LENGTH(order_history) > 0;
