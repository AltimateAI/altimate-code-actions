-- BigQuery: UNNEST to expand repeated fields / arrays
SELECT
    e.event_id,
    e.event_timestamp,
    item.item_id,
    item.quantity,
    item.price
FROM `project.dataset.events` e,
    UNNEST(e.items) AS item
WHERE DATE(e.event_timestamp) >= '2024-01-01'
ORDER BY e.event_timestamp;
