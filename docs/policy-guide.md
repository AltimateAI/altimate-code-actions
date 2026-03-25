# Policy Guide

Policies are organizational guardrails that enforce SQL standards beyond lint rules. While lint rules detect common anti-patterns, policies let you define custom constraints specific to your organization: blocking dangerous operations, requiring best practices, and enforcing data governance rules.

## What Are Policies?

A policy is a YAML-defined rule that the `altimate-code check --checks policy` command evaluates against every SQL file in the PR. Policies can:

- **Block specific SQL patterns** (e.g., `DROP TABLE`, `TRUNCATE`, `SELECT *`)
- **Require patterns** (e.g., every query must have a `LIMIT`)
- **Enforce column-level access control** (e.g., block direct access to PII columns)
- **Tag-based rules** (e.g., models tagged `pii` must use masking functions)

## Enabling Policy Checks

### In `.altimate.yml`

```yaml
version: 2

checks:
  policy:
    enabled: true
    file: .altimate-policy.yml  # Path relative to repo root
```

If `file` is omitted, the CLI looks for `.altimate-policy.yml` in the repository root.

### Inline Policy

You can also define policy rules directly in `.altimate.yml` under the `policy` key:

```yaml
version: 2

checks:
  policy:
    enabled: true

policy:
  rules:
    - name: no_select_star
      category: query_patterns
      pattern: "SELECT\\s+\\*"
      message: "SELECT * is not allowed in production models"
      severity: error
    - name: require_limit
      category: query_patterns
      pattern: "^(?!.*\\bLIMIT\\b).*\\bSELECT\\b"
      message: "All SELECT queries must include a LIMIT clause"
      severity: warning
```

When both an external file and inline rules are present, they are merged (external file rules take precedence on name conflicts).

## Policy File Format

The `.altimate-policy.yml` file has this structure:

```yaml
# .altimate-policy.yml

# Global metadata
name: "Production SQL Policy"
description: "Guardrails for the analytics data warehouse"

# Rules organized by category
rules:
  - name: no_drop_table
    category: data_protection
    pattern: "\\bDROP\\s+TABLE\\b"
    message: "DROP TABLE is not allowed. Use soft-delete or archive patterns instead."
    severity: critical
    suggestion: "Replace with ALTER TABLE ... RENAME or create a migration."

  - name: no_truncate
    category: data_protection
    pattern: "\\bTRUNCATE\\b"
    message: "TRUNCATE is not allowed. Use DELETE with WHERE for safer data removal."
    severity: error

  - name: no_select_star
    category: query_patterns
    pattern: "SELECT\\s+\\*"
    message: "Enumerate columns explicitly instead of using SELECT *."
    severity: warning
    exceptions:
      - "models/staging/**"  # Allow in staging models

  - name: require_limit
    category: cost_control
    pattern: "^(?!.*\\bLIMIT\\b).*\\bSELECT\\b"
    message: "All ad-hoc queries must include a LIMIT clause."
    severity: warning
    paths:
      - "scripts/**"
      - "analyses/**"
```

### Rule Fields

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | Yes | string | Unique rule identifier. Used in findings as `policy/<name>`. |
| `category` | No | string | Grouping category for organizational purposes. |
| `pattern` | Yes | string | Regular expression to match against SQL content. Tested with case-insensitive matching. |
| `message` | Yes | string | Human-readable message shown in the PR comment. |
| `severity` | No | string | `info`, `warning`, `error`, or `critical`. Defaults to `warning`. |
| `suggestion` | No | string | Suggested fix shown alongside the message. |
| `paths` | No | string[] | Glob patterns restricting which files this rule applies to. If omitted, applies to all files. |
| `exceptions` | No | string[] | Glob patterns for files exempt from this rule. |

## Available Rule Categories

### `cost_control`

Rules that prevent expensive operations:

```yaml
rules:
  - name: require_limit
    category: cost_control
    pattern: "^(?!.*\\bLIMIT\\b).*\\bSELECT\\b"
    message: "All queries must include a LIMIT clause"
    severity: warning

  - name: no_full_table_scan
    category: cost_control
    pattern: "SELECT.*FROM\\s+\\w+\\s*(?:;|$)"
    message: "Query appears to scan the full table without filters"
    severity: warning

  - name: no_cross_join
    category: cost_control
    pattern: "\\bCROSS\\s+JOIN\\b"
    message: "CROSS JOIN produces a Cartesian product and can be very expensive"
    severity: error
```

### `data_protection`

Rules that prevent destructive or dangerous operations:

```yaml
rules:
  - name: no_drop_table
    category: data_protection
    pattern: "\\bDROP\\s+TABLE\\b"
    message: "DROP TABLE is not allowed"
    severity: critical

  - name: no_truncate
    category: data_protection
    pattern: "\\bTRUNCATE\\b"
    message: "TRUNCATE is not allowed"
    severity: error

  - name: no_delete_without_where
    category: data_protection
    pattern: "\\bDELETE\\s+FROM\\s+\\w+\\s*;"
    message: "DELETE without WHERE clause is not allowed"
    severity: critical

  - name: no_alter_drop_column
    category: data_protection
    pattern: "\\bALTER\\s+TABLE\\s+\\w+\\s+DROP\\s+COLUMN\\b"
    message: "Dropping columns can break downstream consumers"
    severity: error
```

