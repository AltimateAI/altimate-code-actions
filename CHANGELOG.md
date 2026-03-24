# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-03-24

### Added
- **Redesigned PR comment format** — compact summary table, collapsible severity-grouped issues, ASCII DAG visualization
- **Inline review comments** — critical issues posted directly on diff lines (configurable via `comment_mode: both`)
- **Interactive commands** — `@altimate review`, `@altimate impact`, `@altimate cost`, `@altimate help`
- **5 new SQL rules** — `function_on_indexed_column`, `not_in_with_nulls`, `distinct_masking_bad_join`, `count_for_existence`, `no_limit_on_delete`
- **Rule categories** — rules grouped into correctness, performance, style, security
- **Fix suggestions** — every rule now provides a concrete fix recommendation
- **ASCII DAG diagrams** — impact analysis shows pipeline dependency tree
- **Cost before/after** — cost section shows per-model before/after/delta

### Changed
- PR comment is now ~8 lines for clean PRs (was ~15)
- Issues grouped by severity with collapsible sections (was flat table)
- Footer uses HTML links instead of markdown (more compact)

### Fixed
- All issues from v0.1.0 UX audit addressed

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
