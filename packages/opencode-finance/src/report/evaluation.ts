import fs from "fs/promises"
import path from "path"
import z from "zod"
import { normalizeTicker, normalizeErrorText } from "../finance/parser"
import { asText, rows, toNumber as sharedToNumber, toPercent as sharedToPercent } from "../finance/parse-helpers"
import { abortAfterAny } from "../util/abort"

const YAHOO_QUERY1_BASE = "https://query1.finance.yahoo.com"
const YAHOO_QUERY2_BASE = "https://query2.finance.yahoo.com"
const YAHOO_LABEL = "Yahoo Finance"
const DEFAULT_TIMEOUT_MS = 12_000
const DCF_DISCOUNT_RATE = 0.1
const DCF_TERMINAL_GROWTH_RATE = 0.025
const DCF_GROWTH_CAP_PERCENT = 12
const DCF_YEARS = 5
const TIMESERIES_START_UNIX_SECONDS = Math.floor(Date.UTC(2016, 11, 31) / 1000)

const SUMMARY_MODULES = "financialData,defaultKeyStatistics,summaryDetail,price"

const ANNUAL_TIMESERIES_KEYS = [
  "TotalRevenue",
  "NetIncome",
  "GrossProfit",
  "OperatingIncome",
  "PretaxIncome",
  "TaxProvision",
  "TaxRateForCalcs",
  "OperatingCashFlow",
  "CurrentAssets",
  "CurrentLiabilities",
  "TotalAssets",
  "TotalLiabilitiesNetMinorityInterest",
  "StockholdersEquity",
  "CashAndCashEquivalents",
  "LongTermDebt",
  "CurrentDebt",
  "TotalDebt",
  "RetainedEarnings",
  "BasicAverageShares",
  "DilutedAverageShares",
] as const

const QUARTERLY_TIMESERIES_KEYS = ["TotalRevenue", "NetIncome"] as const

//#region Schemas and types
export const EvaluationBasisSchema = z.enum(["reported", "derived", "modeled"])
export const EvaluationCategorySchema = z.enum(["fairness", "quality", "dividend", "stability"])

export const EvaluationMetricSchema = z.object({
  key: z.string(),
  label: z.string(),
  category: EvaluationCategorySchema,
  value: z.number().nullable(),
  formatted: z.string(),
  basis: EvaluationBasisSchema,
  source: z.string(),
  source_url: z.string(),
  retrieved_at: z.string(),
  formula: z.string().optional(),
  notes: z.array(z.string()).optional(),
})

export const QuarterlyBarSchema = z.object({
  quarter: z.string(),
  revenue: z.number().nullable(),
  netIncome: z.number().nullable(),
  source: z.string(),
  source_url: z.string(),
  retrieved_at: z.string(),
})

export const ReportEvaluationSnapshotSchema = z.object({
  ticker: z.string(),
  generated_at: z.string(),
  current_price: z.number().nullable(),
  fairness: z.array(EvaluationMetricSchema),
  quality: z.array(EvaluationMetricSchema),
  dividend: z.array(EvaluationMetricSchema),
  stability: z.array(EvaluationMetricSchema),
  last_four_quarters: z.array(QuarterlyBarSchema),
  unknowns: z.array(z.string()),
})

export type EvaluationMetric = z.infer<typeof EvaluationMetricSchema>
export type QuarterlyBar = z.infer<typeof QuarterlyBarSchema>
export type ReportEvaluationSnapshot = z.infer<typeof ReportEvaluationSnapshotSchema>

export interface ReportEvaluationArtifacts {
  output_root: string
  evaluation_path: string
  snapshot_path: string
}

type SourceKey = "summary" | "annual" | "quarterly"
type StatementField =
  | "revenue"
  | "netIncome"
  | "grossProfit"
  | "operatingIncome"
  | "pretaxIncome"
  | "incomeTaxExpense"
  | "operatingCashFlow"
  | "currentAssets"
  | "currentLiabilities"
  | "totalAssets"
  | "totalLiabilities"
  | "equity"
  | "cash"
  | "longTermDebt"
  | "currentDebt"
  | "totalDebt"
  | "retainedEarnings"
  | "sharesBasic"
  | "sharesDiluted"
  | "effectiveTaxRatePercent"

type SourceMeta = {
  key: SourceKey
  label: string
  url: string
  retrievedAt: string
}

type SourceFetch<T> = {
  meta: SourceMeta
  data?: T
  error?: string
}

type StatementPeriod = {
  timeframe: "annual" | "quarterly"
  endDate: string
  label: string
  revenue: number | null
  netIncome: number | null
  grossProfit: number | null
  operatingIncome: number | null
  pretaxIncome: number | null
  incomeTaxExpense: number | null
  operatingCashFlow: number | null
  currentAssets: number | null
  currentLiabilities: number | null
  totalAssets: number | null
  totalLiabilities: number | null
  equity: number | null
  cash: number | null
  longTermDebt: number | null
  currentDebt: number | null
  totalDebt: number | null
  retainedEarnings: number | null
  sharesBasic: number | null
  sharesDiluted: number | null
  effectiveTaxRatePercent: number | null
}

type YahooSummaryData = {
  currentPrice: number | null
  marketCap: number | null
  sharesOutstanding: number | null
  analystPriceTargetMedian: number | null
  revenueTtm: number | null
  revenueGrowthPercent: number | null
  netIncomeTtm: number | null
  freeCashFlowTtm: number | null
  grossMarginPercent: number | null
  dividendYieldPercent: number | null
  payoutRatioPercent: number | null
  beta: number | null
}

type DerivedResult = {
  value: number | null
  reason?: string
}

type TimeSeriesFieldSpec = {
  key: string
  field: StatementField
  parser: (input: unknown) => number | null
}

type DcfInput = {
  ttmFreeCashFlow: number | null
  revenueGrowthPercent: number | null
  cash: number | null
  totalDebt: number | null
  sharesOutstanding: number | null
}

