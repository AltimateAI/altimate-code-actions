-- BigQuery: Approximate aggregate functions for large datasets
SELECT
    DATE_TRUNC(event_date, MONTH) AS event_month,
    APPROX_COUNT_DISTINCT(user_id) AS approx_unique_users,
    APPROX_QUANTILES(session_duration_seconds, 100)[OFFSET(50)] AS median_session_duration,
    APPROX_QUANTILES(session_duration_seconds, 100)[OFFSET(95)] AS p95_session_duration,
    APPROX_TOP_COUNT(page_path, 10) AS top_pages
FROM `project.dataset.events`
WHERE event_date >= '2024-01-01'
GROUP BY event_month
ORDER BY event_month;
