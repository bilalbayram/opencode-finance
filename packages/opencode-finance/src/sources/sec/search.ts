import { type SecContext, TTL, filingDocumentUrl, filingIndexUrl, secJson } from "./client"
import { resolveCompany } from "./company"

type EftsHit = {
  _id: string
  _source: {
    ciks: string[]
    display_names: string[]
    form: string
    root_forms?: string[]
    file_date: string
    period_ending?: string | null
    adsh: string
    file_type?: string
    file_description?: string | null
    items?: string[]
  }
}

type EftsResponse = { hits: { total: { value: number; relation: string }; hits: EftsHit[] } }

const PAGE_SIZE = 100

export async function search(
  ctx: SecContext,
  query: string,
  options: { company?: string; forms?: string[]; since?: string; until?: string; limit: number },
) {
  const params = new URLSearchParams({ q: query })
  const company = options.company ? await resolveCompany(ctx, options.company) : undefined
  if (company) params.set("ciks", company.cik)
  if (options.forms?.length) params.set("forms", options.forms.join(","))
  if (options.since || options.until) {
    params.set("dateRange", "custom")
    params.set("startdt", options.since ?? "2001-01-01")
    params.set("enddt", options.until ?? new Date().toISOString().slice(0, 10))
  }

  const results = []
  let total = 0
  for (let from = 0; results.length < options.limit; from += PAGE_SIZE) {
    if (from) params.set("from", String(from))
    const payload = await secJson<EftsResponse>(
      ctx,
      `https://efts.sec.gov/LATEST/search-index?${params}`,
      TTL.search,
      "EDGAR full-text search",
    )
    total = payload.hits.total.value
    for (const hit of payload.hits.hits) {
      const [accession, document] = hit._id.split(":") as [string, string | undefined]
      const cik = hit._source.ciks[0] ?? ""
      results.push({
        form: hit._source.form,
        filed: hit._source.file_date,
        period_ending: hit._source.period_ending ?? null,
        companies: hit._source.display_names,
        accession,
        document: document ?? null,
        document_type: hit._source.file_type ?? null,
        document_description: hit._source.file_description ?? null,
        items: hit._source.items ?? [],
        document_url: document && cik ? filingDocumentUrl(cik, accession, document) : null,
        index_url: cik ? filingIndexUrl(cik, accession) : null,
      })
      if (results.length >= options.limit) break
    }
    if (payload.hits.hits.length < PAGE_SIZE || from + PAGE_SIZE >= total) break
  }

  if (total >= 10_000) ctx.collector.warn("EDGAR full-text search caps results at 10,000; narrow the query or date range.")
  return { query, company: company ?? null, total_matches: total, count: results.length, results }
}