type RoicInput = {
  operatingIncome: number | null
  effectiveTaxRatePercent: number | null
  currentDebt: number | null
  currentEquity: number | null
  currentCash: number | null
  priorDebt: number | null
  priorEquity: number | null
  priorCash: number | null
}

type PiotroskiInput = {
  currentNetIncome: number | null
  currentOperatingCashFlow: number | null
  currentTotalAssets: number | null
  currentTotalDebt: number | null
  currentCurrentAssets: number | null
  currentCurrentLiabilities: number | null
  currentGrossProfit: number | null
  currentRevenue: number | null
  currentSharesDiluted: number | null
  priorNetIncome: number | null
  priorOperatingCashFlow: number | null
  priorTotalAssets: number | null
  priorTotalDebt: number | null
  priorCurrentAssets: number | null
  priorCurrentLiabilities: number | null
  priorGrossProfit: number | null
  priorRevenue: number | null
  priorSharesDiluted: number | null
}

type AltmanInput = {
  workingCapital: number | null
  retainedEarnings: number | null
  ebit: number | null
  equity: number | null
  totalAssets: number | null
  totalLiabilities: number | null
}
//#endregion

//#region Formatting helpers
function fromRaw(input: unknown): unknown {
  if (input && typeof input === "object" && "raw" in input) {
    return (input as Record<string, unknown>).raw
  }
  return input
}

function toNumber(input: unknown): number | null {
  return sharedToNumber(fromRaw(input))
}

function toPercent(input: unknown): number | null {
  return sharedToPercent(fromRaw(input))
}

function hasNumber(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input)
}

function dateOnly(input: unknown) {
  const value = asText(input).trim()
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().slice(0, 10)
}

function compactCurrency(input: number | null) {
  if (!hasNumber(input)) return "unknown"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(input) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(input)
}

function moneyPerShare(input: number | null) {
  if (!hasNumber(input)) return "unknown"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(input)
}

function percentText(input: number | null) {
  if (!hasNumber(input)) return "unknown"
  return `${trimNumber(input)}%`
}

function ratioText(input: number | null) {
  if (!hasNumber(input)) return "unknown"
  return `${trimNumber(input)}x`
}

function decimalText(input: number | null) {
  if (!hasNumber(input)) return "unknown"
  return trimNumber(input)
}

function scoreText(input: number | null) {
  if (!hasNumber(input)) return "unknown"
  if (Number.isInteger(input)) return `${input}`
  return trimNumber(input)
}

function trimNumber(input: number, digits = 2) {
  return input.toFixed(digits).replace(/\.?0+$/, "")
}

function quarterLabel(endDate: string) {
  const date = new Date(endDate)
  if (Number.isNaN(date.getTime())) return endDate || "unknown"
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1
  return `Q${quarter} ${date.getUTCFullYear()}`
}

function annualLabel(endDate: string) {
  const date = new Date(endDate)
  if (Number.isNaN(date.getTime())) return endDate || "unknown"
  return `FY ${date.getUTCFullYear()}`
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br/>")
}
//#endregion

//#region Yahoo fetch
function quoteSummaryUrl(ticker: string) {
  return `${YAHOO_QUERY1_BASE}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(SUMMARY_MODULES)}`
}

function timeSeriesUrl(ticker: string, timeframe: "annual" | "quarterly", keys: readonly string[]) {
  const prefix = timeframe === "annual" ? "annual" : "quarterly"
  const params = new URLSearchParams({
    symbol: ticker,
    type: keys.map((key) => `${prefix}${key}`).join(","),
    period1: String(TIMESERIES_START_UNIX_SECONDS),
    period2: String(Math.ceil(Date.now() / 1000)),
  })
  return `${YAHOO_QUERY2_BASE}/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(ticker)}?${params.toString()}`
}

async function fetchJson<T>(input: {
  key: SourceKey
  url: string
  signal?: AbortSignal
}): Promise<SourceFetch<T>> {
  const { signal, clearTimeout } = abortAfterAny(DEFAULT_TIMEOUT_MS, ...(input.signal ? [input.signal] : []))
  const meta: SourceMeta = {
    key: input.key,
    label: YAHOO_LABEL,
    url: input.url,
    retrievedAt: new Date().toISOString(),
  }

  try {
    const response = await fetch(input.url, {
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "opencode-finance/1.0",
      },
    })
    clearTimeout()

    if (!response.ok) {
      const text = await response.text()
      return {
        meta,
        error: `${response.status}: ${text || response.statusText}`,
      }
    }

    return {
      meta,
      data: (await response.json()) as T,
    }
  } catch (error) {
    clearTimeout()
    return {
      meta,
      error: normalizeErrorText(error),
    }
  }
}
//#endregion

//#region Yahoo parse
const ANNUAL_FIELD_SPECS: TimeSeriesFieldSpec[] = [
  { key: "TotalRevenue", field: "revenue", parser: toNumber },
  { key: "NetIncome", field: "netIncome", parser: toNumber },
  { key: "GrossProfit", field: "grossProfit", parser: toNumber },
  { key: "OperatingIncome", field: "operatingIncome", parser: toNumber },
  { key: "PretaxIncome", field: "pretaxIncome", parser: toNumber },
  { key: "TaxProvision", field: "incomeTaxExpense", parser: toNumber },
  { key: "TaxRateForCalcs", field: "effectiveTaxRatePercent", parser: toPercent },
  { key: "OperatingCashFlow", field: "operatingCashFlow", parser: toNumber },
  { key: "CurrentAssets", field: "currentAssets", parser: toNumber },
  { key: "CurrentLiabilities", field: "currentLiabilities", parser: toNumber },
  { key: "TotalAssets", field: "totalAssets", parser: toNumber },
  { key: "TotalLiabilitiesNetMinorityInterest", field: "totalLiabilities", parser: toNumber },
  { key: "StockholdersEquity", field: "equity", parser: toNumber },
  { key: "CashAndCashEquivalents", field: "cash", parser: toNumber },
  { key: "LongTermDebt", field: "longTermDebt", parser: toNumber },
  { key: "CurrentDebt", field: "currentDebt", parser: toNumber },
  { key: "TotalDebt", field: "totalDebt", parser: toNumber },
  { key: "RetainedEarnings", field: "retainedEarnings", parser: toNumber },
  { key: "BasicAverageShares", field: "sharesBasic", parser: toNumber },
  { key: "DilutedAverageShares", field: "sharesDiluted", parser: toNumber },
]

