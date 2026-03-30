import { asText, toNumber, toDateOnly } from "../parse-helpers"
import { ProviderError } from "../provider"
import type { FinanceProvider } from "../provider"
import type {
  FinanceAttribution,
  FinanceDataEnvelope,
  FinanceIntent,
  FinanceInsiderData,
  FinanceProviderData,
  NormalizedFinanceQuery,
} from "../types"
import { normalizeQuiverTier, quiverPlanLabel, tierAllows, type QuiverTier } from "../quiver-tier"
import { fetchInsiders, fetchTickerAlt, fetchTickerGovTrading, type QuiverReportDataset } from "./quiver-report"

const DEFAULT_TIMEOUT_MS = 12_000

const toIsoDate = toDateOnly

function transactionType(input: unknown): "buy" | "sell" | "other" {
  const text = asText(input).toLowerCase()
  if (text.includes("buy") || text.includes("purchase") || text.includes("acquired")) return "buy"
  if (text.includes("sell") || text.includes("dispose")) return "sell"
  return "other"
}

function parseInsiders(payload: unknown[], ticker: string): FinanceInsiderData {
  const rows = payload.flatMap((item) => (item && typeof item === "object" ? [item as Record<string, unknown>] : []))
  const entries = rows.map((row) => {
    const shares = toNumber(row.Shares ?? row.ShareCount ?? row.SharesTraded ?? row.SharesOwned) ?? 0
    const delta = toNumber(row.SharesTraded ?? row.SharesChanged ?? row.ChangeInShares ?? shares) ?? 0
    const kind = transactionType(row.TransactionType ?? row.Transaction ?? row.Type ?? row.AcquiredDisposed)
    const signedDelta = kind === "sell" ? -Math.abs(delta) : delta
    return {
      owner: asText(row.Name ?? row.OwnerName ?? row.InsiderName ?? row.Person),
      date: toIsoDate(row.Date ?? row.TransactionDate ?? row.ReportDate ?? row.FiledAt),
      shares,
      sharesChange: signedDelta,
      transactionType: kind,
      security: asText(row.Security ?? row.SecurityTitle ?? `${ticker} Common Stock`),
    }
  })
  return {
    symbol: ticker.toUpperCase(),
    ownershipChange: entries.reduce((acc, item) => acc + item.sharesChange, 0),
    entries,
  }
}

interface QuiverQuantOptions {
  apiKey?: string
  tier?: QuiverTier | string
  timeoutMs?: number
}

export class QuiverQuantProvider implements FinanceProvider {
  readonly id = "quiver-quant"
  readonly displayName = "Quiver Quant"
  private readonly apiKey: string | undefined
  private readonly tier: QuiverTier
  private readonly timeoutMs: number

  constructor(options: QuiverQuantOptions = {}) {
    this.apiKey = options.apiKey
    this.tier = normalizeQuiverTier(options.tier) ?? "tier_1"
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  supports(intent: FinanceIntent): boolean {
    return intent === "insider"
  }

  enabled(): boolean {
    return Boolean(this.apiKey)
  }

  async fetch(
    input: NormalizedFinanceQuery,
    options?: { signal?: AbortSignal },
  ): Promise<FinanceDataEnvelope<FinanceProviderData>> {
    if (input.intent !== "insider") {
      throw new ProviderError(`Unsupported intent for ${this.id}: ${input.intent}`, this.id, "UNSUPPORTED")
    }
    if (!this.apiKey) {
      throw new ProviderError("Missing quiver-quant api key", this.id, "MISSING_AUTH")
    }

    if (tierAllows("tier_2", this.tier)) {
      const insider = await fetchInsiders({
        apiKey: this.apiKey,
        tier: this.tier,
        ticker: input.ticker,
        limit: input.limit,
        timeoutMs: this.timeoutMs,
        signal: options?.signal,
      })
      if (insider.status === "failed") throw toProviderError(insider, this.id, this.timeoutMs)
      return {
        source: this.id,
        timestamp: insider.timestamp,
        attribution: [
          {
            publisher: "Quiver Quant",
            domain: "api.quiverquant.com",
            url: insider.sourceUrl,
          },
        ],
        data: parseInsiders(insider.rows, input.ticker),
        errors: [],
      }
    }

    return fallbackTierOneSummary({
      source: this.id,
      apiKey: this.apiKey,
      tier: this.tier,
      ticker: input.ticker,
      limit: input.limit,
      timeoutMs: this.timeoutMs,
      signal: options?.signal,
    })
  }
}

function toProviderError(dataset: QuiverReportDataset, source: string, timeoutMs: number) {
  if (!dataset.error) {
    return new ProviderError("quiver-quant request failed", source, "NETWORK")
  }
  if (dataset.error.code === "TIMEOUT") {
    return new ProviderError("quiver-quant request timed out", source, "TIMEOUT", timeoutMs)
  }
  return new ProviderError(dataset.error.message, source, dataset.error.code)
}

function attribution(data: QuiverReportDataset[]): FinanceAttribution[] {
  const seen = new Set<string>()
  const out: FinanceAttribution[] = []
  data.forEach((item) => {
    if (item.status !== "ok") return
    if (seen.has(item.sourceUrl)) return
    seen.add(item.sourceUrl)
    out.push({
      publisher: "Quiver Quant",
      domain: "api.quiverquant.com",
      url: item.sourceUrl,
    })
  })
  return out
}

async function fallbackTierOneSummary(input: {
  source: string
  apiKey: string
  tier: QuiverTier
  ticker: string
  limit: number
  timeoutMs: number
  signal?: AbortSignal
}): Promise<FinanceDataEnvelope<FinanceProviderData>> {
  if (!tierAllows("tier_1", input.tier)) {
    return {
      source: input.source,
      timestamp: new Date().toISOString(),
      attribution: [],
      data: {
        symbol: input.ticker.toUpperCase(),
        ownershipChange: 0,
        entries: [],
        summary: {
          source: input.source,
          text: `Quiver ${quiverPlanLabel(input.tier)} does not include Tier 1 government-trading datasets. Upgrade to Hobbyist (Tier 0 + Tier 1) or higher for insider workflow coverage.`,
        },
      },
      errors: [],
    }
  }

  const [gov, alt] = await Promise.all([
    fetchTickerGovTrading({
      apiKey: input.apiKey,
      tier: input.tier,
      ticker: input.ticker,
      limit: input.limit,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    }),
    fetchTickerAlt({
      apiKey: input.apiKey,
      tier: input.tier,
      ticker: input.ticker,
      limit: input.limit,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    }),
  ])
  const all = [...gov, ...alt]
  const ok = all.filter((item) => item.status === "ok")
  const failed = all.filter((item) => item.status === "failed")
  const total = ok.reduce((acc, item) => acc + item.rows.length, 0)
  const matched = ok.filter((item) => item.rows.length > 0).map((item) => `${item.label}: ${item.rows.length}`)
  const text =
    total > 0
      ? `Quiver ${quiverPlanLabel(input.tier)} does not include live Form 4 insider feed. Government-trading proxies for ${input.ticker} show ${total} matched records (${matched.join(", ")}).`
      : `Quiver ${quiverPlanLabel(input.tier)} does not include live Form 4 insider feed. No recent government-trading proxy records were found for ${input.ticker}.`

  return {
    source: input.source,
    timestamp: new Date().toISOString(),
    attribution: attribution(ok),
    data: {
      symbol: input.ticker.toUpperCase(),
      ownershipChange: 0,
      entries: [],
      summary: {
        source: input.source,
        text,
      },
    },
    errors: failed.map((item) => `${item.id}: ${item.error?.message ?? "request failed"}`),
  }
}
