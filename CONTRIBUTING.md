# Contributing to Altimate Code Actions

Thank you for your interest in contributing. This document covers everything you need to get started.

## Prerequisites

- [Bun](https://bun.sh) v1.1+ (package manager and test runner)
- [Node.js](https://nodejs.org) v22+ (action runtime target)
- [Git](https://git-scm.com) with submodule support

## Development Setup

```bash
# Clone the repository with test fixture submodules
git clone --recurse-submodules https://github.com/AltimateAI/altimate-code-actions.git
cd altimate-code-actions

# Install dependencies
bun install

# Verify the setup
bun run typecheck
bun run lint
bun run format:check
```

## Project Structure

```
altimate-code-actions/
  actions/                  # Composite action definitions
    sql-review/             # SQL review sub-action
    impact-analysis/        # dbt impact analysis sub-action
    cost-estimation/        # Cost estimation sub-action
  src/                      # TypeScript source
    analysis/               # Analysis types and interfaces
    context/                # PR context collection
    interactive/            # Interactive mention handling
    reporting/              # PR comment formatting
      templates/            # Comment templates
    util/                   # CLI runner, diff parser, GitHub API
  test/
    unit/                   # Unit tests
    e2e/                    # End-to-end tests
      fixtures/             # Git submodule dbt projects
    integration/            # Integration tests
  dist/                     # Built output (generated, committed for GitHub Actions)
```

## Building

The action is bundled into a single `dist/index.js` file using esbuild:

```bash
bun run build
```

This produces `dist/index.js` targeting Node.js 22 with ESM format. The bundle must stay under 10 MB.

## Running Tests

```bash
# All tests
bun test

# Unit tests only
bun test test/unit/

# E2E tests (requires altimate-code CLI installed)
bun test test/e2e/

# Integration tests (requires GitHub PAT and API keys)
bun test test/integration/
```

### E2E Test Fixtures

The `test/e2e/fixtures/` directory contains git submodules of real dbt projects used for testing:

- **jaffle-shop** -- dbt Labs canonical demo project
- **jaffle-shop-classic** -- Legacy jaffle-shop version
- **mrr-playbook** -- SaaS MRR analytics project
- **dbt-utils** -- dbt utility macros package
- **dbt-date** -- Date dimension package
- **dbt-artifacts** -- dbt artifacts package
- **sakila** -- Classic sakila sample database (SQL files)

To initialize submodules after cloning:

```bash
git submodule update --init --recursive
```

## Code Style

- **TypeScript** with strict mode enabled
- **ESLint** for linting
- **Prettier** for formatting
- All source in `src/`, all tests in `test/`

Run all checks before committing:

```bash
bun run lint
bun run typecheck
bun run format:check
```

To auto-fix formatting:

```bash
bun run format
```

## Adding a New Analysis Rule

1. Define the rule identifier as a string constant (e.g., `"no-select-star"`)
2. Add the detection logic in the appropriate analysis module
3. Return findings as `SQLIssue` objects with the correct `severity`, `rule`, `file`, `line`, and `message`
4. Add unit tests for the new rule
5. Add an E2E test with a fixture SQL file that triggers the rule
6. Document the rule in the README features section

## Pull Request Process

1. Fork the repository and create a feature branch from `main`
2. Make your changes with tests
3. Run the full check suite: `bun run lint && bun run typecheck && bun run format:check && bun test`
4. Commit with conventional commit messages: `feat:`, `fix:`, `docs:`, `test:`, `chore:`
5. Open a pull request against `main`
6. Wait for CI to pass (lint, typecheck, format, unit tests, build)
7. E2E tests run automatically on PRs targeting `main`

### Commit Message Format

```
type: description

Examples:
feat: add UNION vs UNION ALL detection rule
fix: handle missing patch field in renamed files
docs: add BigQuery configuration example
test: add E2E tests for jaffle-shop dbt 1.9
chore: update esbuild to 0.24
```

## Release Process

Releases follow semantic versioning with a floating major tag:

1. Create a `release/X.Y.Z` branch from `main`
2. Push triggers pre-release CI, which runs full E2E matrix and auto-tags `vX.Y.Z-rc.N`
3. When ready, tag `vX.Y.Z` on `main`
4. Release workflow creates a GitHub Release and updates the floating `vX` tag

This means users can pin to `@v1` and always get the latest stable release.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Be respectful, constructive, and inclusive.
