# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-24

### Added
- SQL quality analysis with 19 anti-pattern rule categories (SELECT *, missing WHERE, implicit joins, unused CTEs, ambiguous columns, and more)
- dbt DAG impact analysis with downstream model enumeration, exposure alerting, test coverage checks, and aggregate impact scoring (0-100)
- Query cost estimation with before/after monthly cost comparison for Snowflake and BigQuery
- PII detection across 15 categories (email, phone, SSN, credit card, IP address, date of birth, name, address, passport, driver license, national ID, bank account, health records, biometric data, geolocation)
- Interactive mode via `@altimate` mentions in PR comments
- Schema breaking change detection for column renames and removals
- Multi-dialect SQL support: Snowflake, BigQuery, PostgreSQL, Databricks, Redshift, MySQL, SQL Server, DuckDB
- dbt version compatibility: 1.7, 1.8, 1.9 (tested against Python 3.10, 3.11, 3.12)
- Configurable severity thresholds (`info`, `warning`, `error`, `critical`)
- Three comment modes: `single` (summary), `inline` (per-line), `both`
- `fail_on` input to fail CI on issues at a given severity or above
- Sticky PR comments that update in place on subsequent pushes
- Unified diff parsing for precise line-level issue mapping
- E2E test suite against real dbt projects (jaffle-shop, mrr-playbook, dbt-utils, dbt-date, sakila, dbt-artifacts)
- Nightly integration tests against a live test repository
- Dogfood workflow that runs the action on its own PRs
- Pre-release workflow with automatic RC tagging from `release/*` branches