const QUARTERLY_FIELD_SPECS: TimeSeriesFieldSpec[] = [
  { key: "TotalRevenue", field: "revenue", parser: toNumber },
  { key: "NetIncome", field: "netIncome", parser: toNumber },
]

function firstQuoteSummaryResult(payload: unknown) {
  if (!payload || typeof payload !== "object") return {}
  const quoteSummary = (payload as Record<string, unknown>).quoteSummary
  if (!quoteSummary || typeof quoteSummary !== "object") return {}
  const result = rows((quoteSummary as Record<string, unknown>).result)
  return result[0] ?? {}
}

function quoteSummaryError(payload: unknown) {
  if (!payload || typeof payload !== "object") return ""
  const quoteSummary = (payload as Record<string, unknown>).quoteSummary
  if (!quoteSummary || typeof quoteSummary !== "object") return ""
  const error = (quoteSummary as Record<string, unknown>).error
  if (!error || typeof error !== "object") return ""
  return asText((error as Record<string, unknown>).description).trim()
}

function parseYahooSummary(payload: unknown): YahooSummaryData {
  const row = firstQuoteSummaryResult(payload)
  const financialData = (row.financialData as Record<string, unknown> | undefined) ?? {}
  const defaultKeyStatistics = (row.defaultKeyStatistics as Record<string, unknown> | undefined) ?? {}
  const summaryDetail = (row.summaryDetail as Record<string, unknown> | undefined) ?? {}
  const price = (row.price as Record<string, unknown> | undefined) ?? {}

  return {
    currentPrice: toNumber(price.regularMarketPrice),
    marketCap: toNumber(price.marketCap ?? summaryDetail.marketCap),
    sharesOutstanding: toNumber(defaultKeyStatistics.sharesOutstanding ?? price.sharesOutstanding),
    analystPriceTargetMedian: toNumber(financialData.targetMedianPrice),
    revenueTtm: toNumber(financialData.totalRevenue),
    revenueGrowthPercent: toPercent(financialData.revenueGrowth),
    netIncomeTtm: toNumber(financialData.netIncomeToCommon),
    freeCashFlowTtm: toNumber(financialData.freeCashflow),
    grossMarginPercent: toPercent(financialData.grossMargins),
    dividendYieldPercent: toPercent(summaryDetail.dividendYield),
    payoutRatioPercent: toPercent(summaryDetail.payoutRatio),
    beta: toNumber(defaultKeyStatistics.beta ?? defaultKeyStatistics.beta3Year),
  }
}

function createStatementPeriod(timeframe: "annual" | "quarterly", endDate: string): StatementPeriod {
  return {
    timeframe,
    endDate,
    label: timeframe === "annual" ? annualLabel(endDate) : quarterLabel(endDate),
    revenue: null,
    netIncome: null,
    grossProfit: null,
    operatingIncome: null,
    pretaxIncome: null,
    incomeTaxExpense: null,
    operatingCashFlow: null,
    currentAssets: null,
    currentLiabilities: null,
    totalAssets: null,
    totalLiabilities: null,
    equity: null,
    cash: null,
    longTermDebt: null,
    currentDebt: null,
    totalDebt: null,
    retainedEarnings: null,
    sharesBasic: null,
    sharesDiluted: null,
    effectiveTaxRatePercent: null,
  }
}

function finalizeStatementPeriod(period: StatementPeriod): StatementPeriod {
  const next = { ...period }

  if (next.totalDebt === null && next.longTermDebt !== null && next.currentDebt !== null) {
    next.totalDebt = next.longTermDebt + next.currentDebt
  }

  if (next.effectiveTaxRatePercent === null && next.incomeTaxExpense !== null && next.pretaxIncome !== null && next.pretaxIncome > 0) {
    next.effectiveTaxRatePercent = (next.incomeTaxExpense / next.pretaxIncome) * 100
  }

  return next
}

function sortPeriods(periods: StatementPeriod[]) {
  return [...periods].sort((left, right) => {
    if (left.endDate === right.endDate) return 0
    return left.endDate < right.endDate ? 1 : -1
  })
}

function parseTimeSeries(payload: unknown, timeframe: "annual" | "quarterly", specs: TimeSeriesFieldSpec[]) {
  const prefix = timeframe === "annual" ? "annual" : "quarterly"
  const periods = new Map<string, StatementPeriod>()
  const result = rows(((payload as Record<string, unknown> | undefined)?.timeseries as Record<string, unknown> | undefined)?.result)
  const specBySeries = new Map(specs.map((spec) => [`${prefix}${spec.key}`, spec]))

  for (const item of result) {
    const seriesName = Object.keys(item).find((key) => key !== "meta" && key !== "timestamp")
    if (!seriesName) continue

    const spec = specBySeries.get(seriesName)
    if (!spec) continue

    for (const point of rows(item[seriesName])) {
      const endDate = dateOnly(point.asOfDate)
      if (!endDate) continue

      const period = periods.get(endDate) ?? createStatementPeriod(timeframe, endDate)
      period[spec.field] = spec.parser(point.reportedValue)
      periods.set(endDate, period)
    }
  }

  return sortPeriods([...periods.values()].map(finalizeStatementPeriod))
}
//#endregion

