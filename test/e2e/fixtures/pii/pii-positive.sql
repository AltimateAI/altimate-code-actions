-- PII POSITIVE: Queries that expose personally identifiable information

-- Direct email exposure
SELECT user_id, email, first_name, last_name
FROM users
WHERE created_at >= '2024-01-01';

-- Social Security Number
SELECT employee_id, ssn, full_name, date_of_birth
FROM hr.employees
WHERE department = 'engineering';

-- Phone numbers
SELECT customer_id, phone_number, mobile_phone, home_phone
FROM customers
WHERE country = 'US';

-- Credit card numbers
SELECT transaction_id, credit_card_number, card_expiry, cvv
FROM payments
WHERE transaction_date >= '2024-01-01';

-- IP addresses with user mapping
SELECT user_id, ip_address, login_timestamp, user_agent
FROM login_events
WHERE login_timestamp >= '2024-06-01';

-- Physical address
SELECT
    customer_id,
    street_address,
    city,
    state,
    zip_code,
    country
FROM customer_addresses
WHERE is_primary = TRUE;

-- Date of birth
SELECT patient_id, date_of_birth, medical_record_number
FROM patients
WHERE admission_date >= '2024-01-01';

-- Passport and government IDs
SELECT
    applicant_id,
    passport_number,
    drivers_license_number,
    national_id
FROM identity_documents
WHERE verified = TRUE;
