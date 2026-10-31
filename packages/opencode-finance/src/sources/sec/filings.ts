import { type SecContext, TTL, filingDocumentUrl, filingIndexUrl, secJson } from "./client"
import { resolveCompany, submissions } from "./company"

export type Filing = {
  form: string
  accession: string
  filed: string
  report_date: string | null
  accepted_at: string | null
  items: string[]
  description: string | null
  primary_document: string | null
  document_url: string | null
  index_url: string
}

type FilingColumns = Record<string, (string | number)[]>

export function normalizeForm(form: string) {
  return form.toUpperCase().replace(/\s+/g, "")
}

export function filingRows(cik: string, columns: FilingColumns): Filing[] {
  const forms = columns.form ?? []
  return forms.map((_, index) => {
    const at = (key: string) => {
      const value = columns[key]?.[index]
      return value === undefined || value === null || value === "" ? null : String(value)
    }
    const accession = at("accessionNumber")!
    const document = at("primaryDocument")
    return {
      form: at("form")!,
      accession,
      filed: at("filingDate")!,
      report_date: at("reportDate"),
      accepted_at: at("acceptanceDateTime"),
      items: (at("items") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
      description: at("primaryDocDescription"),
      primary_document: document,
      document_url: document ? filingDocumentUrl(cik, accession, document) : null,
      index_url: filingIndexUrl(cik, accession),
    }
  })
}

export type FilingQuery = {
  forms?: string[]
  since?: string
  until?: string
  limit: number
}

export function matchesFiling(filing: Filing, query: Omit<FilingQuery, "limit">) {
  if (query.forms?.length && !query.forms.map(normalizeForm).includes(normalizeForm(filing.form))) return false
  if (query.since && filing.filed < query.since) return false
  if (query.until && filing.filed > query.until) return false
  return true
}

// Walks the recent window first, then older archive pages only when the date range reaches past it.
export async function listFilings(ctx: SecContext, cik: string, query: FilingQuery) {
  const sub = await submissions(ctx, cik)
  const out: Filing[] = []
  const take = (rows: Filing[]) => {
    for (const row of rows) {
      if (out.length >= query.limit) return
      if (matchesFiling(row, query)) out.push(row)
    }
  }

  take(filingRows(cik, sub.filings.recent))
  for (const page of sub.filings.files ?? []) {
    if (out.length >= query.limit || !query.since) break
    if (page.filingTo < query.since || (query.until && page.filingFrom > query.until)) continue
    const older = await secJson<FilingColumns>(
      ctx,
      `https://data.sec.gov/submissions/${page.name}`,
      TTL.submissions,
      "Company submissions (older filings)",
    )
    take(filingRows(cik, older))
  }
  return { name: sub.name, filings: out }
}

export async function filings(ctx: SecContext, input: string, query: FilingQuery) {
  const ref = await resolveCompany(ctx, input)
  const result = await listFilings(ctx, ref.cik, query)
  return { company: { ...ref, name: result.name }, count: result.filings.length, filings: result.filings }
}
