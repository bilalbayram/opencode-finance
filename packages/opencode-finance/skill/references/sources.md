# Data sources

Rule: use the primary source. Regulators and government agencies publish the data that paid vendors repackage. A vendor is only used where no free primary source exists (live prices), and every value it supplies is labelled as such.

## Coverage in `fin`

| Area | Command |
| --- | --- |
| Company profile, filings, filing text | `fin sec company`, `fin sec filings`, `fin sec document` |
| XBRL fundamentals | `fin sec facts`, `fin sec concept`, `fin sec frames` |
| Full-text filing search | `fin sec search` |
| Insider trades (Form 4) | `fin sec insiders` |
| Prices | `fin price` |

Everything else below is not wrapped yet. Fetch it directly from the listed endpoint, respect its access rules, and cite it the same way.

## Trust tiers

Every `fin` response lists the `sources` it used, each with a `tier`:

| Tier         | Meaning                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| `official`   | Published by the regulator, agency, or exchange of record through a documented endpoint or bulk file.    |
| `unofficial` | Public, but served through an undocumented endpoint or scraped page, or a vendor repackaging the data.   |

Reports must show the tier next to each figure. When an `official` and an `unofficial` value disagree, report both and the difference; never silently pick one.

Access legend: `none` = no key, `key` = free key or account, `web` = public but no official API.

## 1. Company fundamentals and filings: SEC EDGAR

| Data                                   | Endpoint                                                                 | Access | Tier       |
| -------------------------------------- | ------------------------------------------------------------------------ | ------ | ---------- |
| Ticker → CIK map                       | `https://www.sec.gov/files/company_tickers.json`                         | none   | official   |
| Filing history                         | `https://data.sec.gov/submissions/CIK##########.json`                    | none   | official   |
| All XBRL facts for one company         | `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`          | none   | official   |
| One concept for one company            | `https://data.sec.gov/api/xbrl/companyconcept/CIK##########/{taxonomy}/{tag}.json` | none | official |
| One concept across all filers          | `https://data.sec.gov/api/xbrl/frames/{taxonomy}/{tag}/{unit}/{period}.json` | none | official   |
| Full-text search inside filings        | `https://efts.sec.gov/LATEST/search-index?q=...`                         | none   | official   |
| Bulk statements history                | Financial Statement and Notes data sets (quarterly ZIP)                  | none   | official   |
| Earnings releases                      | 8-K Item 2.02 with Exhibit 99.1                                          | none   | official   |
| Institutional holdings                 | 13F-HR filings and Form 13F data sets                                    | none   | official   |
| 5%+ holders                            | SC 13D / SC 13G filings                                                  | none   | official   |
| Executive pay                          | DEF 14A filings                                                          | none   | official   |
| Fund and ETF holdings                  | Form N-PORT data sets                                                    | none   | official   |
| Fails-to-deliver                       | SEC fails-to-deliver files (twice monthly)                               | none   | official   |

Requirements: send `User-Agent: <name> <email>` on every request (`SEC_EDGAR_IDENTITY`), stay under 10 requests per second, and cache aggressively. XBRL tags vary by filer; resolve metrics through the curated concept map, not a single tag.

## 2. Insider and political trading

| Data                         | Source                                                                                     | Access | Tier       |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ------ | ---------- |
| Insider trades (live)        | Form 4 XML from EDGAR (`ownershipDocument`)                                                | none   | official   |
| Insider trades (history)     | SEC Insider Transactions Data Sets, quarterly since 2006, includes the 10b5-1 flag         | none   | official   |
| House member trades          | House Clerk financial disclosures: yearly ZIP with XML index, PTR documents as PDF         | web    | official   |
| Senate member trades         | Senate eFD (`efdsearch.senate.gov`), electronic PTRs as HTML after accepting site terms    | web    | official   |
| Executive branch officials   | OGE Form 278-T                                                                              | web    | official   |

Some House PTRs are scanned images. Parse structured filings, list the rest as gaps with their document links; do not OCR-guess amounts.

## 3. Market structure: short interest and off-exchange volume

