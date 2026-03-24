# Architecture

This document describes how Altimate Code Actions works under the hood.

## Overview

Altimate Code Actions is a JavaScript GitHub Action (bundled via esbuild) that orchestrates the [altimate-code](https://github.com/AltimateAI/altimate-code) CLI to analyze SQL and dbt changes in pull requests. The action collects PR context via the GitHub API, runs analysis through the CLI, and posts results back as PR comments.

```
┌─────────────────────────────────────────────┐
│               GitHub Actions Runner          │
│                                              │
│  ┌──────────┐    ┌──────────────────────┐   │
│  │  Action   │───>│   altimate-code CLI  │   │
│  │  (JS)     │<───│                      │   │
│  └──────────┘    └──────────────────────┘   │
│       │                    │                 │
│       v                    v                 │
│  ┌──────────┐    ┌──────────────────────┐   │
│  │ GitHub   │    │  AI Model API        │   │
│  │ API      │    │  (Anthropic/OpenAI)  │   │
│  └──────────┘    └──────────────────────┘   │
│                          │                   │
│                          v                   │
│                  ┌──────────────────────┐   │
│                  │  Warehouse           │   │
│                  │  (Snowflake/BQ/PG)   │   │
│                  └──────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Execution Flow

### 1. Context Collection (`src/context/pr.ts`)

When the action starts, it reads the GitHub event payload to determine:

- The pull request number, head SHA, and base branch
- The PR title and body (used for AI context in `ai`/`full` modes)

It then calls the GitHub API to fetch the list of changed files with their patches. Files are categorized:

- **SQL files** (`.sql`, `.sqlx`) -- candidates for SQL analysis
- **dbt files** (`.sql`, `.yml`, `.yaml`, `.py`) -- candidates for impact analysis

Files marked as `removed` are excluded from analysis since there is no new code to review.

### 2. Diff Parsing (`src/util/diff-parser.ts`)

The unified diff patches from the GitHub API are parsed into structured representations:

- Each file becomes a `ParsedDiff` with its hunks
- Each hunk contains `DiffLine` objects typed as `add`, `remove`, or `context`
- Line numbers are tracked for both the old and new side of the diff

This structured diff is used for:

- Extracting only added/modified SQL for analysis (avoiding false positives on removed code)
- Mapping issues back to specific lines for inline PR comments
- Reconstructing the full new-side file content when needed

### 3. CLI Execution (`src/util/cli.ts`)

The action spawns the `altimate-code` CLI as a child process. The CLI is installed in the runner as part of the action setup. Communication happens over stdio:

- Arguments and options are passed as command-line flags
- Results are returned as JSON on stdout
- The action parses the JSON into typed `ReviewReport` objects

Key behaviors:

- **Timeout handling**: Each CLI invocation has a 5-minute timeout. On timeout, the process receives SIGTERM followed by SIGKILL after 5 seconds.
- **Error handling**: Non-zero exit codes are captured and returned in the result. The calling code decides whether to throw or continue.
- **Environment forwarding**: Warehouse credentials and API keys are passed as environment variables to the CLI process.

### 4. Analysis Pipeline

The analysis runs in stages, each optional based on configuration:

```
Input (changed SQL files)
       │
       v
┌──────────────────┐
│  Static Analysis │  Always-on rule checks (no external calls)
│  (sql_review)    │  Anti-patterns, PII detection, style checks
└──────────────────┘
       │
       v
┌──────────────────┐
│  AI Review       │  AI-powered deep analysis (requires API key)
│  (mode: ai/full) │  Context-aware suggestions, logic errors
└──────────────────┘
       │
       v
┌──────────────────┐
│  Impact Analysis │  dbt DAG traversal (requires dbt project)
│  (impact_analysis│  Downstream models, exposures, tests
└──────────────────┘
       │
       v
┌──────────────────┐
│  Cost Estimation │  Warehouse EXPLAIN queries (requires credentials)
│  (cost_estimation│  Before/after cost comparison
└──────────────────┘
       │
       v
   ReviewReport
```

Each stage produces typed results that are aggregated into a single `ReviewReport` containing:

- `issues[]` -- All SQL issues with severity, file, line, rule, and message
- `impact` -- Modified models, downstream models, exposures, tests, impact score
- `costEstimates[]` -- Per-file/model cost deltas
- `shouldFail` -- Whether the action should exit with a failure code

### 5. PR Comment Lifecycle (`src/util/octokit.ts`)

The reporting layer formats the `ReviewReport` into Markdown and posts it to the pull request.

**Sticky comment pattern**: Every Altimate comment starts with an HTML marker (`<!-- altimate-code-review -->`). When posting a comment, the action first searches existing PR comments for this marker. If found, the existing comment is updated in place. If not found, a new comment is created.

This means:

- Pushing new commits to a PR updates the review rather than adding duplicate comments
- The comment always reflects the latest analysis
- Users see a single, evolving review thread

**Comment modes**:

- `single` -- One summary comment on the PR with a table of all issues
- `inline` -- Individual review comments on specific changed lines using the GitHub pull request review API
- `both` -- Posts both a summary comment and inline comments

**Inline comments** use the `createReviewComment` API with the `path`, `line`, and `side: RIGHT` parameters to place comments exactly on the changed lines in the diff view.

### 6. Failure Handling

The `fail_on` input controls whether the action exits with a non-zero code:

| `fail_on` | Behavior |
|-----------|----------|
| `none` | Action always succeeds (exit 0), even if issues are found |
| `error` | Action fails if any issue has severity `error` or `critical` |
| `critical` | Action fails only if any issue has severity `critical` |

The severity comparison uses numeric weights: `info=0`, `warning=1`, `error=2`, `critical=3`.

## Type System (`src/analysis/types.ts`)

The action uses a comprehensive TypeScript type system for all data flowing through the pipeline:

- `Severity` enum with numeric weights for comparison
- `SQLIssue` for individual findings
- `ImpactResult` for dbt DAG analysis
- `CostEstimate` for per-model cost deltas
- `ReviewReport` as the top-level aggregation
- `ActionConfig` for parsed action inputs
- `ParsedDiff`, `DiffHunk`, `DiffLine` for structured diffs
- `DBTManifest`, `DBTModel` for dbt project metadata

## Build System

The action is bundled using esbuild (`esbuild.config.ts`):

- **Entry point**: `src/index.ts`
- **Output**: `dist/index.js` (single file, ESM format)
- **Target**: Node.js 22
- **Sourcemaps**: Enabled for debugging
- **Banner**: Includes `createRequire` shim for CJS compatibility

The `dist/` directory is committed to the repository because GitHub Actions requires the built JavaScript to be present in the repository at the tag/ref that is referenced.

## CI/CD Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push to main, PRs | Lint, typecheck, format, unit tests, build |
| `e2e.yml` | PRs to main | E2E tests against dbt 1.7/1.8/1.9 x Python 3.10/3.11/3.12 matrix |
| `dogfood.yml` | PRs with SQL/YAML changes | Runs the action on its own PRs |
| `integration.yml` | Nightly + manual | Creates a real PR in a test repo and validates the full flow |
| `pre-release.yml` | Push to `release/*` | Full CI + E2E, auto-tags RC versions |
| `release.yml` | Push tags `v*` | Creates GitHub Release, updates floating major tag |

## Security Model

- **Code isolation**: All analysis runs inside the GitHub Actions runner. Source code is not sent to external servers.
- **AI model calls**: In `ai`/`full` mode, changed SQL content is sent to the configured AI model API (Anthropic or OpenAI). Only the diff content is sent, not the entire repository.
- **Warehouse credentials**: Used exclusively for `EXPLAIN` queries during cost estimation. Credentials are passed as environment variables and never logged.
- **GitHub token**: Used for reading PR metadata, fetching file content, and posting comments. The default `GITHUB_TOKEN` has the minimum permissions needed (`pull-requests: write`, `contents: read`).
- **Secrets masking**: GitHub Actions automatically masks secrets in logs. The action does not print credentials or API keys.
