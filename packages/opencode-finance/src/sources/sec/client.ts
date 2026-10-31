import { requireCredential } from "../../core/credentials"
import type { SourceCollector } from "../../core/envelope"
import { getJson, getText } from "../../core/http"

export const SEC_PUBLISHER = "SEC EDGAR"

// SEC allows 10 requests per second per client; stay under it.
const MIN_INTERVAL_MS = 120

export const TTL = {
  tickers: 24 * 3600,
  submissions: 3600,
  facts: 6 * 3600,
  frames: 24 * 3600,
  search: 3600,
  // Filed documents never change once accepted.
  archive: 30 * 24 * 3600,
}

export type SecContext = {
  collector: SourceCollector
  refresh?: boolean
  signal?: AbortSignal
}

async function headers() {
  return {
    "User-Agent": await requireCredential("sec-edgar"),
    Accept: "application/json, text/xml, */*",
  }
}

export async function secJson<T>(ctx: SecContext, url: string, ttl: number, title: string) {
  const result = await getJson<T>(url, {
    headers: await headers(),
    ttl,
    refresh: ctx.refresh,
    signal: ctx.signal,
    minIntervalMs: MIN_INTERVAL_MS,
  })
  ctx.collector.add({ publisher: SEC_PUBLISHER, title, url, tier: "official", retrieved_at: result.fetchedAt })
  return result.json
}

export async function secText(ctx: SecContext, url: string, ttl: number, title: string) {
  const result = await getText(url, {
    headers: await headers(),
    ttl,
    refresh: ctx.refresh,
    signal: ctx.signal,
    minIntervalMs: MIN_INTERVAL_MS,
  })
  ctx.collector.add({ publisher: SEC_PUBLISHER, title, url, tier: "official", retrieved_at: result.fetchedAt })
  return result.body
}

export function padCik(cik: string | number) {
  return String(cik).replace(/^CIK/i, "").padStart(10, "0")
}

export function filingIndexUrl(cik: string | number, accession: string) {
  const compact = accession.replace(/-/g, "")
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${compact}/${accession}-index.htm`
}

export function filingDocumentUrl(cik: string | number, accession: string, document: string) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${document}`
}
