# PR Comment Design Spec — Competitive Analysis & Design

## Table of Contents

1. [Competitive Analysis: Real PR Comments](#1-competitive-analysis-real-pr-comments)
2. [Design Principles Extracted](#2-design-principles-extracted)
3. [Our PR Comment Design Spec](#3-our-pr-comment-design-spec)
4. [Full Markdown Templates](#4-full-markdown-templates)

---

## 1. Competitive Analysis: Real PR Comments

### 1.1 CodeRabbit

**Source PRs:**
- https://github.com/dagu-org/dagu/pull/1853 (merged, Go project)
- https://github.com/halfdomelabs/baseplate/pull/870 (TypeScript project)
- https://github.com/wavetermdev/waveterm/pull/3108 (large, complex PR)

**Exact Structure (from dagu PR #1853):**

```markdown
<!-- walkthrough_start -->

<details>
<summary>📝 Walkthrough</summary>

## Walkthrough
[1-2 paragraph natural language summary of what the PR does]

## Changes
| Cohort / File(s) | Summary |
|---|---|
| **EnvScope Presolved Filtering** <br> `file1.go`, `file2_test.go` | [description] |
| **Secret Resolver Presolved Handling** <br> `file3.go`, `file4_test.go` | [description] |

## Estimated code review effort
🎯 3 (Moderate) | ⏱️ ~25 minutes

## Possibly related PRs
- **#1581**: [relationship description]

</details>

<details>
<summary>🚥 Pre-merge checks | ✅ 5</summary>

<details>
<summary>✅ Passed checks (5 passed)</summary>

| Check name | Status | Explanation |
|:---:|:---|:---|
| Description Check | ✅ Passed | [reason] |
| Title check | ✅ Passed | [reason] |
| Linked Issues check | ✅ Passed | [reason] |
| Out of Scope Changes check | ✅ Passed | [reason] |
| Docstring Coverage | ✅ Passed | [reason] |

</details>
</details>

<details>
<summary>✨ Finishing Touches</summary>
[Interactive checkboxes for generating docstrings, unit tests]
</details>

---
Thanks for using [CodeRabbit](https://coderabbit.ai)! ...
[Share links: X, Mastodon, Reddit, LinkedIn]
```

**Key Observations:**
- **Comment length:** 8,000-30,000 characters (varies enormously)
- **Uses collapsible `<details>` extensively** — the Walkthrough, Pre-merge checks, and Finishing Touches are ALL collapsible
- **Posts inline review comments** on specific code lines separately
- **Groups files into "cohorts"** by functional area rather than listing individually
- **Estimated review effort** with emoji scale (1-5) and time estimate
- **Pre-merge checks table** with pass/fail per check
- **Failed checks have a separate red section** above passed checks
- **Footer:** Product link + social sharing links + help command reference
- **Heavy HTML comments** for internal state tracking
- **ASCII art cow** appears during processing (whimsy factor)

---

### 1.2 Claude Code Action (Anthropic)

**Source PRs:**
- https://github.com/anthropics/claude-code-action/pull/1075 (review by `claude[bot]`)
- https://github.com/anthropics/claude-code-action/pull/1078 (review by `claude[bot]`)

**Exact Structure (from PR #1078):**

```markdown
LGTM — straightforward addition of the `"i"` flag to all four trigger regex instances, with good test coverage.

<details>
<summary>Extended reasoning...</summary>

### Overview
[1-2 sentence summary of what the PR does]

### Security risks
[Assessment — "None" or specific risks identified]

### Level of scrutiny
[Low/Medium/High with justification]

### Other factors
[Consistency, test coverage, edge cases, outstanding comments]

</details>
```

**Code Review Plugin Format (from docs):**

```markdown
## Code review

Found 3 issues:

1. Missing error handling for OAuth callback (CLAUDE.md says "Always handle OAuth errors")

https://github.com/owner/repo/blob/abc123.../src/auth.ts#L67-L72

2. Memory leak: OAuth state not cleaned up (bug due to missing cleanup in finally block)

https://github.com/owner/repo/blob/abc123.../src/auth.ts#L88-L95
```

**Key Observations:**
- **Comment length:** 500-1,500 characters (extremely concise)
- **One-line verdict up front** (LGTM / "Found N issues")
- **Collapsible reasoning** behind a `<details>` tag
- **Structured sections:** Overview, Security risks, Level of scrutiny, Other factors
- **No fancy formatting** — no tables, no emojis, no badges
- **Confidence filtering:** Only posts issues with confidence >= 80
- **No comment if clean PR** — does not post "everything looks good" comments unless reviewing
- **Footer:** None — no branding at all
- **Inline comments** via separate MCP tool, not in the main comment

---

### 1.3 SonarCloud

**Source:** Official documentation, community forums, marketplace actions

**Reconstructed Format (from multiple sources):**

```
╔═══════════════════════════════════════════╗
║  Quality Gate Passed  /  Quality Gate Failed  ║
╚═══════════════════════════════════════════╝

[SonarCloud logo/badge]

Quality Gate passed

  Issues
  0 New Issues

  Measures
  0 Security Hotspots
  No data about Coverage
  No data about Duplication

[See analysis details on SonarCloud →]
```

**Key Observations:**
- **Pass/fail is THE headline** — Quality Gate status dominates the comment
- **Uses image badges** hosted on sonarcloud-github-static-resources (not markdown)
- **Metrics displayed:** New Issues, Security Hotspots, Coverage %, Duplication %
- **Very compact** — typically 5-10 lines of visible content
- **No collapsible sections** — the comment is short enough it does not need them
- **Links to SonarCloud dashboard** for full details
- **Updates in place** — edits the existing comment on new commits rather than posting new ones
- **Also posts as GitHub Check** — appears in the Checks tab, not just as a comment
- **Inline annotations** on specific code lines for individual issues

---

### 1.4 Snyk

**Source:** Official Snyk documentation (docs.snyk.io)

**Format (reconstructed from docs):**

```markdown
## Snyk Security Check

### Issue Summary

| Severity | Count |
|:--------:|:-----:|
| 🔴 Critical | 2 |
| 🟠 High | 5 |
| 🟡 Medium | 12 |
| 🔵 Low | 3 |

**Total: 22 new issues found**

[View Details →](https://app.snyk.io/...)
```

**Inline Comment Format:**

```
⚡ [Severity] [Issue Name]

[Short description of the vulnerability]

[Data flow information if applicable]

Helpful links:
- [Rule reference]
- [Fix guidance]
```

**Key Observations:**
- **Issue Summary Comment:** Aggregated view with severity breakdown
- **Capped at 10 inline comments** per PR — summary notes if exceeded
- **Updates existing comment** on new commits
- **Severity-based organization** (Critical > High > Medium > Low)
- **Interactive fix commands:** Developers can reply `@snyk /fix` to get automated fixes
- **Zap icon** for auto-fixable vulnerabilities
- **Links to Snyk Web UI** for full details

---

### 1.5 SQLFluff (via reviewdog)

**Source:** Official SQLFluff docs, yu-iskw/action-sqlfluff

**Format:**

SQLFluff does NOT post a summary comment. It uses GitHub's native annotation system via reviewdog:

```
⚠️ Warning: L010 — Inconsistent capitalisation of keywords.
   File: models/staging/stg_orders.sql, Line 15

   Expected: SELECT → select (lowercase)
```

**Key Observations:**
- **No summary comment** — only inline annotations on specific lines
- **Uses GitHub Check Annotations** — appears in the "Files changed" tab
- **Limited to 10 annotations** by GitHub's API constraint
- **Rule ID linked** to SQLFluff documentation
- **Two modes:** `github-check` (annotations) or `github-pr-review` (review comments)
- **Includes fix suggestions** in `fix` mode — shows the corrected SQL inline

---

## 2. Design Principles Extracted

| Principle | CodeRabbit | Claude Code | SonarCloud | Snyk | SQLFluff |
|-----------|:----------:|:-----------:|:----------:|:----:|:--------:|
| Pass/fail at a glance | Pre-merge checks | One-line verdict | Quality Gate badge | Severity table | N/A |
| Collapsible details | Heavy | Light | None | None | N/A |
| Summary comment | Yes (long) | Yes (short) | Yes (compact) | Yes (medium) | No |
| Inline comments | Yes | Yes (separate) | Yes | Yes (capped 10) | Yes |
| Updates in place | No (new comment) | No | Yes | Yes | N/A |
| Tables | Yes | No | No (badges) | Yes | No |
| Links to dashboard | No | No | Yes | Yes | No |
| Footer/branding | Heavy | None | Logo | Minimal | None |
| Estimated effort | Yes | No | No | No | No |
| File grouping | By cohort | By issue | N/A | By severity | By file |

**Key takeaways:**
1. **Short beats long.** SonarCloud and Claude are the most respected for signal-to-noise ratio.
2. **Pass/fail must be instant.** Every successful tool shows status in the first line.
3. **Collapsible sections are essential** for anything > 10 lines.
4. **Update in place** is better UX than posting new comments on each push.
5. **Inline comments are a must** for specific issues — keep the summary comment high-level.
6. **Link to details** rather than dumping everything in the comment.
7. **Severity-based organization** is universal for issue-based tools.

---

## 3. Our PR Comment Design Spec

### A. Header Design — Pass/Fail at a Glance

Use a single-line header with emoji + bold status. No images (they break in email notifications).

- Pass: `## ✅ DataPilot — All checks passed`
- Warning: `## ⚠️ DataPilot — 3 warnings found`
- Fail: `## ❌ DataPilot — 1 critical issue found`

The status word is the FIRST thing a reviewer sees. No logo, no filler.

### B. Summary Section — Compact Metrics

A single table showing all analysis results. Inspired by SonarCloud's compactness and Snyk's severity breakdown.

```markdown
| Check | Result | Details |
|:------|:------:|:--------|
| SQL Analysis | ✅ Passed | 0 issues |
| dbt Model Validation | ⚠️ 3 warnings | 2 style, 1 performance |
| Cost Impact | ✅ No change | $0.00 delta |
| DAG Impact | ℹ️ 4 models affected | 2 direct, 2 downstream |
```

**Design rationale:** One row per analysis domain. Result column is scannable. Details column provides context without needing to click.

### C. Details Section — Issues Organized by Severity

All issues in a collapsible section. Grouped by severity, each with file location and rule ID.

```markdown
<details>
<summary>⚠️ 3 warnings found</summary>

### Performance
| # | File | Issue | Rule |
|:-:|:-----|:------|:-----|
| 1 | `models/staging/stg_orders.sql:15` | Full table scan on large table | [PERF001](link) |

### Style
| # | File | Issue | Rule |
|:-:|:-----|:------|:-----|
| 2 | `models/marts/fct_revenue.sql:8` | Implicit column ordering | [STYLE003](link) |
| 3 | `models/marts/fct_revenue.sql:22` | SELECT * usage | [STYLE001](link) |

</details>
```

**Design rationale:** Collapsible so clean PRs stay clean. Severity groups (Critical > Warning > Info) match Snyk's model. Rule IDs link to docs.

### D. Impact Section — dbt DAG Impact (Our Differentiator)

This is what NO competitor offers. Show which downstream models are affected by changes in this PR.

```markdown
<details>
<summary>📊 DAG Impact — 4 models affected</summary>

**Modified models (2):**
- `stg_orders` — 12 downstream dependents
- `stg_payments` — 8 downstream dependents

**Downstream impact (2):**
- `fct_revenue` ← depends on `stg_orders`, `stg_payments`
- `dim_customers` ← depends on `stg_orders`

```
stg_orders ──→ fct_revenue ──→ report_weekly_revenue
     └──────→ dim_customers
stg_payments ─→ fct_revenue
```

</details>
```

**Design rationale:** ASCII DAG is lightweight, works in email, and immediately shows blast radius. Upstream tools only show file-level changes — we show *data pipeline impact*.

### E. Cost Section — Cost Delta

Only shown when cost analysis is available and delta is non-zero.

```markdown
<details>
<summary>💰 Cost Impact — +$12.50/day estimated</summary>

| Model | Before | After | Delta |
|:------|-------:|------:|------:|
| `stg_orders` | $3.20/day | $8.70/day | +$5.50 |
| `fct_revenue` | $7.00/day | $14.00/day | +$7.00 |

**Cause:** New JOIN in `stg_orders` increases scan volume by ~2.5x.

</details>
```

**Design rationale:** Cost visibility in PRs is extremely rare — only FinOps-specific tools do this. Showing the delta per model with a human-readable cause makes it actionable.

### F. Footer

Minimal. Link to docs, version, one-line branding. Inspired by Claude's restraint (no footer) with just enough for support.

```markdown
---
<sub>🔍 [DataPilot](https://datapilot.ai) v0.5.9 · [Docs](https://docs.datapilot.ai) · [Configure](https://docs.datapilot.ai/github-action)</sub>
```

### G. Length Guidelines

| Scenario | Approximate length | Sections shown |
|:---------|:------------------:|:---------------|
| 0 issues (clean) | 6-8 lines | Header + summary table + footer |
| 1-5 warnings | 15-25 lines | Header + summary table + collapsible issues + footer |
| Critical issues | 20-40 lines | Header + summary table + collapsible issues + DAG impact + footer |
| Full analysis (50+ issues) | 30-50 lines visible | Header + summary table + collapsible issues (grouped) + DAG + cost + footer |

**Key constraint:** The comment should NEVER exceed ~50 visible lines. Everything beyond the summary table goes into `<details>` tags.

### H. Inline Comments

Yes, post inline review comments for:
- **Critical issues** — always inline (max 10 per PR to avoid spam)
- **Warnings** — inline only if <= 5 total
- **Info/style** — never inline, only in summary comment

Inline comment format:
```markdown
⚠️ **[PERF001] Full table scan detected**

This query scans the entire `orders` table (~2.5M rows). Consider adding a `WHERE` clause or partitioning.

📖 [Rule docs](link) · 💡 [Suggested fix](link)
```

---

## 4. Full Markdown Templates

### Scenario A: 0 Issues Found (Clean PR)

```markdown
## ✅ DataPilot — All checks passed

| Check | Result | Details |
|:------|:------:|:--------|
| SQL Analysis | ✅ Passed | 0 issues in 3 files |
| dbt Validation | ✅ Passed | 2 models validated |
| DAG Impact | ℹ️ 2 models | 0 downstream affected |

---
<sub>🔍 [DataPilot](https://datapilot.ai) v0.5.9 · [Docs](https://docs.datapilot.ai) · [Configure](https://docs.datapilot.ai/github-action)</sub>
```

**Visible lines: ~8**
No collapsible sections. No inline comments posted. Clean and fast to scan.

---

### Scenario B: 3 Warnings Found

```markdown
## ⚠️ DataPilot — 3 warnings found

| Check | Result | Details |
|:------|:------:|:--------|
| SQL Analysis | ⚠️ 3 warnings | 1 performance, 2 style |
| dbt Validation | ✅ Passed | 2 models validated |
| DAG Impact | ℹ️ 3 models | 1 downstream affected |

<details>
<summary>⚠️ 3 warnings — click to expand</summary>

#### Performance (1)

| File | Issue | Rule |
|:-----|:------|:-----|
| `models/staging/stg_orders.sql:15` | Cartesian join risk — missing JOIN condition | [PERF002](https://docs.datapilot.ai/rules/PERF002) |

#### Style (2)

| File | Issue | Rule |
|:-----|:------|:-----|
| `models/marts/fct_revenue.sql:8` | Implicit column ordering in SELECT | [STYLE003](https://docs.datapilot.ai/rules/STYLE003) |
| `models/marts/fct_revenue.sql:22` | Unused CTE `raw_payments` | [STYLE007](https://docs.datapilot.ai/rules/STYLE007) |

</details>

---
<sub>🔍 [DataPilot](https://datapilot.ai) v0.5.9 · [Docs](https://docs.datapilot.ai) · [Configure](https://docs.datapilot.ai/github-action)</sub>
```

**Visible lines: ~10** (details collapsed)
Inline comments: 3 warnings posted as review comments on the specific lines.

---

### Scenario C: 1 Critical + 5 Warnings + Impact Analysis + Cost Delta

```markdown
## ❌ DataPilot — 1 critical issue found

| Check | Result | Details |
|:------|:------:|:--------|
| SQL Analysis | ❌ 1 critical, 5 warnings | 2 performance, 3 style, 1 correctness |
| dbt Validation | ✅ Passed | 4 models validated |
| Cost Impact | 🔺 +$18.50/day | `stg_orders` query cost increased |
| DAG Impact | ⚠️ 7 models affected | 2 modified, 5 downstream |

<details>
<summary>❌ 1 critical issue</summary>

#### Critical (1)

| File | Issue | Rule |
|:-----|:------|:-----|
| `models/staging/stg_orders.sql:34` | Non-deterministic JOIN produces duplicate rows — `order_id` is not unique in `payments` | [CORRECT001](https://docs.datapilot.ai/rules/CORRECT001) |

**Impact:** This will cause `fct_revenue` to over-count revenue by the duplication factor. 5 downstream models affected.

</details>

<details>
<summary>⚠️ 5 warnings</summary>

#### Performance (2)

| File | Issue | Rule |
|:-----|:------|:-----|
| `models/staging/stg_orders.sql:12` | Full table scan on `raw_orders` (~2.5M rows) | [PERF001](https://docs.datapilot.ai/rules/PERF001) |
| `models/staging/stg_orders.sql:28` | Redundant subquery can be simplified to direct JOIN | [PERF003](https://docs.datapilot.ai/rules/PERF003) |

#### Style (3)

| File | Issue | Rule |
|:-----|:------|:-----|
| `models/marts/fct_revenue.sql:5` | `SELECT *` on source table | [STYLE001](https://docs.datapilot.ai/rules/STYLE001) |
| `models/marts/fct_revenue.sql:18` | Inconsistent keyword casing (mixed UPPER/lower) | [STYLE002](https://docs.datapilot.ai/rules/STYLE002) |
| `models/marts/dim_customers.sql:9` | Unused CTE `payment_summary` | [STYLE007](https://docs.datapilot.ai/rules/STYLE007) |

</details>

<details>
<summary>📊 DAG Impact — 7 models affected</summary>

**Modified in this PR (2):**
- `stg_orders` — 5 downstream dependents
- `stg_payments` — 3 downstream dependents

**Downstream impact (5):**
- `fct_revenue` ← `stg_orders` + `stg_payments`
- `dim_customers` ← `stg_orders`
- `fct_orders` ← `stg_orders`
- `report_weekly_revenue` ← `fct_revenue`
- `report_customer_ltv` ← `dim_customers` + `fct_revenue`

```
stg_orders ──┬──→ fct_revenue ──┬──→ report_weekly_revenue
             ├──→ dim_customers ─┤
             └──→ fct_orders     └──→ report_customer_ltv
stg_payments ────→ fct_revenue
```

</details>

<details>
<summary>💰 Cost Impact — +$18.50/day estimated</summary>

| Model | Before | After | Delta |
|:------|-------:|------:|------:|
| `stg_orders` | $3.20/day | $14.70/day | **+$11.50** |
| `fct_revenue` | $7.00/day | $14.00/day | **+$7.00** |

**Root cause:** New JOIN in `stg_orders` against un-partitioned `payments` table increases scan volume ~4.5x. The cost propagates to `fct_revenue` due to larger intermediate result set.

**Recommendation:** Add partition filter on `payment_date` to reduce scan scope.

</details>

---
<sub>🔍 [DataPilot](https://datapilot.ai) v0.5.9 · [Docs](https://docs.datapilot.ai) · [Configure](https://docs.datapilot.ai/github-action)</sub>
```

**Visible lines: ~12** (all details collapsed)
**Expanded lines: ~70**

**Inline comments posted (max 10):**
1. Critical issue on `stg_orders.sql:34` (always inline)
2. Performance warning on `stg_orders.sql:12` (inline because <= 5 warnings per file)
3. Performance warning on `stg_orders.sql:28`
4. Style issues NOT posted inline (info-level, too noisy)

---

## 5. Implementation Notes

### Comment ID Strategy
- Use HTML comment markers (`<!-- datapilot-pr-analysis -->`) at the top of the comment
- On subsequent pushes, find and UPDATE the existing comment rather than posting a new one
- This matches SonarCloud and Snyk behavior — avoids comment spam

### Inline Comment Strategy
- Post as a GitHub PR Review with individual file comments
- Cap at 10 inline comments total (matches Snyk's cap)
- Prioritize: Critical > Performance > Correctness > Style
- Each inline comment is self-contained with rule link and fix suggestion

### When NOT to Comment
- Skip comment entirely for PRs that only modify non-SQL files (`.md`, `.yml`, configs)
- Skip comment for draft PRs unless explicitly configured
- Skip inline comments for issues that are in files not modified by the PR

### Update Behavior
- First run: Create new comment
- Subsequent runs (new push to same PR): Update existing comment in place
- If PR is closed/merged: Do not post

### Configuration Options (future)
```yaml
# .datapilot.yml
github_action:
  comment: true              # Post summary comment
  inline_comments: true      # Post inline review comments
  max_inline_comments: 10    # Cap on inline comments
  fail_on: critical          # Fail the check on: critical | warning | never
  cost_analysis: true        # Include cost delta
  dag_impact: true           # Include DAG impact analysis
  collapse_threshold: 0      # Always collapse details (0 = always)
```