//#region Derived metrics
function deriveMarketCap(input: {
  directMarketCap: number | null
  currentPrice: number | null
  sharesOutstanding: number | null
}): DerivedResult {
  if (input.directMarketCap !== null) {
    return { value: input.directMarketCap }
  }
  if (input.currentPrice === null || input.sharesOutstanding === null) {
    return { value: null, reason: "requires Yahoo market cap or current price and shares outstanding" }
  }
  return {
    value: input.currentPrice * input.sharesOutstanding,
  }
}

function calculateDcfPerShare(input: DcfInput): DerivedResult {
  if (input.ttmFreeCashFlow === null || input.ttmFreeCashFlow <= 0) {
    return { value: null, reason: "requires positive Yahoo TTM free cash flow" }
  }
  if (input.revenueGrowthPercent === null) {
    return { value: null, reason: "requires Yahoo revenue growth" }
  }
  if (input.cash === null || input.totalDebt === null) {
    return { value: null, reason: "requires annual cash and total debt" }
  }
  if (input.sharesOutstanding === null || input.sharesOutstanding <= 0) {
    return { value: null, reason: "requires Yahoo shares outstanding" }
  }

  const growth = Math.max(0, Math.min(DCF_GROWTH_CAP_PERCENT, input.revenueGrowthPercent)) / 100
  let cashFlow = input.ttmFreeCashFlow
  let presentValue = 0

  for (let year = 1; year <= DCF_YEARS; year++) {
    cashFlow *= 1 + growth
    presentValue += cashFlow / (1 + DCF_DISCOUNT_RATE) ** year
  }

  const terminalCashFlow = cashFlow * (1 + DCF_TERMINAL_GROWTH_RATE)
  const terminalValue = terminalCashFlow / (DCF_DISCOUNT_RATE - DCF_TERMINAL_GROWTH_RATE)
  const enterpriseValue = presentValue + terminalValue / (1 + DCF_DISCOUNT_RATE) ** DCF_YEARS
  const equityValue = enterpriseValue + input.cash - input.totalDebt

  return {
    value: equityValue / input.sharesOutstanding,
  }
}

function calculateRatio(input: {
  numerator: number | null
  denominator: number | null
  reason: string
}): DerivedResult {
  if (input.numerator === null || input.denominator === null || input.denominator <= 0) {
    return { value: null, reason: input.reason }
  }
  return {
    value: input.numerator / input.denominator,
  }
}

function calculatePriceMultiple(marketCap: number | null, baseValue: number | null, baseLabel: string): DerivedResult {
  return calculateRatio({
    numerator: marketCap,
    denominator: baseValue,
    reason: `requires market cap and positive ${baseLabel}`,
  })
}

function calculateFcfYield(freeCashFlow: number | null, marketCap: number | null): DerivedResult {
  if (freeCashFlow === null || marketCap === null || marketCap <= 0) {
    return { value: null, reason: "requires market cap and TTM free cash flow" }
  }
  return {
    value: (freeCashFlow / marketCap) * 100,
  }
}

function calculateRuleOf40(input: {
  revenueGrowthPercent: number | null
  ttmRevenue: number | null
  ttmFreeCashFlow: number | null
}): DerivedResult {
  if (input.revenueGrowthPercent === null) {
    return { value: null, reason: "requires Yahoo revenue growth" }
  }
  if (input.ttmRevenue === null || input.ttmRevenue <= 0 || input.ttmFreeCashFlow === null) {
    return { value: null, reason: "requires Yahoo TTM revenue and free cash flow" }
  }
  return {
    value: input.revenueGrowthPercent + (input.ttmFreeCashFlow / input.ttmRevenue) * 100,
  }
}

function calculateSustainableGrowthRate(roePercent: number | null, payoutRatioPercent: number | null): DerivedResult {
  if (roePercent === null || payoutRatioPercent === null) {
    return { value: null, reason: "requires ROE and dividend payout ratio" }
  }
  return {
    value: roePercent * (1 - payoutRatioPercent / 100),
  }
}

function calculateRoic(input: RoicInput): DerivedResult {
  if (input.operatingIncome === null) {
    return { value: null, reason: "requires annual operating income" }
  }
  if (input.effectiveTaxRatePercent === null) {
    return { value: null, reason: "requires annual effective tax rate" }
  }
  if (
    input.currentDebt === null ||
    input.currentEquity === null ||
    input.currentCash === null ||
    input.priorDebt === null ||
    input.priorEquity === null ||
    input.priorCash === null
  ) {
    return { value: null, reason: "requires current and prior invested capital inputs" }
  }

  const nopat = input.operatingIncome * (1 - input.effectiveTaxRatePercent / 100)
  const currentInvestedCapital = input.currentDebt + input.currentEquity - input.currentCash
  const priorInvestedCapital = input.priorDebt + input.priorEquity - input.priorCash
  const averageInvestedCapital = (currentInvestedCapital + priorInvestedCapital) / 2

  if (!Number.isFinite(averageInvestedCapital) || averageInvestedCapital === 0) {
    return { value: null, reason: "average invested capital is zero or invalid" }
  }

  return {
    value: (nopat / averageInvestedCapital) * 100,
  }
}

function calculateRoe(input: {
  ttmNetIncome: number | null
  currentEquity: number | null
  priorEquity: number | null
}): DerivedResult {
  if (input.ttmNetIncome === null) {
    return { value: null, reason: "requires Yahoo TTM net income" }
  }
  if (input.currentEquity === null || input.priorEquity === null) {
    return { value: null, reason: "requires current and prior annual equity" }
  }

  const averageEquity = (input.currentEquity + input.priorEquity) / 2
  if (!Number.isFinite(averageEquity) || averageEquity <= 0) {
    return { value: null, reason: "average equity is zero or invalid" }
  }

  return {
    value: (input.ttmNetIncome / averageEquity) * 100,
  }
}

