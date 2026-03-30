---
name: finance-comprehensive-report
description: Build a decision-first, evidence-tagged, audit-traceable public-company financial report using public filings, management commentary, ownership data, market context, and scenario valuation.
managed_by: opencode-finance
workflow_version: 5
---

# Finance Comprehensive Report

## Objective
- This report is a decision document, not a filing paraphrase.
- It must answer four questions clearly:
  - what matters
  - what changed
  - what is easy to miss
  - what would prove the thesis wrong
- Run the report in three layers at once:
  - factual layer: what happened
  - analytical layer: what actually drove it
  - monitoring layer: what to watch next
- Optimize for auditability and falsifiability over narrative smoothness.

## Input Requirements
- `ticker` (required): public company symbol, for example `AAPL`.
- `focus` (optional): emphasis area such as `forensic`, `valuation`, `governance`, `credit`, `capital-allocation`, or `variant-perception`.
- `report_date` (optional): date override in `YYYY-MM-DD`; default to today.
- `output_root` (optional): base output directory; default `reports/<ticker>/<report_date>/`.
- `portfolio_context` (optional): existing positions, weights, mandate, and risk budget for portfolio-fit analysis.
- `benchmark` (optional): market or sector benchmark symbol, for example `SPY`, `QQQ`, or a sector ETF.

## Evidence Rules
- Every meaningful statement in `report.md` must be explicitly labeled as one of:
  - `Observed`
  - `Inferred`
  - `Management-claimed`
  - `Market-implied`
  - `Needs verification`
- Add confidence to material bullets when possible: `High`, `Medium`, or `Low`.
- Use short labels at the start of material bullets or paragraphs, for example:
  - `[Observed | High]`
  - `[Inferred | Medium]`
  - `[Needs verification | Low]`
- Do not let inference read like fact.
- If a source class was not reviewed or evidence is incomplete, explicitly downgrade the claim to `Needs verification`.

## Public Source Coverage
- Build a source map covering all material public information reviewed or expected for the run.
- Attempt to cover, when public and relevant:
  - annual report / `10-K` / `20-F`
  - quarterly / half-year filings / `10-Q`
  - `8-K` / current reports
  - earnings release
  - earnings call transcript or webcast summary
  - investor presentation / capital markets day material
  - proxy statement
  - Forms `3/4/5`
  - Schedules `13D/13G`
  - debt documents, covenant summaries, and credit-rating commentary when public
  - major press releases, litigation updates, regulatory disclosures, and financing announcements
- For each source-map entry, record:
  - `source class`
  - `specific item`
  - `date`
  - `status` (`retrieved`, `not retrieved`, `not applicable`)
  - `basis` (`company-stated`, `regulator-filed`, `market-data`, `analyst-inferred`)
  - `confidence`
  - `notes`
- If a source class could not be retrieved during the run, say so explicitly and treat dependent conclusions as lower confidence or `Needs verification`.

## Workflow
1. Resolve and normalize the ticker symbol.
2. Retrieve quote, fundamentals, filings, insider, ownership, and news context with `financial_search` first, using `coverage: "comprehensive"` for numeric claims.
3. Use `financial_search` with `intent: "insider"` and `coverage: "comprehensive"` for insider analysis and reference returned `ownershipChange` when available.
4. Use Exa (`websearch`) only for qualitative context such as management commentary, industry developments, litigation, credit commentary, and catalyst context. Never use Exa for numeric financial metrics.
5. Build an evidence ledger that separates:
   - observed data
   - management claims
   - analytical inference
   - market-implied expectations
   - unresolved items that need verification
6. Build a one-page investment conclusion first:
   - what the business is
   - what the stock is really a bet on
   - current thesis in `3-5` bullets
   - key bull case
   - key bear case
   - what would make the thesis wrong
   - the `5` most important items to monitor next quarter
7. Build a business-model decomposition tailored to the company:
   - decompose by segment when multi-segment
   - for platforms, separate user growth, engagement, monetization, take rate, retention, and marginal cost
   - for industrials, separate backlog, pricing, utilization, input costs, and working capital
   - for banks or lenders, separate NII, NIM, deposit beta, credit costs, capital, and fee businesses
   - always distinguish what management can control from what it cannot
8. Reconstruct the economics into decision-useful bridges:
   - revenue bridge
   - gross margin bridge
   - operating margin / EBIT / EBITDA bridge
   - free cash flow bridge
   - working-capital bridge
   - capex split: maintenance vs growth when inferable
   - SBC treatment
   - one-offs and normalization adjustments
   - acquisition / disposal impact
   - FX impact
   - share-count and dilution bridge
9. Distill management commentary into signal:
   - exact management claims that matter
   - whether those claims are supported by numbers
   - wording changes versus prior quarter / prior comparable period when available
   - whether guidance tone hardened or softened
   - topics management avoided
   - whether call answers were evasive, unusually precise, or internally inconsistent
