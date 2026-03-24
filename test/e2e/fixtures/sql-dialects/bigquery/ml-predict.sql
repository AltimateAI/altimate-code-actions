-- BigQuery ML: Prediction using a trained model
SELECT
    customer_id,
    predicted_label AS churn_prediction,
    predicted_label_probs[OFFSET(0)].prob AS churn_probability
FROM ML.PREDICT(
    MODEL `project.dataset.customer_churn_model`,
    (
        SELECT
            customer_id,
            total_orders,
            avg_order_value,
            days_since_last_order,
            total_lifetime_value
        FROM `project.dataset.customer_features`
        WHERE is_active = TRUE
    )
)
WHERE predicted_label = 'churned'
ORDER BY churn_probability DESC
LIMIT 1000;
