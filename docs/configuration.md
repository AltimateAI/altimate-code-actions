# Configuration Reference

This document covers every configuration option for Altimate Code Actions.

## Action Inputs

Inputs are set in the `with:` block of your workflow step. All inputs are optional.

### Analysis Controls

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | string | `full` | Review mode. `static` runs rule-based analysis only (no API key needed). `ai` uses an AI model for deeper review. `full` combines both. |
| `model` | string | *(required)* | AI model identifier (e.g., `anthropic/claude-haiku-4-5-20251001`). Required. Used in `ai` and `full` modes. Supports Anthropic (`anthropic/claude-*`) and OpenAI (`openai/gpt-*`) model names. |
| `sql_review` | boolean | `true` | Enable SQL quality analysis. Set to `false` to skip static SQL checks. |
| `impact_analysis` | boolean | `true` | Enable dbt DAG impact analysis. Requires a dbt project in the repository. |
| `cost_estimation` | boolean | `false` | Enable query cost estimation. Requires `warehouse_type` and warehouse credentials. |
| `pii_check` | boolean | `true` | Enable PII detection. Scans column names and string literals for personally identifiable information. |

### dbt Configuration

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `dbt_project_dir` | string | *(auto-detect)* | Path to the directory containing `dbt_project.yml`. If not specified, the action searches the repository root and common subdirectories. |
| `dbt_version` | string | *(auto-detect)* | dbt Core version. If not specified, the action reads `require-dbt-version` from `dbt_project.yml` or defaults to `1.9`. Valid values: `1.7`, `1.8`, `1.9`. |
| `manifest_path` | string | *(auto-detect)* | Path to the dbt `manifest.json` artifact. If not specified, the action looks in `target/manifest.json` relative to `dbt_project_dir`. |

### Warehouse Configuration

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `warehouse_type` | string | | Warehouse dialect for cost estimation and SQL dialect awareness. Supported values: `snowflake`, `bigquery`, `postgres`, `databricks`, `redshift`. |
| `warehouse_connection` | string | | JSON warehouse connection config. Alternative to setting individual credential environment variables. |

