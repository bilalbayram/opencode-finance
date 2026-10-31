import { type SecContext, TTL, padCik, secJson } from "./client"

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"

export type CompanyRef = {
  cik: string
  name: string
  ticker: string | null
}

type TickerRow = { cik_str: number; ticker: string; title: string }

export async function tickerIndex(ctx: SecContext) {
  const payload = await secJson<Record<string, TickerRow>>(ctx, TICKERS_URL, TTL.tickers, "Company tickers and CIKs")
  return Object.values(payload)
}

// Accepts a ticker (AAPL, BRK.B, BRK-B) or a CIK (320193, 0000320193, CIK0000320193).
export async function resolveCompany(ctx: SecContext, input: string): Promise<CompanyRef> {
  const value = input.trim()
  const rows = await tickerIndex(ctx)
  if (/^(CIK)?\d{1,10}$/i.test(value)) {
    const cik = padCik(value)
    const row = rows.find((item) => padCik(item.cik_str) === cik)
    return { cik, name: row?.title ?? "", ticker: row?.ticker ?? null }
  }
  const wanted = value.toUpperCase().replace(/[.\/]/g, "-")
  const row = rows.find((item) => item.ticker.toUpperCase() === wanted)
  if (!row) throw new Error(`ticker ${value} is not in SEC's company list. Pass the CIK instead, or check the symbol.`)
  return { cik: padCik(row.cik_str), name: row.title, ticker: row.ticker }
}

export type Submissions = {
  cik: string
  name: string
  entityType?: string
  sic?: string
  sicDescription?: string
  category?: string
  tickers?: string[]
  exchanges?: string[]
  ein?: string
  lei?: string | null
  website?: string
  investorWebsite?: string
  fiscalYearEnd?: string
  stateOfIncorporation?: string
  stateOfIncorporationDescription?: string
  phone?: string
  addresses?: Record<string, Record<string, string | null>>
  formerNames?: { name: string; from: string; to: string }[]
  filings: {
    recent: Record<string, (string | number)[]>
    files: { name: string; filingCount: number; filingFrom: string; filingTo: string }[]
  }
}

export async function submissions(ctx: SecContext, cik: string) {
  return secJson<Submissions>(
    ctx,
    `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`,
    TTL.submissions,
    "Company submissions (profile and filing history)",
  )
}

export async function companyProfile(ctx: SecContext, input: string) {
  const ref = await resolveCompany(ctx, input)
  const sub = await submissions(ctx, ref.cik)
  const address = sub.addresses?.business ?? {}
  return {
    cik: ref.cik,
    name: sub.name,
    tickers: sub.tickers ?? [],
    exchanges: sub.exchanges ?? [],
    entity_type: sub.entityType ?? null,
    category: sub.category ?? null,
    sic: sub.sic ?? null,
    sic_description: sub.sicDescription ?? null,
    fiscal_year_end: sub.fiscalYearEnd ? `${sub.fiscalYearEnd.slice(0, 2)}-${sub.fiscalYearEnd.slice(2)}` : null,
    state_of_incorporation: sub.stateOfIncorporationDescription || sub.stateOfIncorporation || null,
    ein: sub.ein ?? null,
    lei: sub.lei ?? null,
    website: sub.website || null,
    investor_website: sub.investorWebsite || null,
    phone: sub.phone ?? null,
    business_address: {
      street: [address.street1, address.street2].filter(Boolean).join(", ") || null,
      city: address.city ?? null,
      state_or_country: address.stateOrCountryDescription ?? address.stateOrCountry ?? null,
      zip: address.zipCode ?? null,
    },
    former_names: (sub.formerNames ?? []).map((item) => ({ name: item.name, from: item.from?.slice(0, 10), to: item.to?.slice(0, 10) })),
  }
}
