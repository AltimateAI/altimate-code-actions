# Migrating from v1 to v2

This guide covers how to upgrade your `.altimate.yml` from v1 (built-in regex rules) to v2 (powered by `altimate-code check`).

## What Changed

| Aspect | v1 | v2 |
|--------|----|----|
| Rule engine | Built-in regex patterns (19 rules) | `altimate-code check` CLI (40+ checks across 7 categories) |
| SQL validation | Not available | DataFusion-based SQL parsing and validation |
| Safety checks | Basic pattern matching | AST-aware SQL injection and destructive operation detection |
| Policy enforcement | Not available | Custom guardrails via `.altimate-policy.yml` |
| PII detection | Column name regex matching | Combined column, literal, and comment scanning |
| Semantic analysis | Not available | Schema-aware join correctness, type compatibility checks |
| SQL grading | Not available | Quality scoring with letter grades (A-F) |
| Issue categorization | Flat list | Grouped by category (`lint/`, `safety/`, `pii/`, etc.) |

## Breaking Changes

**None.** The v2 integration is fully backward compatible:

- If you set `version: 2` but the `altimate-code` CLI is not installed, the action automatically falls back to the v1 regex engine.
- If you omit `version` entirely, the action runs in v1 mode.
- All existing action inputs (`mode`, `sql_review`, `fail_on`, etc.) continue to work unchanged.

## New Capabilities Unlocked

1. **Lint checks (L001-L026)** -- 26 SQL lint rules covering correctness, performance, style, and safety. Superset of the v1 regex rules with AST-level accuracy.
2. **SQL validation** -- Parse SQL against the DataFusion engine. Catch syntax errors before they hit your warehouse.
3. **Safety analysis** -- Detect SQL injection vectors, destructive statements, and privilege escalation patterns.
4. **Policy enforcement** -- Define organizational guardrails (block `SELECT *` in production, require `LIMIT`, etc.) in a separate policy file.
5. **PII scanning** -- Detect PII in column names, string literals, and comments across 15 categories.
6. **Semantic checks** -- Schema-aware analysis: incorrect join conditions, type mismatches, missing columns. Requires schema resolution.
7. **SQL grading** -- Quality score and letter grade for each file analyzed.

## Step-by-Step Upgrade

### Step 1: Set the version

Change (or add) the `version` field at the top of `.altimate.yml`:

```yaml
# Before (v1)
version: 1

# After (v2)
version: 2
```

### Step 2: Replace `sql_review.rules` with `checks`

v1 uses a flat `sql_review.rules` map. v2 uses a `checks` map where each key is a check category:

```yaml
# Before (v1)
sql_review:
  enabled: true
  rules:
    select_star:
      enabled: true
      severity: warning
    cartesian_join:
      enabled: true
      severity: error

# After (v2)
checks:
  lint:
    enabled: true
    # disabled_rules:
    #   - L001  # select_star
    # severity_overrides:
    #   L002: error  # cartesian_join
  safety:
    enabled: true
  validate:
    enabled: true
```

### Step 3: Move PII settings

```yaml
# Before (v1)
pii_detection:
  enabled: true
  categories: [email, ssn, phone]

# After (v2)
checks:
  pii:
    enabled: true
    categories:
      - email
      - ssn
      - phone
```

### Step 4: Add schema resolution (optional)

If your repository contains a dbt project and you want semantic checks:

```yaml
schema:
  source: dbt
  dbt:
    manifest_path: target/manifest.json

checks:
  semantic:
    enabled: true
```

### Step 5: Add policy enforcement (optional)

```yaml
checks:
  policy:
    enabled: true
    file: .altimate-policy.yml
```

See the [Policy Guide](./policy-guide.md) for policy file format and examples.

### Step 6: Install the CLI

The v2 checks require the `altimate-code` CLI to be available in your GitHub Actions runner. Add an installation step before the review action:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: AltimateAI/setup-altimate-code@v1  # Install the CLI
  - uses: AltimateAI/altimate-code-actions@v0
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

If the CLI is not installed, the action falls back to v1 rules automatically.

## Complete Before/After Example

### v1 Config

```yaml
version: 1

sql_review:
  enabled: true
  severity_threshold: warning
  rules:
    select_star:
      enabled: true
      severity: warning
    cartesian_join:
      enabled: true
      severity: error
    missing_where_clause:
      enabled: true
      severity: warning
  include:
    - "models/**/*.sql"
  exclude:
    - "models/staging/legacy/**"

pii_detection:
  enabled: true
  categories: [email, ssn, phone]

comment:
  mode: single
  max_issues_shown: 20

dialect: auto
```

### v2 Config

```yaml
version: 2

checks:
  lint:
    enabled: true
    severity_overrides:
      L002: error  # cartesian_join
  validate:
    enabled: true
  safety:
    enabled: true
  policy:
    enabled: false
  pii:
    enabled: true
    categories: [email, ssn, phone]
  semantic:
    enabled: false
  grade:
    enabled: false

comment:
  mode: single
  max_issues_shown: 20

dialect: auto
```

## Verifying the Migration

After updating your config, open a PR that modifies a `.sql` file. The PR comment will show category-grouped issues (e.g., "Lint", "Safety", "PII") instead of the flat v1 issue list. If you see category subsection headers in the comment, v2 is active.

To verify locally:

```bash
altimate-code check models/my_model.sql --format json --checks lint,safety
```

If this command runs successfully, the CLI integration is working.