function calculatePiotroskiFScore(input: PiotroskiInput): DerivedResult {
  if (
    input.currentNetIncome === null ||
    input.currentOperatingCashFlow === null ||
    input.currentTotalAssets === null ||
    input.currentTotalDebt === null ||
    input.currentCurrentAssets === null ||
    input.currentCurrentLiabilities === null ||
    input.currentGrossProfit === null ||
    input.currentRevenue === null ||
    input.currentSharesDiluted === null ||
    input.priorNetIncome === null ||
    input.priorOperatingCashFlow === null ||
    input.priorTotalAssets === null ||
    input.priorTotalDebt === null ||
    input.priorCurrentAssets === null ||
    input.priorCurrentLiabilities === null ||
    input.priorGrossProfit === null ||
    input.priorRevenue === null ||
    input.priorSharesDiluted === null
  ) {
    return { value: null, reason: "requires current and prior annual statement coverage" }
  }

  const averageAssets = (input.currentTotalAssets + input.priorTotalAssets) / 2
  if (!Number.isFinite(averageAssets) || averageAssets <= 0) {
    return { value: null, reason: "average assets is zero or invalid" }
  }

  const currentRoa = input.currentNetIncome / averageAssets
  const priorRoa = input.priorNetIncome / input.priorTotalAssets
  const currentDebtRatio = input.currentTotalDebt / input.currentTotalAssets
  const priorDebtRatio = input.priorTotalDebt / input.priorTotalAssets
  const currentRatio = input.currentCurrentAssets / input.currentCurrentLiabilities
  const priorRatio = input.priorCurrentAssets / input.priorCurrentLiabilities
  const currentGrossMargin = input.currentGrossProfit / input.currentRevenue
  const priorGrossMargin = input.priorGrossProfit / input.priorRevenue
  const currentAssetTurnover = input.currentRevenue / averageAssets
  const priorAssetTurnover = input.priorRevenue / input.priorTotalAssets

  const score = [
    currentRoa > 0,
    input.currentOperatingCashFlow > 0,
    currentRoa > priorRoa,
    input.currentOperatingCashFlow > input.currentNetIncome,
    currentDebtRatio < priorDebtRatio,
    currentRatio > priorRatio,
    input.currentSharesDiluted <= input.priorSharesDiluted,
    currentGrossMargin > priorGrossMargin,
    currentAssetTurnover > priorAssetTurnover,
  ].filter(Boolean).length

  return {
    value: score,
  }
}

function calculateAltmanZScore(input: AltmanInput): DerivedResult {
  if (
    input.workingCapital === null ||
    input.retainedEarnings === null ||
    input.ebit === null ||
    input.equity === null ||
    input.totalAssets === null ||
    input.totalLiabilities === null
  ) {
    return { value: null, reason: "requires working capital, retained earnings, EBIT, equity, assets, and liabilities" }
  }
  if (input.totalAssets <= 0 || input.totalLiabilities <= 0) {
    return { value: null, reason: "requires positive total assets and total liabilities" }
  }

  return {
    value:
      6.56 * (input.workingCapital / input.totalAssets) +
      3.26 * (input.retainedEarnings / input.totalAssets) +
      6.72 * (input.ebit / input.totalAssets) +
      1.05 * (input.equity / input.totalLiabilities),
  }
}

function sourceSummary(sourceMap: Map<SourceKey, SourceMeta>, keys: SourceKey[]) {
  const items = Array.from(new Set(keys)).flatMap((key) => {
    const source = sourceMap.get(key)
    return source ? [source] : []
  })

  if (!items.length) {
    return {
      source: "unknown",
      source_url: "unknown",
      retrieved_at: "unknown",
    }
  }

  return {
    source: YAHOO_LABEL,
    source_url: Array.from(new Set(items.map((item) => item.url))).join(" | "),
    retrieved_at: items
      .map((item) => item.retrievedAt)
      .filter((item) => item.length > 0)
      .sort((left, right) => (left > right ? -1 : 1))[0] ?? "unknown",
  }
}

function metricRecord(input: {
  key: string
  label: string
  category: z.infer<typeof EvaluationCategorySchema>
  value: number | null
  basis: z.infer<typeof EvaluationBasisSchema>
  format: (value: number | null) => string
  sourceKeys: SourceKey[]
  sourceMap: Map<SourceKey, SourceMeta>
  formula?: string
  notes?: string[]
}): EvaluationMetric {
  const source = sourceSummary(input.sourceMap, input.sourceKeys)
  return {
    key: input.key,
    label: input.label,
    category: input.category,
    value: input.value,
    formatted: input.format(input.value),
    basis: input.basis,
    source: source.source,
    source_url: source.source_url,
    retrieved_at: source.retrieved_at,
    ...(input.formula ? { formula: input.formula } : {}),
    ...(input.notes?.length ? { notes: input.notes } : {}),
  }
}

function unknownReason(label: string, reason: string) {
  return `${label}: ${reason}`
}

function normalizeUnknowns(values: string[]) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// TODO: PEGY needs a Yahoo-native EPS growth policy before reintroduction.