| Data                            | Source                                                                              | Access     | Tier     |
| ------------------------------- | ----------------------------------------------------------------------------------- | ---------- | -------- |
| Daily short-sale volume         | FINRA Reg SHO daily files (`https://cdn.finra.org/equity/regsho/daily/`)            | none       | official |
| Short interest (twice monthly)  | FINRA Equity Short Interest (all equities since June 2021, OTC-only before)         | none / key | official |
| ATS and non-ATS OTC volume      | FINRA OTC Transparency weekly data, per symbol and venue                            | key        | official |
| Exchange-level statistics       | Cboe and Nasdaq market statistics pages                                             | web        | unofficial |

FINRA publishes ATS data with a two to four week delay. Off-exchange analysis must state the data date and the lag.

## 4. Macro and rates

| Data                                  | Source                                       | Access | Tier     |
| ------------------------------------- | -------------------------------------------- | ------ | -------- |
| Macro series and revision history     | FRED and ALFRED (St. Louis Fed)              | key    | official |
| Treasury par yield curve              | `home.treasury.gov` daily yield curve XML    | none   | official |
| Federal debt, budget, auctions        | Treasury FiscalData API                      | none   | official |
| SOFR, repo, Fed operations            | New York Fed Markets API                     | none   | official |
| CPI, PPI, employment                  | BLS API v2                                   | key    | official |
| GDP, personal income                  | BEA API                                      | key    | official |
| Energy                                | EIA API                                      | key    | official |
| Futures positioning                   | CFTC Commitments of Traders (Socrata API)    | none   | official |
| Bank financials                       | FDIC BankFind API                            | none   | official |

## 5. Identifiers and reference data

| Data                              | Source                                                   | Access     | Tier     |
| --------------------------------- | -------------------------------------------------------- | ---------- | -------- |
| US listed symbols                 | Nasdaq Trader `nasdaqlisted.txt` and `otherlisted.txt`   | none       | official |
| Ticker, FIGI and ISIN mapping     | OpenFIGI                                                 | none / key | official |
| Legal entities and parents        | GLEIF LEI API                                            | none       | official |

## 6. Markets outside the US

| Market          | Source                                                        | Access | Tier       |
| --------------- | ------------------------------------------------------------- | ------ | ---------- |
| EU / UK reports | `filings.xbrl.org` (ESEF filings)                             | none   | official   |
| UK companies    | Companies House API                                           | key    | official   |
| Japan           | EDINET API                                                    | key    | official   |
| Korea           | DART OpenAPI                                                  | key    | official   |
| Turkey filings  | KAP (`kap.org.tr`), undocumented JSON endpoints               | web    | official   |
| Turkey macro    | TCMB EVDS                                                     | key    | official   |
| Turkey funds    | TEFAS                                                         | web    | official   |
| Turkey tenders  | EKAP                                                          | web    | official   |

KAP, TEFAS and EKAP content is the official record even though the endpoints are undocumented; mark the access path as `web` and expect breakage.

## 7. Prices

No free official consolidated feed exists for US equities; exchanges sell it. Prices are always `unofficial` unless the user supplies a licensed key.

| Order | Source                         | Access | Tier       | Notes                                           |
| ----- | ------------------------------ | ------ | ---------- | ----------------------------------------------- |
| 1     | Yahoo Finance chart endpoint   | none   | unofficial | Global coverage, intraday and history           |
| 2     | Nasdaq historical API          | none   | unofficial | US end-of-day fallback                          |
| 3     | Tiingo or Alpha Vantage        | key    | unofficial | Optional licensed free tier, not wired yet      |
| -     | IEX Exchange HIST              | none   | official   | IEX venue only, cross-check, not a primary feed |
| -     | Cboe delayed options quotes    | web    | unofficial | Options chains, later phase                     |

Stooq was dropped: its download endpoint now sits behind a browser challenge. BIST prices come from Yahoo (`THYAO.IS`). Earnings call transcripts have no free primary source and are out of scope; use the 8-K press release.

## Removed providers

Quiver Quant, Quartr, Polygon and Financial Modeling Prep are replaced by the sources above. Finnhub and Alpha Vantage remain only as optional price fallbacks.