### `query_patterns`

Rules that enforce SQL style and best practices:

```yaml
rules:
  - name: no_select_star
    category: query_patterns
    pattern: "SELECT\\s+\\*"
    message: "Enumerate columns explicitly"
    severity: warning

  - name: require_explicit_join
    category: query_patterns
    pattern: "\\bFROM\\s+\\w+\\s*,\\s*\\w+"
    message: "Use explicit JOIN syntax instead of comma-separated tables"
    severity: warning

  - name: no_order_by_ordinal
    category: query_patterns
    pattern: "\\bORDER\\s+BY\\s+\\d+"
    message: "Use column names in ORDER BY instead of ordinal positions"
    severity: info
```

### `tag_rules`

Rules that apply based on model tags (for dbt projects):

```yaml
rules:
  - name: pii_models_require_masking
    category: tag_rules
    tags: ["pii", "sensitive"]
    pattern: "(?!.*\\b(MASK|HASH|SHA2|MD5|ENCRYPT)\\b).*\\bSELECT\\b"
    message: "Models tagged as PII must use masking functions on sensitive columns"
    severity: error

  - name: certified_models_no_select_star
    category: tag_rules
    tags: ["certified"]
    pattern: "SELECT\\s+\\*"
    message: "Certified models must enumerate columns explicitly"
    severity: error
```

## Examples

### Block SELECT * in Production

```yaml
# .altimate-policy.yml
name: "No SELECT * Policy"
rules:
  - name: no_select_star
    category: query_patterns
    pattern: "SELECT\\s+\\*"
    message: "SELECT * is not allowed in production models. Enumerate columns explicitly."
    severity: error
    suggestion: "Replace SELECT * with an explicit column list."
    exceptions:
      - "models/staging/**"
      - "tests/**"
```

### Require LIMIT on All Queries

```yaml
# .altimate-policy.yml
name: "LIMIT Required Policy"
rules:
  - name: require_limit
    category: cost_control
    pattern: "\\bSELECT\\b(?![\\s\\S]*\\bLIMIT\\b)"
    message: "All SELECT queries must include a LIMIT clause to prevent runaway scans."
    severity: warning
    suggestion: "Add LIMIT 1000 (or an appropriate limit) to the query."
    paths:
      - "scripts/**"
      - "analyses/**"
```

### Block DROP and TRUNCATE Statements

```yaml
# .altimate-policy.yml
name: "Data Protection Policy"
rules:
  - name: no_drop_table
    category: data_protection
    pattern: "\\bDROP\\s+(TABLE|VIEW|SCHEMA|DATABASE)\\b"
    message: "DROP statements are not allowed. Use migration scripts with proper review."
    severity: critical

  - name: no_truncate
    category: data_protection
    pattern: "\\bTRUNCATE\\s+TABLE\\b"
    message: "TRUNCATE is not allowed. Use DELETE with WHERE for safer data removal."
    severity: error
    suggestion: "Use DELETE FROM <table> WHERE <condition> instead."

  - name: no_delete_without_where
    category: data_protection
    pattern: "\\bDELETE\\s+FROM\\s+\\w+\\s*;"
    message: "DELETE without WHERE clause will remove all rows."
    severity: critical
    suggestion: "Add a WHERE clause to limit the scope of the DELETE."
```

### Column-Level Access Control

```yaml
# .altimate-policy.yml
name: "Column Access Policy"
rules:
  - name: no_direct_ssn_access
    category: data_protection
    pattern: "\\bssn\\b|\\bsocial_security\\b"
    message: "Direct access to SSN columns is not allowed. Use the masked_ssn view instead."
    severity: critical
    suggestion: "Query from vw_masked_customers instead of the base table."

  - name: no_direct_email_access
    category: data_protection
    pattern: "\\bemail_address\\b|\\buser_email\\b"
    message: "Direct access to email columns requires approval. Use hashed_email instead."
    severity: error
    exceptions:
      - "models/staging/stg_email_*.sql"
```

### Tag-Based PII Protection

```yaml
# .altimate-policy.yml
name: "PII Protection Policy"
rules:
  - name: pii_requires_masking
    category: tag_rules
    tags: ["pii"]
    pattern: "(?!.*\\b(MASK|SHA2|HASH|MD5)\\b).*\\bSELECT\\b"
    message: "Models with the 'pii' tag must apply masking functions to sensitive columns."
    severity: error
    suggestion: "Wrap sensitive columns with SHA2() or your organization's masking UDF."

  - name: pii_no_export
    category: tag_rules
    tags: ["pii"]
    pattern: "\\b(COPY\\s+INTO|UNLOAD|EXPORT)\\b"
    message: "Exporting data from PII-tagged models is not allowed without approval."
    severity: critical
```

## Combining Policies with Other Checks

Policies work alongside all other v2 checks. A typical production config:

```yaml
version: 2

checks:
  lint:
    enabled: true
  validate:
    enabled: true
  safety:
    enabled: true
  policy:
    enabled: true
    file: .altimate-policy.yml
  pii:
    enabled: true
    categories: [email, ssn, phone, credit_card]
  semantic:
    enabled: false
  grade:
    enabled: false

dialect: snowflake
```

Policy findings appear in the PR comment under a "Policy" subsection, prefixed with `policy/<rule_name>` (e.g., `policy/no_drop_table`).