export async function buildReportEvaluationSnapshot(input: {
  ticker: string
  signal?: AbortSignal
}): Promise<ReportEvaluationSnapshot> {
  const ticker = normalizeTicker(input.ticker)
  if (!ticker) throw new Error("ticker must include at least one valid symbol character")

  const summaryUrl = quoteSummaryUrl(ticker)
  const annualUrl = timeSeriesUrl(ticker, "annual", ANNUAL_TIMESERIES_KEYS)
  const quarterlyUrl = timeSeriesUrl(ticker, "quarterly", QUARTERLY_TIMESERIES_KEYS)

  const requests = await Promise.all([
    fetchJson<Record<string, unknown>>({ key: "summary", url: summaryUrl, signal: input.signal }),
    fetchJson<Record<string, unknown>>({ key: "annual", url: annualUrl, signal: input.signal }),
    fetchJson<Record<string, unknown>>({ key: "quarterly", url: quarterlyUrl, signal: input.signal }),
  ])

  const sourceMap = new Map<SourceKey, SourceMeta>()
  const unknowns: string[] = []

  for (const request of requests) {
    sourceMap.set(request.meta.key, request.meta)
    if (request.error) {
      unknowns.push(`${request.meta.label} (${request.meta.key}): ${request.error}`)
    }
  }

  const [summaryRaw, annualRaw, quarterlyRaw] = requests

  if (summaryRaw.data) {
    const error = quoteSummaryError(summaryRaw.data)
    if (error) unknowns.push(`${YAHOO_LABEL} (summary): ${error}`)
  }

  const summary = parseYahooSummary(summaryRaw.data)
  const annual = parseTimeSeries(annualRaw.data, "annual", ANNUAL_FIELD_SPECS)
  const quarterly = parseTimeSeries(quarterlyRaw.data, "quarterly", QUARTERLY_FIELD_SPECS)

  const currentAnnual = annual[0]
  const priorAnnual = annual[1]
  const marketCap = deriveMarketCap({
    directMarketCap: summary.marketCap,
    currentPrice: summary.currentPrice,
    sharesOutstanding: summary.sharesOutstanding,
  })

  const dcf = calculateDcfPerShare({
    ttmFreeCashFlow: summary.freeCashFlowTtm,
    revenueGrowthPercent: summary.revenueGrowthPercent,
    cash: currentAnnual?.cash ?? null,
    totalDebt: currentAnnual?.totalDebt ?? null,
    sharesOutstanding: summary.sharesOutstanding,
  })
  const priceToEarnings = calculatePriceMultiple(marketCap.value, summary.netIncomeTtm, "TTM net income")
  const priceToSales = calculatePriceMultiple(marketCap.value, summary.revenueTtm, "TTM revenue")
  const priceToBook = calculatePriceMultiple(marketCap.value, currentAnnual?.equity ?? null, "annual equity")
  const fcfYield = calculateFcfYield(summary.freeCashFlowTtm, marketCap.value)
  const priceToFcf = calculatePriceMultiple(marketCap.value, summary.freeCashFlowTtm, "TTM free cash flow")
  const roic = currentAnnual && priorAnnual
    ? calculateRoic({
        operatingIncome: currentAnnual.operatingIncome,
        effectiveTaxRatePercent: currentAnnual.effectiveTaxRatePercent,
        currentDebt: currentAnnual.totalDebt,
        currentEquity: currentAnnual.equity,
        currentCash: currentAnnual.cash,
        priorDebt: priorAnnual.totalDebt,
        priorEquity: priorAnnual.equity,
        priorCash: priorAnnual.cash,
      })
    : { value: null, reason: "requires current and prior annual statement periods" }
  const roe = currentAnnual && priorAnnual
    ? calculateRoe({
        ttmNetIncome: summary.netIncomeTtm,
        currentEquity: currentAnnual.equity,
        priorEquity: priorAnnual.equity,
      })
    : { value: null, reason: "requires current and prior annual statement periods" }
  const debtToEquity = calculateRatio({
    numerator: currentAnnual?.totalDebt ?? null,
    denominator: currentAnnual?.equity ?? null,
    reason: "requires annual total debt and positive annual equity",
  })
  const ruleOf40 = calculateRuleOf40({
    revenueGrowthPercent: summary.revenueGrowthPercent,
    ttmRevenue: summary.revenueTtm,
    ttmFreeCashFlow: summary.freeCashFlowTtm,
  })
  const sustainableGrowth = calculateSustainableGrowthRate(roe.value, summary.payoutRatioPercent)
  const piotroski = currentAnnual && priorAnnual
    ? calculatePiotroskiFScore({
        currentNetIncome: currentAnnual.netIncome,
        currentOperatingCashFlow: currentAnnual.operatingCashFlow,
        currentTotalAssets: currentAnnual.totalAssets,
        currentTotalDebt: currentAnnual.totalDebt,
        currentCurrentAssets: currentAnnual.currentAssets,
        currentCurrentLiabilities: currentAnnual.currentLiabilities,
        currentGrossProfit: currentAnnual.grossProfit,
        currentRevenue: currentAnnual.revenue,
        currentSharesDiluted: currentAnnual.sharesDiluted,
        priorNetIncome: priorAnnual.netIncome,
        priorOperatingCashFlow: priorAnnual.operatingCashFlow,
        priorTotalAssets: priorAnnual.totalAssets,
        priorTotalDebt: priorAnnual.totalDebt,
        priorCurrentAssets: priorAnnual.currentAssets,
        priorCurrentLiabilities: priorAnnual.currentLiabilities,
        priorGrossProfit: priorAnnual.grossProfit,
        priorRevenue: priorAnnual.revenue,
        priorSharesDiluted: priorAnnual.sharesDiluted,
      })
    : { value: null, reason: "requires current and prior annual statement periods" }
  const altman = currentAnnual
    ? calculateAltmanZScore({
        workingCapital:
          currentAnnual.currentAssets !== null && currentAnnual.currentLiabilities !== null
            ? currentAnnual.currentAssets - currentAnnual.currentLiabilities
            : null,
        retainedEarnings: currentAnnual.retainedEarnings,
        ebit: currentAnnual.operatingIncome,
        equity: currentAnnual.equity,
        totalAssets: currentAnnual.totalAssets,
        totalLiabilities: currentAnnual.totalLiabilities,
      })
    : { value: null, reason: "requires current annual statement period" }

  const fairness: EvaluationMetric[] = [
    metricRecord({
      key: "dcf",
      label: "DCF",
      category: "fairness",
      value: dcf.value,
      basis: "modeled",
      format: moneyPerShare,
      sourceKeys: ["summary", "annual"],
      sourceMap,
      formula: "TTM free cash flow grown for 5 years using Yahoo revenue growth; discounted at 10%; terminal growth 2.5%",
      notes: [
        `Growth rate is clamped to 0%..${DCF_GROWTH_CAP_PERCENT}%`,
        `Discount rate ${trimNumber(DCF_DISCOUNT_RATE * 100)}%, terminal growth ${trimNumber(DCF_TERMINAL_GROWTH_RATE * 100)}%`,
        ...(dcf.reason ? [dcf.reason] : []),
      ],
    }),
    metricRecord({
      key: "price_target_median",
      label: "Price Target Median",
      category: "fairness",
      value: summary.analystPriceTargetMedian,
      basis: "reported",
      format: moneyPerShare,
      sourceKeys: ["summary"],
      sourceMap,
      notes: summary.analystPriceTargetMedian === null ? ["requires Yahoo analyst price target data"] : undefined,
    }),
    metricRecord({
      key: "price_to_earnings",
      label: "Price-to-Earnings",
      category: "fairness",
      value: priceToEarnings.value,
      basis: "derived",
      format: ratioText,
      sourceKeys: ["summary"],
      sourceMap,
      formula: "market_cap / ttm_net_income",
      notes: priceToEarnings.reason ? [priceToEarnings.reason] : undefined,
    }),
    metricRecord({
      key: "price_to_sales",
      label: "Price-to-Sales",
      category: "fairness",
      value: priceToSales.value,
      basis: "derived",
      format: ratioText,
      sourceKeys: ["summary"],
      sourceMap,
      formula: "market_cap / ttm_revenue",
      notes: priceToSales.reason ? [priceToSales.reason] : undefined,
    }),
    metricRecord({
      key: "price_to_book",
      label: "Price-to-Book",
      category: "fairness",
      value: priceToBook.value,
      basis: "derived",
      format: ratioText,
      sourceKeys: ["summary", "annual"],
      sourceMap,
      formula: "market_cap / annual_equity",
      notes: priceToBook.reason ? [priceToBook.reason] : undefined,
    }),
    metricRecord({
      key: "fcf_yield",
      label: "Free Cash Flow Yield",
      category: "fairness",
      value: fcfYield.value,
      basis: "derived",
      format: percentText,
      sourceKeys: ["summary"],
      sourceMap,
      formula: "ttm_free_cash_flow / market_cap",
      notes: fcfYield.reason ? [fcfYield.reason] : undefined,
    }),
    metricRecord({
      key: "price_to_fcf",
      label: "Price to Free Cash Flow Ratio",
      category: "fairness",
      value: priceToFcf.value,
      basis: "derived",
      format: ratioText,
      sourceKeys: ["summary"],
      sourceMap,
      formula: "market_cap / ttm_free_cash_flow",
      notes: priceToFcf.reason ? [priceToFcf.reason] : undefined,
    }),
    metricRecord({
      key: "piotroski_f_score",
      label: "Piotroski F-score",
      category: "fairness",
      value: piotroski.value,
      basis: "derived",
      format: scoreText,
      sourceKeys: ["annual"],
      sourceMap,
      formula: "Standard 9-point annual Piotroski F-score",
      notes: piotroski.reason ? [piotroski.reason] : undefined,
    }),
    metricRecord({
      key: "altman_z_score",
      label: "Altman Z-score",
      category: "fairness",
      value: altman.value,
      basis: "derived",
      format: decimalText,
      sourceKeys: ["annual"],
      sourceMap,
      formula: "Altman Z'' = 6.56*(WC/TA) + 3.26*(RE/TA) + 6.72*(EBIT/TA) + 1.05*(Equity/TL)",
      notes: ["Uses the non-manufacturing Z'' variant", ...(altman.reason ? [altman.reason] : [])],
    }),
  ]

  const quality: EvaluationMetric[] = [
    metricRecord({
      key: "roic",
      label: "Return on Invested Capital",
      category: "quality",
      value: roic.value,
      basis: "derived",
      format: percentText,
      sourceKeys: ["annual"],
      sourceMap,
      formula: "NOPAT / average invested capital",
      notes: roic.reason ? [roic.reason] : undefined,
    }),
    metricRecord({
      key: "roe",
      label: "Return on Equity",
      category: "quality",
      value: roe.value,
      basis: "derived",
      format: percentText,
      sourceKeys: ["summary", "annual"],
      sourceMap,
      formula: "ttm_net_income / average_equity",
      notes: roe.reason ? [roe.reason] : undefined,
    }),
    metricRecord({
      key: "debt_to_equity",
      label: "Debt to Equity",
      category: "quality",
      value: debtToEquity.value,
      basis: "derived",
      format: ratioText,
      sourceKeys: ["annual"],
      sourceMap,
      formula: "annual_total_debt / annual_equity",
      notes: debtToEquity.reason ? [debtToEquity.reason] : undefined,
    }),
    metricRecord({
      key: "rule_of_40",
      label: "Rule of 40",
      category: "quality",
      value: ruleOf40.value,
      basis: "derived",
      format: percentText,
      sourceKeys: ["summary"],
      sourceMap,
      formula: "yahoo_revenue_growth_percent + (ttm_free_cash_flow / ttm_revenue)",
      notes: ruleOf40.reason ? [ruleOf40.reason] : undefined,
    }),
    metricRecord({
      key: "gross_profit_margin_ttm",
      label: "Gross Profit Margin TTM",
      category: "quality",
      value: summary.grossMarginPercent,
      basis: "reported",
      format: percentText,
      sourceKeys: ["summary"],
      sourceMap,
      notes: summary.grossMarginPercent === null ? ["requires Yahoo gross margin data"] : undefined,
    }),
    metricRecord({
      key: "sustainable_growth_rate_ttm",
      label: "Sustainable Growth Rate TTM",
      category: "quality",
      value: sustainableGrowth.value,
      basis: "derived",
      format: percentText,
      sourceKeys: ["summary", "annual"],
      sourceMap,
      formula: "roe_percent * (1 - payout_ratio_percent / 100)",
      notes: sustainableGrowth.reason ? [sustainableGrowth.reason] : undefined,
    }),
  ]

  const dividend: EvaluationMetric[] = [
    metricRecord({
      key: "dividend_payout_ratio",
      label: "Dividend Payout Ratio",
      category: "dividend",
      value: summary.payoutRatioPercent,
      basis: "reported",
      format: percentText,
      sourceKeys: ["summary"],
      sourceMap,
      notes: summary.payoutRatioPercent === null ? ["requires Yahoo payout ratio data"] : undefined,
    }),
    metricRecord({
      key: "dividend_yield",
      label: "Dividend Yield",
      category: "dividend",
      value: summary.dividendYieldPercent,
      basis: "reported",
      format: percentText,
      sourceKeys: ["summary"],
      sourceMap,
      notes: summary.dividendYieldPercent === null ? ["requires Yahoo dividend yield data"] : undefined,
    }),
  ]

  const stability: EvaluationMetric[] = [
    metricRecord({
      key: "beta",
      label: "Beta",
      category: "stability",
      value: summary.beta,
      basis: "reported",
      format: decimalText,
      sourceKeys: ["summary"],
      sourceMap,
      notes: summary.beta === null ? ["requires Yahoo beta data"] : undefined,
    }),
  ]

  for (const item of [...fairness, ...quality, ...dividend, ...stability]) {
    if (item.formatted !== "unknown") continue
    const reason = item.notes?.find(Boolean) ?? "unknown"
    unknowns.push(unknownReason(item.label, reason))
  }

  const lastFourQuarterPeriods = quarterly.slice(0, 4).reverse()
  if (lastFourQuarterPeriods.length < 4) {
    unknowns.push("Last 4 quarters chart: fewer than four quarterly statement periods are available")
  }

  const quarterSource = sourceSummary(sourceMap, ["quarterly"])
  const lastFourQuarters: QuarterlyBar[] = lastFourQuarterPeriods.map((period) => ({
    quarter: period.label,
    revenue: period.revenue,
    netIncome: period.netIncome,
    source: quarterSource.source,
    source_url: quarterSource.source_url,
    retrieved_at: quarterSource.retrieved_at,
  }))

  return {
    ticker,
    generated_at: new Date().toISOString(),
    current_price: summary.currentPrice,
    fairness,
    quality,
    dividend,
    stability,
    last_four_quarters: lastFourQuarters,
    unknowns: normalizeUnknowns(unknowns),
  }
}
//#endregion

