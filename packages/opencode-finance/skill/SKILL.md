---
name: opencode-finance
description: Research public companies with primary-source data and cite every number. Use for fundamentals (revenue, margins, cash flow, balance sheet), SEC filings and their text, insider trades (Form 4), full-text search across filings, cross-company comparisons, stock prices, and writing company or equity research reports. Data comes straight from SEC EDGAR and is labelled official or unofficial.
---

# OpenCode Finance

`fin` below means `node <directory of this SKILL.md>/scripts/fin.mjs`. It needs Node 20 or newer and nothing else.

Every command prints JSON to stdout:

```json
{ "data": { ... }, "sources": [{ "publisher", "title", "url", "tier", "retrieved_at" }], "warnings": [ ... ] }
```

Errors print JSON to stderr. Exit code 2 means bad arguments (read `fin <command> --help`), 3 means a missing credential, 1 means the source failed.

## Setup

SEC requires every client to identify itself with a name and email. On exit code 3, ask the user for theirs and run:

```sh
fin auth set sec-edgar "Jane Doe jane@example.com"
```

Or set `SEC_EDGAR_IDENTITY`. Never invent an identity.

## Commands

| Command | Returns |
| --- | --- |
| `fin sec company <ticker\|cik>` | Name, CIK, SIC industry, fiscal year end, address, website |
| `fin sec facts <ticker> [--period annual\|quarterly] [--metrics a,b] [--limit 5]` | As-reported fundamentals; every value carries its period, XBRL tag, form, filing date and filing URL |
| `fin sec concept <ticker> <tag> [--unit USD]` | Every reported value of one XBRL tag, when a metric is not in `facts` |
| `fin sec frames <tag> <CY2025\|CY2025Q3\|CY2025Q4I>` | One tag across all filers, for peer and market-wide comparison |
| `fin sec filings <ticker> [--forms 10-K,8-K] [--since] [--until]` | Filing history with document links |
| `fin sec document <url> [--find "phrase"] [--offset N]` | Filing text from sec.gov, paged; `--find` returns offsets to jump to |
| `fin sec search "<text>" [--company] [--forms] [--since]` | Full-text search inside all EDGAR filings since 2001 |
| `fin sec insiders <ticker> [--since] [--limit 20]` | Form 4 transactions: owner, role, code, shares, price, holdings after, 10b5-1 flag |
| `fin price <symbol> [--range 1y] [--interval 1d]` | Last price, previous close, OHLCV bars. Tier `unofficial` |

`fin sec facts --help` lists the curated metrics. Add `--refresh` to any command to bypass the cache.

## Rules

1. **Numbers come from `fin` output or a document it links to.** Not from memory, not from search snippets. If you cannot get a number, say it is unavailable.
2. **Cite every figure** with its source URL (`filing_url` for XBRL values), period end date and tier. Anything `unofficial` must be visibly marked as such.
3. **Compute in code.** Save the `fin` JSON to files, then write and run a script for growth rates, margins, ratios, TTM sums, derived quarters and valuation. Never do arithmetic in your head. Keep the script next to the output so the numbers can be reproduced.
4. **Be exact about periods.** State the period end date and whether a value is annual, quarterly, TTM or derived. Fiscal years differ from calendar years.
5. **Report conflicts.** When two sources disagree, show both values and the difference.
6. **Pass warnings on.** `warnings` explain gaps and fallbacks; carry the relevant ones into your answer.
7. **Separate fact from interpretation.** Say which statements are reported, which are management's claims and which are your inference.

## Common tasks

- **Fundamentals:** `fin sec facts AAPL` for five fiscal years; `--period quarterly --limit 8` for quarters. Fiscal Q4 is rarely filed on its own; derive it as annual minus Q1 to Q3 and label it derived.
- **What changed:** `fin sec filings AAPL --forms 8-K --since <date>`; item 2.02 is an earnings release, 5.02 an executive change, 1.01 a material agreement.
- **Read the filing:** take `document_url` from `filings`, run `fin sec document <url> --find "Risk Factors"`, then page from that offset.
- **Insiders:** `fin sec insiders AAPL --since <date>`. Code P is an open-market purchase and S a sale; A, M and F are compensation mechanics. Note when sales are under a 10b5-1 plan.
- **Peers:** `fin sec frames us-gaap:Revenues CY2025`, or `fin sec facts` per peer.
- **Company report:** read [references/report.md](references/report.md) first.

Sources not yet in `fin` (FRED, Treasury, FINRA, congressional disclosures, non-US registries) are listed with their endpoints in [references/sources.md](references/sources.md). Fetch them directly and apply the same rules.