10. Build an explicit low-salience section for easy-to-miss items that may matter more than headlines.
11. Analyze capital allocation, liquidity, balance sheet, governance, incentives, insider ownership, beneficial ownership, and flow-of-funds.
12. Place the company in industry and competitor context, then compare public evidence with what the market price appears to imply.
13. Build scenario valuation, directional conviction output, and a red-team section that attacks the thesis.
14. Finish with a monitoring dashboard that can be reused next quarter.
15. Produce deliverables and reproducibility metadata.
16. After writing `report.md`, `dashboard.md`, `assumptions.json`, and `adjustment-log.md`, call `report_evaluation`:
   - `ticker`: `<ticker>`
   - `outputRoot`: `reports/<ticker>/<report_date>/`
17. After `report_evaluation` writes `evaluation.md` and `evaluation-snapshot.json`, call `report_pdf`:
   - `subcommand`: `report`
   - `outputRoot`: `reports/<ticker>/<report_date>/`
   - `filename`: `<ticker>-<report_date>.pdf`
   - do not ask a PDF question and do not skip PDF generation.

## Output Requirements
- Return a concise in-chat executive summary with:
  - what the business is
  - what the stock is really a bet on
  - thesis and anti-thesis
  - `directional_conviction_score` and score band
  - top positive drivers
  - top negative drivers
  - key falsifiers
  - next-quarter watch items
- Write markdown-first artifacts to `reports/<ticker>/<report_date>/`:
  - `report.md`: full decision-oriented report
  - `dashboard.md`: one-page KPI, thesis-monitoring, and catalyst dashboard
  - `assumptions.json`: scenario assumptions, score inputs, monitoring triggers, and machine-readable evidence metadata
  - `adjustment-log.md`: normalization entries, recurring vs non-recurring classification, source conflicts, and rationale
- Write deterministic evaluation artifacts to `reports/<ticker>/<report_date>/`:
  - `evaluation.md`: deterministic evaluation summary table
  - `evaluation-snapshot.json`: machine-readable evaluation data for PDF rendering
- Always write PDF artifact via `report_pdf`:
  - `<ticker>-<report_date>.pdf`
  - first page: ticker summary
  - second page: deterministic evaluation snapshot from `evaluation-snapshot.json`
  - remaining pages: report information from `report.md`, `dashboard.md`, and `assumptions.json` (exclude `adjustment-log.md`)
  - footer on every page: display `opencode.finance`, linked to `https://opencode.finance`

## `report.md` Requirements
- Include explicit metadata lines at the top of the file, before the first analytical section:
  - `Sector: <value>` - use human-readable labels, not raw API enums
  - `Headquarters: <value>` - use short format `City, State, Country`
  - `Website: <value>`
  - `Icon URL: <value>`
- Use crisp, decision-first writing. Do not dump raw filing prose.
- Include these sections in this general order:
  - `## Investment Conclusion`
  - `## Thesis and Anti-Thesis`
  - `## Source Map of Public Information`
  - `## Business Model and Segment Economics`
  - `## Fundamental Analysis`
  - `## Reconstructed Economics`
  - `## Technical Analysis`
  - `## Management Commentary and Tone Changes`
  - `## Things the Market May Miss`
  - `## Capital Allocation, Balance Sheet, and Liquidity`
  - `## Governance, Incentives, Ownership, and Flow of Funds`
  - `## Market Intelligence`
  - `## Industry and Competitor Context`
  - `## Variant Perception and Market-Implied Expectations`
  - `## Scenario Valuation`
  - `## Directional Conviction and Monitoring Triggers`
  - `## Risk Assessment and Red-Team`
  - `## Portfolio Fit`
  - `## Monitoring Dashboard`
  - `## Appendix: Disclosure Timeline and Source Log`
  - `## Sources`
- `## Investment Conclusion` must function as a one-page decision surface and include:
  - what the business does
  - what the stock is really a bet on
  - current thesis in `3-5` bullets
  - key bull case
  - key bear case
  - what would make the thesis wrong
  - the `5` most important items to monitor next quarter
- `## Source Map of Public Information` must explicitly list the public inputs used and missing, with status and confidence.
- `## Business Model and Segment Economics` must explain:
  - how the company makes money
  - key revenue drivers
  - fixed vs variable cost structure when inferable
  - where margins actually come from
  - whether economics are volume-driven, price-driven, mix-driven, utilization-driven, or financing-driven
  - what management can and cannot control
- `## Reconstructed Economics` must explicitly separate:
  - recurring items
  - cyclical items
  - accounting noise
  - management-adjusted presentation
- `## Management Commentary and Tone Changes` must focus on signal extraction, not transcript summary.
- `## Things the Market May Miss` is mandatory and should surface low-salience but decision-relevant findings.
- `## Capital Allocation, Balance Sheet, and Liquidity` must cover:
  - buybacks
  - dividends
  - M&A
  - debt issuance / refinancing / maturities
  - covenant or interest-burden issues when public
  - cash deployment priorities
  - management's historical capital-allocation quality
- `## Governance, Incentives, Ownership, and Flow of Funds` must cover:
  - who controls the company
  - insider ownership
  - major outside holders
  - compensation design
  - incentive alignment or misalignment
  - board quality and related-party issues when visible
  - insider trading summary
  - recent `13D/13G` changes when available
  - dilution / convertibles / warrants / options overhang when relevant