Warehouse credentials are passed via environment variables, not action inputs. See the [Environment Variables](#environment-variables) section below.

### Reporting Controls

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `severity_threshold` | string | `warning` | Minimum severity to include in the review. Issues below this threshold are silently dropped. Values: `info`, `warning`, `error`, `critical`. |
| `fail_on` | string | `none` | Fail the GitHub Actions step when issues at this severity or above are found. `none` means the step always succeeds. `error` fails on errors and criticals. `critical` fails only on criticals. |
| `comment_mode` | string | `single` | How to post review feedback. `single` posts one summary comment on the PR. `inline` posts individual comments on changed lines. `both` does both — a summary comment plus inline review comments on lines with critical issues. |
| `max_files` | number | `50` | Maximum number of SQL files to analyze per PR. When the PR exceeds this limit, the most-changed files (by additions) are prioritized. |

### Interactive Mode

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `interactive` | boolean | `true` | Enable interactive mode. When true, the action responds to trigger phrases in PR comments instead of running automatically. |
| `mentions` | string | `/altimate,/oc` | Comma-separated list of trigger phrases. When a PR comment contains any of these phrases, the action runs a review. |

## Action Outputs

Outputs are available to subsequent steps via `${{ steps.<step-id>.outputs.<output> }}`.

| Output | Type | Description |
|--------|------|-------------|
| `issues_found` | number | Total number of issues found across all analyzed files |
| `impact_score` | number | dbt impact score from 0 (no risk) to 100 (high risk). Only set when `impact_analysis: true` |
| `estimated_cost_delta` | number | Estimated monthly cost delta in USD (positive = more expensive). Only set when `cost_estimation: true` |
| `comment_url` | string | URL of the PR comment that was posted or updated |
| `report_json` | string | Full `ReviewReport` object serialized as JSON |

### Using Outputs

```yaml
steps:
  - uses: AltimateAI/altimate-code-actions@v0
    id: review
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  - name: Check results
    run: |
      echo "Issues found: ${{ steps.review.outputs.issues_found }}"
      echo "Impact score: ${{ steps.review.outputs.impact_score }}"
      echo "Cost delta: ${{ steps.review.outputs.estimated_cost_delta }}"
      echo "Comment: ${{ steps.review.outputs.comment_url }}"
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub token for API access (PR comments, file content, changed files). Provided automatically by GitHub Actions. Pass it in the `env:` block. |

### AI Model Keys

Required when `mode` is `ai` or `full`:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key for Anthropic Claude models |
| `OPENAI_API_KEY` | API key for OpenAI GPT models |

Only one is needed, matching the model provider specified in the `model` input.

### Snowflake Credentials

Required when `warehouse_type: snowflake` and `cost_estimation: true`:

| Variable | Description |
|----------|-------------|
| `SNOWFLAKE_ACCOUNT` | Snowflake account identifier (e.g., `xy12345.us-east-1`) |
| `SNOWFLAKE_USER` | Snowflake login username |
| `SNOWFLAKE_PASSWORD` | Snowflake login password |
| `SNOWFLAKE_WAREHOUSE` | (Optional) Warehouse to use for EXPLAIN queries |
| `SNOWFLAKE_DATABASE` | (Optional) Default database |
| `SNOWFLAKE_SCHEMA` | (Optional) Default schema |
| `SNOWFLAKE_ROLE` | (Optional) Role to assume |

### BigQuery Credentials

Required when `warehouse_type: bigquery` and `cost_estimation: true`:

| Variable | Description |
|----------|-------------|
| `BIGQUERY_CREDENTIALS` | GCP service account key JSON (the full JSON string, not a file path) |
| `BIGQUERY_PROJECT` | (Optional) GCP project ID. If not set, uses the project from the service account. |

### PostgreSQL Credentials

Required when `warehouse_type: postgres` and `cost_estimation: true`:

| Variable | Description |
|----------|-------------|
| `POSTGRES_HOST` | PostgreSQL hostname |
| `POSTGRES_PORT` | (Optional) Port, defaults to 5432 |
| `POSTGRES_USER` | PostgreSQL username |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `POSTGRES_DATABASE` | Database name |

### Databricks Credentials

Required when `warehouse_type: databricks` and `cost_estimation: true`:

| Variable | Description |
|----------|-------------|
| `DATABRICKS_HOST` | Databricks workspace URL (e.g., `https://dbc-abc123.cloud.databricks.com`) |
| `DATABRICKS_HTTP_PATH` | HTTP path for the SQL warehouse or cluster (e.g., `/sql/1.0/warehouses/abc123`) |
| `DATABRICKS_TOKEN` | Databricks personal access token |

### Redshift Credentials

Required when `warehouse_type: redshift` and `cost_estimation: true`:

| Variable | Description |
|----------|-------------|
| `REDSHIFT_HOST` | Redshift cluster endpoint (e.g., `my-cluster.abc123.us-east-1.redshift.amazonaws.com`) |
| `REDSHIFT_PORT` | (Optional) Port, defaults to 5439 |
| `REDSHIFT_USER` | Redshift username |
| `REDSHIFT_PASSWORD` | Redshift password |
| `REDSHIFT_DATABASE` | Database name |

## Configuration File (`.altimate.yml`)

In addition to action inputs, you can place an `.altimate.yml` file at the repository root for persistent configuration that applies to every PR:

```yaml
# .altimate.yml

# SQL analysis rules to disable
disabled_rules:
  - no-select-star        # Allow SELECT * in staging models
  - order-by-in-subquery  # Our subqueries intentionally use ORDER BY

# Files and directories to exclude from analysis
exclude:
  - migrations/**
  - seeds/**
  - tests/**/*.sql

# Custom severity overrides
severity_overrides:
  implicit-join: error      # Treat implicit joins as errors, not warnings
  missing-where: critical   # Treat missing WHERE on DELETE/UPDATE as critical

# PII allowlist — column names that are known-safe despite matching PII patterns
pii_allowlist:
  - email_domain            # Not actual email, just the domain part
  - phone_type              # Enum field, not a phone number
```

### Configuration Precedence

1. Action inputs (highest priority)
2. `.altimate.yml` in repository root
3. Built-in defaults (lowest priority)

Action inputs override `.altimate.yml` settings when both are specified.

### Suppress Clean Comments

```yaml
# .altimate.yml

# When no issues are found, suppress the "All checks passed" comment entirely
suppress_clean_comments: true
```

## "No Findings" Behavior

When the action analyzes your PR and finds no issues, it posts a brief "All checks passed" comment on the pull request. This confirms that the review ran successfully and your SQL is clean.

If you prefer not to receive a comment when there are no findings, set `suppress_clean_comments: true` in your `.altimate.yml` file. When enabled, the action skips posting entirely if no issues are found.

## Warehouse Connection Examples

### Snowflake

```yaml
- uses: AltimateAI/altimate-code-actions@v0
  with:
    cost_estimation: true
    warehouse_type: snowflake
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    SNOWFLAKE_ACCOUNT: ${{ secrets.SNOWFLAKE_ACCOUNT }}
    SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_USER }}
    SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}
    SNOWFLAKE_WAREHOUSE: COMPUTE_WH
    SNOWFLAKE_ROLE: ANALYST
```

### BigQuery

```yaml
- uses: AltimateAI/altimate-code-actions@v0
  with:
    cost_estimation: true
    warehouse_type: bigquery
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    BIGQUERY_CREDENTIALS: ${{ secrets.BIGQUERY_CREDENTIALS }}
    BIGQUERY_PROJECT: my-gcp-project
```

### PostgreSQL

```yaml
- uses: AltimateAI/altimate-code-actions@v0
  with:
    cost_estimation: true
    warehouse_type: postgres
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    POSTGRES_HOST: ${{ secrets.POSTGRES_HOST }}
    POSTGRES_USER: ${{ secrets.POSTGRES_USER }}
    POSTGRES_PASSWORD: ${{ secrets.POSTGRES_PASSWORD }}
    POSTGRES_DATABASE: analytics
```

### Databricks

```yaml
- uses: AltimateAI/altimate-code-actions@v0
  with:
    cost_estimation: true
    warehouse_type: databricks
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    DATABRICKS_HOST: ${{ secrets.DATABRICKS_HOST }}
    DATABRICKS_HTTP_PATH: ${{ secrets.DATABRICKS_HTTP_PATH }}
    DATABRICKS_TOKEN: ${{ secrets.DATABRICKS_TOKEN }}
```

### Redshift

```yaml
- uses: AltimateAI/altimate-code-actions@v0
  with:
    cost_estimation: true
    warehouse_type: redshift
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    REDSHIFT_HOST: ${{ secrets.REDSHIFT_HOST }}
    REDSHIFT_USER: ${{ secrets.REDSHIFT_USER }}
    REDSHIFT_PASSWORD: ${{ secrets.REDSHIFT_PASSWORD }}
    REDSHIFT_DATABASE: analytics
```

## Inline Review Comments

When `comment_mode` is set to `both`, the action posts:

1. **A summary comment** on the PR with the compact review table and collapsible issue groups.
2. **Inline review comments** on the specific diff lines where critical issues were detected.

Inline comments appear directly in the "Files changed" tab, making it easier to address issues without jumping between the conversation and the diff.

```yaml
- uses: AltimateAI/altimate-code-actions@v0
  with:
    comment_mode: both
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Only issues at `error` or `critical` severity are posted as inline comments. Lower-severity issues appear only in the summary comment.

## Mermaid DAG Visualization

When `impact_analysis: true`, the PR comment includes a Mermaid dependency graph showing the blast radius of changed models. Changed models are highlighted in orange and downstream exposures in blue.

GitHub renders Mermaid diagrams natively inside markdown code blocks — no additional setup, plugins, or configuration is required. The graph appears inline in the PR comment on any GitHub.com repository.

## Interactive Commands

When `interactive: true` (the default), developers can trigger specific analyses by commenting on the PR. The action listens for trigger phrases configured via the `mentions` input.

### Available Commands

| Command | Description |
|---------|-------------|
| `@altimate review` | Run full SQL quality review on the current PR |
| `@altimate impact` | Run dbt DAG impact analysis only |
| `@altimate cost` | Run cost estimation only |
| `@altimate help` | Reply with available commands and current configuration |

Commands are case-insensitive. The trigger phrase must appear at the start of the comment or on its own line.

### Workflow Setup

Interactive mode requires the `issue_comment` event trigger:

```yaml
name: Altimate Interactive
on:
  issue_comment:
    types: [created]

permissions:
  pull-requests: write
  contents: read

jobs:
  review:
    if: contains(github.event.comment.body, '@altimate')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: AltimateAI/altimate-code-actions@v0
        with:
          interactive: true
          mentions: "@altimate,/altimate,/oc"
          mode: full
          model: anthropic/claude-haiku-4-5-20251001
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## SQL Rules Reference

Altimate Code Actions includes 19 built-in SQL rules organized by category:

### Correctness

| Rule | Description |
|------|-------------|
| `missing-where` | DELETE or UPDATE without a WHERE clause |
| `not-in-with-nulls` | NOT IN with a subquery that may return NULLs (always evaluates to empty) |
| `distinct-masking-bad-join` | DISTINCT used to mask a bad JOIN that produces duplicates |
| `no-limit-on-delete` | DELETE without LIMIT on databases that support it |

### Performance

| Rule | Description |
|------|-------------|
| `no-select-star` | SELECT * instead of enumerating columns |
| `function-on-indexed-column` | Function applied to an indexed column, preventing index use |
| `count-for-existence` | COUNT(*) used where EXISTS would be more efficient |
| `order-by-in-subquery` | ORDER BY inside a subquery with no LIMIT |
| `cartesian-join` | JOIN without a join condition |

### Style

| Rule | Description |
|------|-------------|
| `implicit-join` | Comma-separated tables instead of explicit JOIN syntax |
| `unused-cte` | CTE defined but never referenced |
| `ambiguous-column` | Column reference that could resolve to multiple tables |
| `duplicate-column-alias` | Conflicting column names in a SELECT list |
| `union-vs-union-all` | UNION where UNION ALL would suffice |
| `schema-qualification` | Unqualified table references |

### Security

| Rule | Description |
|------|-------------|
| `pii-detected` | Column name or literal matches a PII pattern |

Every rule provides a concrete **fix suggestion** in the review comment, so developers know exactly how to resolve each issue.

---

## V2 Configuration Reference

Version 2 delegates static analysis to the `altimate-code check` CLI, providing 40+ checks across 7 categories. V2 is fully backward compatible: if the CLI is unavailable, the action falls back to v1 regex rules automatically.

> For a step-by-step upgrade guide, see [Migrating from v1 to v2](./v2-migration.md).

### Enabling V2

Set `version: 2` at the top of your `.altimate.yml`:

```yaml
version: 2

checks:
  lint:
    enabled: true
  safety:
    enabled: true
```

When `version: 2` is set (or the `checks` key is present), the action routes all enabled checks through a single `altimate-code check` CLI invocation instead of the built-in regex engine.

### Checks Reference

Each check maps to a category in `altimate-code check --checks <list>`. Disable any check by setting `enabled: false`.

| Check | Default | Description | Requirements |
|-------|---------|-------------|--------------|
| `lint` | enabled | 26 SQL lint rules (L001-L026) covering correctness, performance, style, and safety | None |
| `validate` | enabled | SQL syntax validation via the DataFusion engine | None |
| `safety` | enabled | SQL injection detection, destructive operation flagging, privilege escalation patterns | None |
| `policy` | disabled | Custom organizational guardrails defined in a policy file | Policy file (`.altimate-policy.yml`) |
| `pii` | enabled | Personally identifiable information detection in column names, literals, and comments | None |
| `semantic` | disabled | Schema-aware analysis: join correctness, type mismatches, missing columns | Schema resolution (dbt manifest or DDL files) |
| `grade` | disabled | SQL quality scoring with letter grades (A-F) and per-file scores | None |

#### Lint Check Options

```yaml
checks:
  lint:
    enabled: true
    disabled_rules:
      - L001  # select_star — allow in staging models
      - L009  # order_by_ordinal
    severity_overrides:
      L002: error    # Promote cartesian_join to error
      L015: critical # Promote function_on_indexed_column to critical
```

#### Policy Check Options

```yaml
checks:
  policy:
    enabled: true
    file: .altimate-policy.yml  # Path relative to repo root
```

See the [Policy Guide](./policy-guide.md) for the full policy file format.

#### PII Check Options

```yaml
checks:
  pii:
    enabled: true
    categories:
      - email
      - ssn
      - phone
      - credit_card
      - ip_address
```

### Schema Configuration

Schema resolution enables semantic checks and improves lint accuracy. Three sources are supported:

#### dbt Manifest

```yaml
schema:
  source: dbt
  dbt:
    manifest_path: target/manifest.json
```

#### DDL / YAML Files

```yaml
schema:
  source: files
  paths:
    - schema/warehouse.yml
    - schema/tables.ddl
```

#### Warehouse (Live Introspection)

```yaml
schema:
  source: warehouse
```

Requires `WAREHOUSE_CONNECTION` environment variable with credentials.

### Policy Configuration

Policies can be defined in two ways:

#### External Policy File

```yaml
checks:
  policy:
    enabled: true
    file: .altimate-policy.yml
```

#### Inline Policy

```yaml
checks:
  policy:
    enabled: true

policy:
  rules:
    - name: no_drop_table
      category: data_protection
      pattern: "\\bDROP\\s+TABLE\\b"
      message: "DROP TABLE is not allowed"
      severity: critical
```

See the [Policy Guide](./policy-guide.md) for the complete rule reference.

### Lint Rules Reference (L001-L026)

| Code | Rule | Default Severity | Description |
|------|------|-----------------|-------------|
| L001 | `select_star` | warning | `SELECT *` instead of explicit column list |
| L002 | `cartesian_join` | error | JOIN without a join condition |
| L003 | `missing_partition` | warning | Missing partition filter on partitioned table |
| L004 | `non_deterministic` | warning | Non-deterministic function usage (e.g., `RAND()`, `NOW()`) |
| L005 | `correlated_subquery` | warning | Correlated subquery that runs per-row |
| L006 | `implicit_type_cast` | info | Implicit type conversion in comparison |
| L007 | `or_in_join` | warning | OR condition in JOIN predicate |
| L008 | `missing_group_by` | error | Aggregate function without GROUP BY |
| L009 | `order_by_ordinal` | info | ORDER BY using ordinal position |
| L010 | `union_without_all` | info | UNION where UNION ALL would suffice |
| L011 | `nested_subquery` | warning | Deeply nested subquery (3+ levels) |
| L012 | `missing_where_clause` | warning | DELETE or UPDATE without WHERE |
| L013 | `leading_wildcard_like` | info | LIKE pattern with leading wildcard |
| L014 | `duplicate_column_alias` | error | Conflicting column names in SELECT |
| L015 | `function_on_indexed_column` | warning | Function applied to indexed column |
| L016 | `not_in_with_nulls` | warning | NOT IN with nullable subquery |
| L017 | `distinct_masking_bad_join` | warning | DISTINCT used to mask duplicate-producing JOIN |
| L018 | `count_for_existence` | warning | COUNT(*) where EXISTS would be more efficient |
| L019 | `no_limit_on_delete` | info | DELETE without LIMIT |
| L020 | `unused_cte` | warning | CTE defined but never referenced |
| L021 | `ambiguous_column` | warning | Column reference resolving to multiple tables |
| L022 | `schema_qualification` | info | Unqualified table reference |
| L023 | `implicit_join` | warning | Comma-separated tables instead of explicit JOIN |
| L024 | `order_by_in_subquery` | info | ORDER BY in subquery without LIMIT |
| L025 | `union_type_mismatch` | error | UNION with incompatible column types |
| L026 | `window_without_partition` | info | Window function without PARTITION BY |

### V2 Configuration Examples

#### Minimal Config

```yaml
version: 2

checks:
  lint:
    enabled: true
  safety:
    enabled: true
```

#### dbt Project Config

```yaml
version: 2

checks:
  lint:
    enabled: true
  validate:
    enabled: true
  safety:
    enabled: true
  pii:
    enabled: true
    categories: [email, ssn, phone]
  semantic:
    enabled: true

schema:
  source: dbt
  dbt:
    manifest_path: target/manifest.json

dialect: snowflake
```

#### Strict Policy Config

```yaml
version: 2

checks:
  lint:
    enabled: true
    severity_overrides:
      L001: error
      L002: critical
  validate:
    enabled: true
  safety:
    enabled: true
  policy:
    enabled: true
    file: .altimate-policy.yml
  pii:
    enabled: true
  semantic:
    enabled: false
  grade:
    enabled: false

dialect: bigquery
```

#### Full Config (All Checks Enabled)

```yaml
version: 2

checks:
  lint:
    enabled: true
    disabled_rules:
      - L009  # order_by_ordinal allowed in our codebase
    severity_overrides:
      L002: critical
      L012: critical
  validate:
    enabled: true
  safety:
    enabled: true
  policy:
    enabled: true
    file: .altimate-policy.yml
  pii:
    enabled: true
    categories:
      - email
      - ssn
      - phone
      - credit_card
      - ip_address
  semantic:
    enabled: true
  grade:
    enabled: true

schema:
  source: dbt
  dbt:
    manifest_path: target/manifest.json

comment:
  mode: both
  max_issues_shown: 30
  show_clean_files: false

dialect: snowflake
```