//#region Markdown and artifacts
function tableSection(title: string, rows: EvaluationMetric[]) {
  return [
    `## ${title}`,
    "",
    "| Metric | Value | Basis | Formula | Source | Source URL | Retrieved At |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => {
      const formula = row.formula ?? "observed"
      return `| ${escapeCell(row.label)} | ${escapeCell(row.formatted)} | ${escapeCell(row.basis)} | ${escapeCell(formula)} | ${escapeCell(row.source)} | ${escapeCell(row.source_url)} | ${escapeCell(row.retrieved_at)} |`
    }),
    "",
  ]
}

export function renderReportEvaluationMarkdown(snapshot: ReportEvaluationSnapshot) {
  const lines = [
    "# Deterministic Evaluation Snapshot",
    "",
    `Ticker: ${snapshot.ticker}`,
    `Generated At: ${snapshot.generated_at}`,
    `Current Price: ${moneyPerShare(snapshot.current_price)}`,
    "",
    ...tableSection("Fairness", snapshot.fairness),
    ...tableSection("Quality", snapshot.quality),
    ...tableSection("Dividend", snapshot.dividend),
    ...tableSection("Price Stability", snapshot.stability),
    "## Last 4 Quarters",
    "",
    "| Quarter | Revenue | Net Income | Source | Source URL | Retrieved At |",
    "| --- | --- | --- | --- | --- | --- |",
    ...snapshot.last_four_quarters.map(
      (row) =>
        `| ${escapeCell(row.quarter)} | ${escapeCell(compactCurrency(row.revenue))} | ${escapeCell(compactCurrency(row.netIncome))} | ${escapeCell(row.source)} | ${escapeCell(row.source_url)} | ${escapeCell(row.retrieved_at)} |`,
    ),
    "",
    "## Unknowns",
    ...(snapshot.unknowns.length ? snapshot.unknowns.map((item) => `- ${item}`) : ["- none"]),
    "",
  ]
  return lines.join("\n")
}

export async function writeReportEvaluationArtifacts(input: {
  outputRoot: string
  snapshot: ReportEvaluationSnapshot
}) {
  await fs.mkdir(input.outputRoot, { recursive: true })
  const evaluationPath = path.join(input.outputRoot, "evaluation.md")
  const snapshotPath = path.join(input.outputRoot, "evaluation-snapshot.json")
  const markdown = renderReportEvaluationMarkdown(input.snapshot)
  const snapshotText = JSON.stringify(ReportEvaluationSnapshotSchema.parse(input.snapshot), null, 2)
  await Promise.all([Bun.write(evaluationPath, markdown), Bun.write(snapshotPath, snapshotText)])
  return {
    output_root: input.outputRoot,
    evaluation_path: evaluationPath,
    snapshot_path: snapshotPath,
  } satisfies ReportEvaluationArtifacts
}

export const ReportEvaluationInternal = {
  calculateAltmanZScore,
  calculateDcfPerShare,
  calculateFcfYield,
  calculatePiotroskiFScore,
  calculateRatio,
  calculatePriceMultiple,
  calculateRoic,
  calculateRoe,
  calculateRuleOf40,
  calculateSustainableGrowthRate,
}
//#endregion
