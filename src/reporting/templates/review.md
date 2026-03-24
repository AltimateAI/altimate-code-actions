## {{ICON}} Altimate Code Review

{{SUMMARY_LINE}}

{{#IF_ISSUES}}
### SQL Issues ({{ISSUE_COUNT}})

| Severity | File | Line | Rule | Message |
|----------|------|------|------|---------|
{{ISSUE_ROWS}}

{{#IF_SUGGESTIONS}}
<details>
<summary>Suggestions</summary>

{{SUGGESTIONS}}

</details>
{{/IF_SUGGESTIONS}}
{{/IF_ISSUES}}

{{#IF_IMPACT}}
### Impact Analysis

| Metric | Value |
|--------|-------|
| Modified Models | {{MODIFIED_MODELS}} |
| Downstream Models | {{DOWNSTREAM_COUNT}} |
| Affected Exposures | {{EXPOSURE_COUNT}} |
| Affected Tests | {{TEST_COUNT}} |
| **Impact Score** | **{{IMPACT_SCORE}}/100** |

{{#IF_DOWNSTREAM}}
<details>
<summary>Downstream models ({{DOWNSTREAM_COUNT}})</summary>

{{DOWNSTREAM_LIST}}

</details>
{{/IF_DOWNSTREAM}}

{{#IF_EXPOSURES}}
> **Warning:** This change affects {{EXPOSURE_COUNT}} exposure(s): {{EXPOSURE_LIST}}
{{/IF_EXPOSURES}}
{{/IF_IMPACT}}

{{#IF_COST}}
### Cost Estimation

| File | Delta (USD/month) | Explanation |
|------|--------------------|-------------|
{{COST_ROWS}}

**Total monthly delta:** {{TOTAL_COST_DELTA}}
{{/IF_COST}}

---
<sub>{{FOOTER}}</sub>
