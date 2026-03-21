---
name: report
description: "Generate a comprehensive public-company financial report and PDF export. Usage: /report <ticker> [focus]"
user-invocable: true
disable-model-invocation: true
metadata: { "openclaw": { "skillKey": "opencode-finance-report", "requires": { "env": ["ALPHAVANTAGE_API_KEY", "SEC_EDGAR_IDENTITY"] } } }
---

# Report

Run this skill only when the user invokes `/report`.

Parse the raw arguments after `/report`:

- first token: required public-company ticker, normalize to uppercase
- remaining text: optional focus string

If ticker is missing, stop and reply with:
`Usage: /report <ticker> [focus]`

Use today's date in `YYYY-MM-DD` format as `report_date`.

Write all report artifacts under:
`reports/<ticker>/<report_date>/`

Produce:

- `report.md`
- `dashboard.md`
- `assumptions.json`
- `adjustment-log.md`

Then always generate:

- `<ticker>-<report_date>.pdf`

Workflow requirements:

1. Build a very comprehensive public-company financial report for the ticker.
2. Use `financial_search` with `coverage: "comprehensive"` for numeric financial claims.
3. Use `financial_search` with `intent: "insider"` and `coverage: "comprehensive"` for insider analysis and reference `ownershipChange` when available.
4. Use Exa-style web/news search only for qualitative catalyst context, never for numeric financial metrics.
5. Keep observed data, modeled assumptions, and analytical inference clearly separated.
6. Never emit `N/A`. Use observed values, `unknown`, or explicit reason text.
7. Do not ask a PDF question. After markdown artifacts are written, always call `report_pdf` with:
   - `subcommand`: `report`
   - `outputRoot`: `reports/<ticker>/<report_date>/`
   - `filename`: `<ticker>-<report_date>.pdf`

`report.md` requirements:

- Include metadata lines at the top:
  - `Sector: <value>`
  - `Headquarters: <value>`
  - `Website: <value>`
  - `Icon URL: <value>`
- Include dedicated sections for:
  - technical analysis
  - fundamental analysis
  - risk assessment
  - portfolio fit
  - market intelligence
  - scenario valuation
  - directional conviction score and monitoring triggers
- Include:
  - `Top Positive Drivers`
  - `Top Negative Drivers`
- Use IEEE-style numbered citations with `[N]` in text.
- End with a final `## Sources` section. It must be the last section in `report.md`.

`dashboard.md` requirements:

- Use KPI tables with exactly these columns:
  `| KPI | Value | Period | Source | Source URL | Retrieval timestamp |`
- Include separate rows for:
  - Stock price
  - Previous close
  - Daily change
  - Daily change percent
  - 52W high/low or 52W range
  - YTD return
  - Market cap
  - Analyst consensus
  - Revenue
  - Net income
  - Free cash flow
  - Debt-to-equity

`assumptions.json` requirements:

- include `scenario_assumptions`
- include `score_inputs`
- include `factor_weights`
- include `uncertainty_flags`

Analysis requirements:

- include `directional_conviction_score` from `0-100`
- map the score to `bearish` (`0-39`), `neutral` (`40-59`), or `bullish` (`60-100`)
- include thesis, top risks, catalysts, monitoring triggers, and weighted drivers
- if portfolio data is missing, render portfolio fit as:
  `Not evaluated: missing portfolio holdings, benchmark, and mandate`

Return a concise in-chat executive summary plus the artifact paths, including the generated PDF path.

Keep the output analytic and non-advisory.
