-- Table with PII-sensitive columns
CREATE TABLE customer_profiles (
    id BIGINT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    ssn VARCHAR(11),
    social_security_number VARCHAR(11),
    phone_number VARCHAR(20),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    date_of_birth DATE,
    credit_card_number VARCHAR(19),
    home_address TEXT,
    ip_address VARCHAR(45)
);

SELECT
    id,
    email,
    ssn,
    phone_number,
    first_name,
    last_name,
    date_of_birth,
    credit_card_number
FROM customer_profiles
WHERE email LIKE '%@example.com';