- `## Variant Perception and Market-Implied Expectations` must compare public evidence vs what the market price appears to discount.
- `## Scenario Valuation` must include:
  - base / bull / bear cases
  - sensitivity tables
  - DCF only when assumptions are explicit and sane
  - multiples vs peers
  - historical valuation range
  - sum-of-the-parts when appropriate
  - which assumptions are observable vs mostly guesswork
- `## Risk Assessment and Red-Team` must explicitly attack the thesis:
  - strongest reasons the thesis is wrong
  - data that would falsify it
  - fragile accounting judgments
  - what management could be obscuring without lying
  - where public data is insufficient
- `## Portfolio Fit` must evaluate position fit relative to `portfolio_context` and `benchmark` when provided.
- If portfolio data is missing, render portfolio fit as:
  `Not evaluated: missing portfolio holdings, benchmark, and mandate`
- `## Monitoring Dashboard` must include:
  - next catalysts
  - next filings / events to watch
  - KPI thresholds that change the thesis
  - what would count as confirming evidence next quarter
  - what would count as disconfirming evidence next quarter
- Use explicit driver headings:
  - `Top Positive Drivers`
  - `Top Negative Drivers`
- End with a final `## Sources` section. It must be the last section in `report.md`.

## `dashboard.md` Requirements
- Use KPI tables with exactly these columns:
  `| KPI | Value | Period | Source | Source URL | Retrieval timestamp |`
- Include separate KPI rows for:
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
- Add a monitoring table that includes, at minimum:
  - item being monitored
  - current state
  - threshold / trigger
  - why it matters
  - next check
  - evidence tag
- Add a catalyst table or list that includes the next filings, calls, or known events when inferable.
- Add a compact source-gap note for any material missing public information.
- Never leave `Source`, `Source URL`, or `Retrieval timestamp` empty for numeric KPI rows.
- Keep source labels and source URLs coherent, for example Yahoo chart label must use Yahoo chart URL.
- Use period-aware metric labels in KPI rows (`TTM`, `FY`, or `Q`) based on `metricPeriods`; do not force `(TTM)` when period differs.

## `assumptions.json` Requirements
- Must include:
  - `scenario_assumptions`
  - `score_inputs`
  - `factor_weights`
  - `uncertainty_flags`
- Also include, when possible:
  - `monitoring_triggers`
  - `market_implied_expectations`
  - `red_team_checks`
  - `source_map`
  - `known_unknowns`
  - `evidence_labels`

## `adjustment-log.md` Requirements
- Record every normalization or reconstruction decision and why it was made.
- Explicitly log:
  - one-offs
  - recurring vs non-recurring classification
  - management-adjusted vs analyst-normalized treatment
  - SBC treatment
  - capex treatment
  - FX adjustments
  - acquisition / disposal adjustments
  - share-count / dilution adjustments
  - source conflicts and how they were resolved
  - unresolved data gaps that limit confidence

## Data and Citation Rules
- Use IEEE-style numbered citations: place `[N]` markers in-text for each factual claim. Collect all references in a final `## Sources` section at the end of `report.md`.
- Each entry in `## Sources` must follow this format:
  `[N] Publisher/Domain Label, "page or dataset title," URL. Retrieved YYYY-MM-DD.`
- The `## Sources` section must be the last section in `report.md`. No analytical content may appear after it.
- Never use alternative section names like `Source Register`, `Reference List`, or alternative marker formats like `S1`, `Sn`, or `(S1)`. Only `## Sources` with `[N]` markers.
- Use `financial_search` as the primary source for finance data, with `coverage: "comprehensive"` for numeric claims.
- Use Exa (`websearch`) only for qualitative market and catalyst context, never for numeric financial metrics.
- Never use generic source labels such as `websearch`, `exa`, `search`, or `internet` in output artifacts.
- Never emit the token `N/A` in report artifacts. Use observed values, `unknown`, or explicit reason text.
- Keep observed data separate from model assumptions and inference.

## Failure Modes
- Missing or invalid ticker:
  - stop and request a valid symbol
- Insufficient data to support a section:
  - keep the section
  - mark unsupported claims as `Needs verification`
  - list specific missing sources or fields
- Missing public-source classes:
  - show them in the source map as `not retrieved`
  - downgrade dependent conclusions
- Missing `portfolio_context` or `benchmark`:
  - continue and render portfolio fit as `Not evaluated: missing portfolio holdings, benchmark, and mandate`
- Conflicting data across providers:
  - prefer the most recent timestamped source
  - record the discrepancy in `adjustment-log.md`
- Tool or provider failure:
  - return a partial report with explicit `known_unknowns`
  - do not invent missing values

## Completion Criteria
- Deliver all four artifacts under the default output path unless the user overrides output root.
- Ensure the report reads like a premium decision document, not a rewritten filing.
- Ensure each major section has at least one cited source, or an explicit `Needs verification` note.
- Include `directional_conviction_score`, score band, weighted drivers, and explicit non-advice framing.
- Make the report auditable: every material statement should be tagged and traceable to public evidence or clearly marked inference.
- End with a practical monitoring framework that can be reused next quarter.
