# Writing a company report

A report answers four questions: what the business is, what the stock is a bet on, what changed, and what would prove the thesis wrong. Write for a reader who will act on it, not a summary of the 10-K.

Adapt the structure to the request. A quick look at a company needs a page; a full report needs most of the sections below. If the user names a focus (valuation, governance, credit, forensic), lead with it.

## 1. Gather

Save every response to a working directory, for example `reports/<TICKER>/<YYYY-MM-DD>/data/`.

```sh
fin sec company AAPL                                   > data/company.json
fin sec facts AAPL --limit 5                           > data/annual.json
fin sec facts AAPL --period quarterly --limit 8        > data/quarterly.json
fin sec filings AAPL --forms "10-K,10-Q,8-K,DEF 14A" --limit 30 > data/filings.json
fin sec insiders AAPL --since <one year ago>           > data/insiders.json
fin price AAPL --range 5y --interval 1wk               > data/price-5y.json
fin price AAPL --range 1mo                             > data/price-1mo.json
```

Then read the primary documents with `fin sec document`:

- Latest 10-K: business description, segments, risk factors, MD&A, debt and liquidity notes.
- Latest 10-Q and the most recent earnings 8-K (item 2.02, exhibit 99.1): what changed this quarter and how management describes it.
- Proxy (DEF 14A): who controls the company, executive pay design, related-party transactions.
- Any 8-K items 1.01, 2.03, 5.02 since the last annual report.

For peers, run `fin sec facts` on each, or `fin sec frames` for one metric across all filers.

## 2. Compute

Write one script (`analysis.py` or `analysis.mjs`) that reads the saved JSON and produces every derived number: growth, margins, free cash flow (operating cash flow minus capital expenditure), TTM sums, net debt, share count change, returns on capital, valuation multiples at the latest price. Print a table and save it as `data/derived.json`. Use only these computed values in the report.

## 3. Write

Suggested sections, in order:

1. **Conclusion**: what the business is, what the stock is a bet on, the thesis in three to five bullets, the bull case, the bear case, what would make the thesis wrong, and five things to watch next quarter.
2. **Business and segment economics**: how it makes money, the drivers of revenue and margin, what management controls and what it does not.
3. **Financial performance**: multi-year and recent-quarter trends in revenue, margins, cash flow and returns, with the tables from step 2.
4. **What changed**: the latest quarter against the prior year and against what management said before. Quote management where it matters, and check claims against the numbers.
5. **Things that are easy to miss**: footnotes, accounting changes, customer concentration, off-balance-sheet items, wording shifts in risk factors.
6. **Balance sheet and capital allocation**: liquidity, debt and maturities, buybacks, dividends, M&A, dilution.
7. **Governance and ownership**: control, incentives, insider transactions (separate open-market trades from compensation mechanics and 10b5-1 plan sales).
8. **Valuation**: multiples against history and peers, and what the current price implies. Mark which assumptions are observable and which are guesses. Base, bull and bear cases where useful.
9. **Risks and red team**: the strongest arguments against the thesis and the data that would confirm them.
10. **Monitoring**: upcoming filings and events, and thresholds that would change the view.
11. **Sources**: numbered list, last section.

Label material statements so the reader can tell fact from interpretation, for example `[Reported]`, `[Management claim]`, `[Inference]`, `[Unverified]`.

## Citations

Use numbered markers in the text, `[1]`, and end with a `Sources` section:

```
[1] SEC EDGAR, Apple Inc. 10-K for fiscal year ended 2025-09-27, https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/0000320193-25-000079-index.htm. Retrieved 2026-10-31. Official.
[2] Yahoo Finance, AAPL daily chart, https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1mo&interval=1d. Retrieved 2026-10-31. Unofficial.
```

Cite the filing (`filing_url`) behind XBRL values rather than the API URL, so the reader can open the document. Use `retrieved_at` from the `fin` output as the retrieval date.

## Deliverable

Write the report as `reports/<TICKER>/<YYYY-MM-DD>/report.md`, next to `data/` and the analysis script. Give a short summary in chat with the conclusion and the path. Produce a PDF, HTML or slides only if the user asks.

State plainly that the report is research, not investment advice. When data is missing, keep the section and say what is missing rather than filling the gap.
