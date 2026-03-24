# Configuration Reference

This document covers every configuration option for Altimate Code Actions.

## Action Inputs

Inputs are set in the `with:` block of your workflow step. All inputs are optional.

### Analysis Controls

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | string | `static` | Review mode. `static` runs rule-based analysis only (no API key needed). `ai` uses an AI model for deeper review. `full` combines both. |
| `model` | string | `anthropic/claude-haiku-4-5-20251001` | AI model identifier. Used only in `ai` and `full` modes. Supports Anthropic (`anthropic/claude-*`) and OpenAI (`openai/gpt-*`) model names. |
| `sql_review` | boolean | `true` | Enable SQL quality analysis. Set to `false` to skip static SQL checks. |
| `impact_analysis` | boolean | `false` | Enable dbt DAG impact analysis. Requires a dbt project in the repository. |
| `cost_estimation` | boolean | `false` | Enable query cost estimation. Requires `warehouse_type` and warehouse credentials. |
| `pii_check` | boolean | `false` | Enable PII detection. Scans column names and string literals for personally identifiable information. |

### dbt Configuration

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `dbt_project_dir` | string | *(auto-detect)* | Path to the directory containing `dbt_project.yml`. If not specified, the action searches the repository root and common subdirectories. |
| `dbt_version` | string | *(auto-detect)* | dbt Core version. If not specified, the action reads `require-dbt-version` from `dbt_project.yml` or defaults to `1.9`. Valid values: `1.7`, `1.8`, `1.9`. |
| `manifest_path` | string | *(auto-detect)* | Path to the dbt `manifest.json` artifact. If not specified, the action looks in `target/manifest.json` relative to `dbt_project_dir`. |

### Warehouse Configuration

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `warehouse_type` | string | | Warehouse dialect for cost estimation and SQL dialect awareness. Supported values: `snowflake`, `bigquery`, `postgres`, `databricks`, `redshift`, `mysql`, `sqlserver`, `duckdb`. |

Warehouse credentials are passed via environment variables, not action inputs. See the [Environment Variables](#environment-variables) section below.

### Reporting Controls

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `severity_threshold` | string | `info` | Minimum severity to include in the review. Issues below this threshold are silently dropped. Values: `info`, `warning`, `error`, `critical`. |
| `fail_on` | string | `none` | Fail the GitHub Actions step when issues at this severity or above are found. `none` means the step always succeeds. `error` fails on errors and criticals. `critical` fails only on criticals. |
| `comment_mode` | string | `single` | How to post review feedback. `single` posts one summary comment on the PR. `inline` posts individual comments on changed lines. `both` does both. |
| `max_files` | number | `50` | Maximum number of SQL files to analyze per PR. When the PR exceeds this limit, the most-changed files (by additions) are prioritized. |

### Interactive Mode

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `interactive` | boolean | `false` | Enable interactive mode. When true, the action responds to trigger phrases in PR comments instead of running automatically. |
| `mentions` | string | `@altimate` | Comma-separated list of trigger phrases. When a PR comment starts with any of these phrases, the action runs a review. |

## Action Outputs

Outputs are available to subsequent steps via `${{ steps.<step-id>.outputs.<output> }}`.

| Output | Type | Description |
|--------|------|-------------|
| `issues_found` | number | Total number of issues found across all analyzed files |
| `files_analyzed` | number | Number of SQL files that were analyzed |
| `impact_score` | number | dbt impact score from 0 (no risk) to 100 (high risk). Only set when `impact_analysis: true` |
| `cost_delta` | number | Estimated monthly cost delta in USD (positive = more expensive). Only set when `cost_estimation: true` |
| `comment_url` | string | URL of the PR comment that was posted or updated |
| `report_json` | string | Full `ReviewReport` object serialized as JSON |

### Using Outputs

```yaml
steps:
  - uses: AltimateAI/altimate-code-actions@v1
    id: review
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  - name: Check results
    run: |
      echo "Issues found: ${{ steps.review.outputs.issues_found }}"
      echo "Impact score: ${{ steps.review.outputs.impact_score }}"
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

## Warehouse Connection Examples

### Snowflake

```yaml
- uses: AltimateAI/altimate-code-actions@v1
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
- uses: AltimateAI/altimate-code-actions@v1
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
- uses: AltimateAI/altimate-code-actions@v1
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
