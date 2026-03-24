# Getting Started

This guide walks you through adding Altimate Code Actions to your repository in under five minutes.

## Prerequisites

- A GitHub repository containing `.sql` files or a dbt project
- GitHub Actions enabled on the repository
- (Optional) An Anthropic or OpenAI API key for AI-powered reviews

## Step 1: Create the Workflow File

Create `.github/workflows/altimate-review.yml` in your repository:

```yaml
name: Altimate Code Review

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  pull-requests: write
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: AltimateAI/altimate-code-actions@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

This minimal configuration runs static SQL analysis on every pull request. No API keys or warehouse credentials are needed.

### For dbt Projects

If your repository contains a dbt project, enable impact analysis:

```yaml
      - uses: AltimateAI/altimate-code-actions@v0
        with:
          impact_analysis: true
          dbt_project_dir: ./  # path to your dbt_project.yml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### For AI-Powered Reviews

To get deeper, context-aware analysis using Claude:

```yaml
      - uses: AltimateAI/altimate-code-actions@v0
        with:
          mode: ai
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Step 2: Add Secrets

If you are using AI-powered mode or cost estimation, add the required API keys as repository secrets:

1. Go to your repository on GitHub
2. Navigate to **Settings** > **Secrets and variables** > **Actions**
3. Click **New repository secret**
4. Add the relevant secrets:

| Secret | When Needed |
|--------|-------------|
| `ANTHROPIC_API_KEY` | `mode: ai` or `mode: full` with Anthropic models |
| `OPENAI_API_KEY` | `mode: ai` or `mode: full` with OpenAI models |
| `SNOWFLAKE_ACCOUNT` | `cost_estimation: true` with Snowflake |
| `SNOWFLAKE_USER` | `cost_estimation: true` with Snowflake |
| `SNOWFLAKE_PASSWORD` | `cost_estimation: true` with Snowflake |
| `BIGQUERY_CREDENTIALS` | `cost_estimation: true` with BigQuery |

`GITHUB_TOKEN` is provided automatically by GitHub Actions and does not need to be added manually.

## Step 3: Open a Pull Request

Create or update a pull request that modifies `.sql` files. The Altimate Code Review workflow will trigger automatically.

You can track the workflow run in the **Actions** tab of your repository.

## Step 4: See Results

Once the workflow completes, Altimate posts a structured review comment on your pull request with:

- A summary showing files analyzed and issues found
- A table of issues with severity, file, line number, rule, and message
- dbt impact analysis (if enabled) showing downstream models, exposures, and tests
- Cost estimation (if enabled) showing before/after cost deltas

If you push additional commits, the existing comment is updated in place rather than creating a new one.

## dbt Projects in CI

### Does the action run `dbt compile` automatically?

No. Altimate Code Actions does not run `dbt compile` for you. If your analysis requires a dbt manifest (for impact analysis, downstream dependency tracing, etc.), you must either:

1. **Compile dbt in your workflow** before running the action
2. **Provide a pre-built manifest** from dbt Cloud or another CI step

### Providing `profiles.yml` for CI

dbt needs a `profiles.yml` to compile. In CI, create a minimal one using environment variables. You can use DuckDB if you only need compilation (no warehouse queries):

```yaml
# profiles.yml for CI compilation only (no warehouse needed)
ci:
  target: ci
  outputs:
    ci:
      type: duckdb
      path: /tmp/ci.duckdb
```

For warehouse-connected compilation (e.g., Snowflake):

```yaml
ci:
  target: ci
  outputs:
    ci:
      type: snowflake
      account: "{{ env_var('SNOWFLAKE_ACCOUNT') }}"
      user: "{{ env_var('SNOWFLAKE_USER') }}"
      password: "{{ env_var('SNOWFLAKE_PASSWORD') }}"
      warehouse: "{{ env_var('SNOWFLAKE_WAREHOUSE') }}"
      database: "{{ env_var('SNOWFLAKE_DATABASE') }}"
      schema: "{{ env_var('SNOWFLAKE_SCHEMA') }}"
```

### Running `dbt deps`

If your dbt project uses packages (defined in `packages.yml`), you must run `dbt deps` before compilation. The action does not install dbt packages for you.

### Complete dbt CI Workflow

```yaml
name: Altimate dbt Review
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  pull-requests: write
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - run: pip install dbt-core dbt-snowflake

      - run: dbt deps

      - run: dbt compile --target ci

      - uses: AltimateAI/altimate-code-actions@v0
        with:
          mode: static
          manifest_path: target/manifest.json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Using a Pre-Built Manifest from dbt Cloud

If you use dbt Cloud CI, you can download the manifest artifact and pass it to the action instead of compiling locally:

```yaml
steps:
  - uses: actions/checkout@v4

  # Download manifest from dbt Cloud (using the dbt Cloud API)
  - name: Download dbt Cloud manifest
    run: |
      curl -H "Authorization: Bearer ${{ secrets.DBT_CLOUD_API_TOKEN }}" \
        -o target/manifest.json \
        "https://cloud.getdbt.com/api/v2/accounts/${{ secrets.DBT_CLOUD_ACCOUNT_ID }}/runs/${{ secrets.DBT_CLOUD_RUN_ID }}/artifacts/manifest.json"

  - uses: AltimateAI/altimate-code-actions@v0
    with:
      manifest_path: target/manifest.json
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Troubleshooting

### "No pull request found in the GitHub event"

The action must run on a `pull_request` or `issue_comment` event. Ensure your workflow trigger is correct:

```yaml
on:
  pull_request:
    types: [opened, synchronize]
```

### "GITHUB_TOKEN is not set"

Make sure you pass the token via the `env` block:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### No comment appears on the PR

1. Check that the workflow has `pull-requests: write` permission
2. Verify the workflow actually ran in the Actions tab
3. If there are no SQL files in the PR, the action skips analysis and does not post a comment

### "altimate-code CLI timed out"

The default timeout is 5 minutes per CLI invocation. If your project has many SQL files, you can:

- Increase the timeout (the action retries internally)
- Reduce `max_files` to limit the number of files analyzed per PR
- Use `severity_threshold: warning` to skip info-level checks

### dbt project not detected

If your `dbt_project.yml` is not at the repository root, specify the path:

```yaml
with:
  dbt_project_dir: ./path/to/dbt/project
```

### Cost estimation returns no results

Cost estimation requires:

1. `cost_estimation: true` in the action inputs
2. `warehouse_type` set to a supported warehouse (`snowflake` or `bigquery`)
3. Valid warehouse credentials in environment variables
4. The changed SQL files must contain queries that can be explained by the warehouse

### AI mode fails with authentication error

Verify that your API key secret is correctly named and has a valid value:

- For Anthropic: `ANTHROPIC_API_KEY` must be a valid `sk-ant-*` key
- For OpenAI: `OPENAI_API_KEY` must be a valid `sk-*` key

## Next Steps

- [Configuration Reference](configuration.md) -- Full list of inputs, outputs, and environment variables
- [Architecture](architecture.md) -- How the action works under the hood
- [Example Workflows](examples/) -- Copy-paste workflow files for common scenarios
