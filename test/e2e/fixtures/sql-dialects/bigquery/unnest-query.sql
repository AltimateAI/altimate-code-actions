-- BigQuery-specific: UNNEST, STRUCT, SAFE_DIVIDE, backtick identifiers
SELECT
    t.user_id,
    item.product_id,
    item.quantity,
    SAFE_DIVIDE(item.revenue, item.quantity) AS unit_price,
    FORMAT_TIMESTAMP('%Y-%m-%d', t.event_timestamp) AS event_date
FROM `project.dataset.transactions` t,
    UNNEST(t.line_items) AS item
WHERE DATE(t.event_timestamp) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND item.quantity > 0;
