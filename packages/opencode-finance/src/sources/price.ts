import type { SourceCollector } from "../core/envelope"
import { getJson } from "../core/http"

export const RANGES = ["5d", "1mo", "3mo", "6mo", "ytd", "1y", "2y", "5y", "10y", "max"] as const
export const INTERVALS = ["1d", "1wk", "1mo"] as const
export type Range = (typeof RANGES)[number]
export type Interval = (typeof INTERVALS)[number]

export type Bar = {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  adj_close: number | null
  volume: number | null
}

export type PriceData = {
  symbol: string
  currency: string | null
  exchange: string | null
  instrument_type: string | null
  last: { price: number | null; time: string | null; session_date: string | null }
  previous_close: number | null
  change: number | null
  change_percent: number | null
  range: Range
  interval: Interval
  bars: Bar[]
}

type PriceContext = { collector: SourceCollector; refresh?: boolean; signal?: AbortSignal }

// Yahoo rate-limits browser-looking clients without cookies; Nasdaq stalls on anything that is not a browser.
const YAHOO_UA = "fin (+https://opencode.finance)"
const NASDAQ_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits))
}

function dateIn(timeZone: string | undefined, epochSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(epochSeconds * 1000),
  )
}

// Daily bars only: the previous close is the last completed session before the latest one.
export function withChange(data: Omit<PriceData, "previous_close" | "change" | "change_percent">): PriceData {
  const session = data.last.session_date
  const prior = data.interval === "1d" ? [...data.bars].reverse().find((bar) => bar.close !== null && (!session || bar.date < session)) : undefined
  const previous = prior?.close ?? null
  const price = data.last.price
  return {
    ...data,
    previous_close: previous,
    change: price !== null && previous !== null ? round(price - previous) : null,
    change_percent: price !== null && previous ? round(((price - previous) / previous) * 100) : null,
  }
}

type YahooChart = {
  chart: {
    result?: {
      meta: Record<string, any>
      timestamp?: number[]
      indicators: { quote: Record<string, (number | null)[]>[]; adjclose?: { adjclose: (number | null)[] }[] }
    }[]
    error?: { code: string; description: string } | null
  }
}

export function parseYahoo(payload: YahooChart, range: Range, interval: Interval): PriceData {
  const result = payload.chart.result?.[0]
  if (!result) throw new Error(payload.chart.error?.description ?? "Yahoo returned no chart data")
  const meta = result.meta
  const zone = meta.exchangeTimezoneName as string | undefined
  const quote = result.indicators.quote[0] ?? {}
  const adj = result.indicators.adjclose?.[0]?.adjclose
  // Yahoo serializes float32 values (348.9100036621094); 4 decimals keeps every real tick.
  const px = (value: number | null | undefined) => (typeof value === "number" ? round(value, 4) : null)
  const bars = (result.timestamp ?? []).map((ts, index) => ({
    date: dateIn(zone, ts),
    open: px(quote.open?.[index]),
    high: px(quote.high?.[index]),
    low: px(quote.low?.[index]),
    close: px(quote.close?.[index]),
    adj_close: px(adj?.[index]),
    volume: quote.volume?.[index] ?? null,
  }))
  const time = typeof meta.regularMarketTime === "number" ? meta.regularMarketTime : null
  return withChange({
    symbol: String(meta.symbol ?? ""),
    currency: meta.currency ?? null,
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
    instrument_type: meta.instrumentType ?? null,
    last: {
      price: px(meta.regularMarketPrice),
      time: time ? new Date(time * 1000).toISOString() : null,
      session_date: time ? dateIn(zone, time) : null,
    },
    range,
    interval,
    bars,
  })
}

type NasdaqHistory = {
  data: { symbol: string; tradesTable: { rows: Record<string, string>[] | null } | null } | null
  status?: { rCode: number; bCodeMessage?: { errorMessage: string }[] | null }
}

function money(value: string | undefined) {
  if (!value) return null
  const parsed = Number(value.replace(/[$,]/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

export function parseNasdaq(payload: NasdaqHistory, symbol: string, range: Range): PriceData {
  const rows = payload.data?.tradesTable?.rows ?? []
  const bars = rows
    .map((row) => {
      const [month, day, year] = row.date!.split("/")
      return {
        date: `${year}-${month}-${day}`,
        open: money(row.open),
        high: money(row.high),
        low: money(row.low),
        close: money(row.close),
        adj_close: null,
        volume: money(row.volume),
      }
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  const last = bars.at(-1)
  return withChange({
    symbol: symbol.toUpperCase(),
    currency: "USD",
    exchange: null,
    instrument_type: null,
    last: { price: last?.close ?? null, time: null, session_date: last?.date ?? null },
    range,
    interval: "1d",
    bars,
  })
}

function rangeStart(range: Range, today = new Date()) {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const back = { "5d": 7, "1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 731, "5y": 1827, "10y": 3653, max: 3653 * 3 } as const
  if (range === "ytd") return `${date.getUTCFullYear()}-01-01`
  date.setUTCDate(date.getUTCDate() - back[range])
  return date.toISOString().slice(0, 10)
}

async function fromYahoo(ctx: PriceContext, symbol: string, range: Range, interval: Interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`
  const result = await getJson<YahooChart>(url, { headers: { "User-Agent": YAHOO_UA }, ttl: 60, refresh: ctx.refresh, signal: ctx.signal })
  const data = parseYahoo(result.json, range, interval)
  ctx.collector.add({ publisher: "Yahoo Finance", title: `Chart ${symbol} ${range}/${interval}`, url, tier: "unofficial", retrieved_at: result.fetchedAt })
  return data
}

async function fromNasdaq(ctx: PriceContext, symbol: string, range: Range) {
  const today = new Date().toISOString().slice(0, 10)
  for (const assetClass of ["stocks", "etf"]) {
    const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=${assetClass}&fromdate=${rangeStart(range)}&todate=${today}&limit=9999`
    const result = await getJson<NasdaqHistory>(url, {
      headers: { "User-Agent": NASDAQ_UA, Accept: "application/json" },
      ttl: 600,
      timeoutMs: 10_000,
      refresh: ctx.refresh,
      signal: ctx.signal,
    })
    if (!result.json.data?.tradesTable?.rows?.length) continue
    ctx.collector.add({ publisher: "Nasdaq", title: `Historical ${symbol}`, url, tier: "unofficial", retrieved_at: result.fetchedAt })
    return parseNasdaq(result.json, symbol, range)
  }
  throw new Error(`Nasdaq has no history for ${symbol}`)
}

export async function price(ctx: PriceContext, symbol: string, options: { range: Range; interval: Interval }) {
  try {
    return await fromYahoo(ctx, symbol, options.range, options.interval)
  } catch (yahooError) {
    ctx.collector.warn(`Yahoo Finance failed (${(yahooError as Error).message}); fell back to Nasdaq end-of-day history.`)
    try {
      const data = await fromNasdaq(ctx, symbol, options.range)
      if (options.interval !== "1d") ctx.collector.warn("Nasdaq only provides daily bars; returned daily instead of the requested interval.")
      ctx.collector.warn("Nasdaq history is end-of-day: last.price is the latest close, not a live quote.")
      return data
    } catch (nasdaqError) {
      throw new Error(`no price source succeeded. Yahoo: ${(yahooError as Error).message}. Nasdaq: ${(nasdaqError as Error).message}`)
    }
  }
}
