-- PII EDGE CASES: Ambiguous columns that may or may not be PII

-- "name" is ambiguous: could be a person's name or a product/category name
SELECT id, name, description, created_at
FROM categories
ORDER BY name;

-- "address" could be a URL, memory address, or physical address
SELECT
    server_id,
    ip_address,
    mac_address,
    hostname
FROM infrastructure.servers
WHERE is_active = TRUE;

-- "user_name" could be a display name or login handle
SELECT user_name, role, last_login
FROM system_users
WHERE role = 'admin';

-- "dob" abbreviation for date of birth, but column might be named differently
SELECT account_id, account_holder, dob, account_type
FROM bank_accounts;

-- Hashed/masked PII (might still be sensitive)
SELECT
    user_id,
    email_hash,
    phone_hash,
    masked_ssn
FROM anonymized_users;

-- Geolocation data (can identify individuals at high precision)
SELECT
    device_id,
    latitude,
    longitude,
    geo_accuracy_meters,
    recorded_at
FROM device_locations
WHERE recorded_at >= '2024-01-01';

-- Financial data that could identify individuals
SELECT
    account_number,
    routing_number,
    account_balance,
    last_transaction_date
FROM financial_accounts
WHERE account_balance > 100000;

-- "contact" fields are ambiguous
SELECT
    vendor_id,
    company_name,
    contact_name,
    contact_email,
    contact_phone
FROM vendors
WHERE is_active = TRUE;

-- Age and demographic data
SELECT
    respondent_id,
    age_range,
    gender,
    ethnicity,
    zip_code
FROM survey_demographics;

-- Biometric identifiers
SELECT
    employee_id,
    fingerprint_hash,
    face_encoding_id,
    badge_number
FROM access_control;
