-- Edge cases: columns that look like PII but are not, and vice versa
SELECT
    user_email_preference AS email_pref, -- not PII
    contact_email,                        -- PII (email)
    phone_model,                          -- not PII
    mobile_phone,                         -- PII (phone)
    street_address,                       -- PII (address)
    address_type,                         -- not PII
    tax_id,                               -- PII (tax identifier)
    order_id                              -- not PII
FROM user_settings;
