import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Auth } from "../auth"
import { Env } from "../env"
import { FINANCE_AUTH_PROVIDER, type FinanceAuthProviderID } from "../finance/auth-provider"
import { normalizeTicker, normalizeErrorText } from "../finance/parser"
import { abortAfterAny } from "../util/abort"

const YAHOO_BASE = "https://query1.finance.yahoo.com"
const FINNHUB_BASE = "https://finnhub.io/api/v1"
const POLYGON_BASE = "https://api.polygon.io"
const DEFAULT_TIMEOUT_MS = 12_000
const FALLBACK_TAX_RATE = 21
const DCF_DISCOUNT_RATE = 0.1
const DCF_TERMINAL_GROWTH_RATE = 0.025
const DCF_GROWTH_CAP_PERCENT = 12
const DCF_YEARS = 5

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

type SourceKey =
  | "yahoo_summary"
  | "finnhub_quote"
  | "finnhub_metric"
  | "finnhub_price_target"
  | "polygon_annual"
  | "polygon_quarterly"
  | "finnhub_annual"
  | "finnhub_quarterly"

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

type StatementField =
  | "revenue"
  | "netIncome"
  | "grossProfit"
  | "operatingIncome"
  | "pretaxIncome"
  | "incomeTaxExpense"
  | "operatingCashFlow"
  | "capex"
  | "freeCashFlow"
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

type StatementPeriod = {
  timeframe: "annual" | "quarterly"
  endDate: string
  fiscalPeriod: string
  label: string
  revenue: number | null
  netIncome: number | null
  grossProfit: number | null
  operatingIncome: number | null
  pretaxIncome: number | null
  incomeTaxExpense: number | null
  operatingCashFlow: number | null
  capex: number | null
  freeCashFlow: number | null
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
  sources: Partial<Record<StatementField, SourceKey>>
}

type YahooSummaryData = {
  currentPrice: number | null
  marketCap: number | null
  trailingPe: number | null
  priceToSales: number | null
  priceToBook: number | null
  dividendYieldPercent: number | null
  payoutRatioPercent: number | null
  beta: number | null
  sharesOutstanding: number | null
  analystPriceTargetMedian: number | null
  revenueTtm: number | null
  netIncomeTtm: number | null
  grossMarginPercent: number | null
  debtToEquity: number | null
  roePercent: number | null
  freeCashFlowTtm: number | null
}

type FinnhubQuoteData = {
  currentPrice: number | null
}

type FinnhubMetricData = {
  trailingPe: number | null
  priceToSales: number | null
  priceToBook: number | null
  dividendYieldPercent: number | null
  payoutRatioPercent: number | null
  beta: number | null
  sharesOutstanding: number | null
  epsGrowthPercent: number | null
  revenueTtm: number | null
  netIncomeTtm: number | null
  grossMarginPercent: number | null
  debtToEquity: number | null
  roePercent: number | null
  freeCashFlowTtm: number | null
}

type FinnhubPriceTargetData = {
  targetMedian: number | null
}

type DerivedResult = {
  value: number | null
  reason?: string
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
  currentLongTermDebt: number | null
  currentCurrentAssets: number | null
  currentCurrentLiabilities: number | null
  currentGrossProfit: number | null
  currentRevenue: number | null
  currentSharesDiluted: number | null
  priorNetIncome: number | null
  priorOperatingCashFlow: number | null
  priorTotalAssets: number | null
  priorLongTermDebt: number | null
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

function asText(input: unknown): string {
  if (input === null || input === undefined) return ""
  return String(input)
}

function fromRaw(input: unknown): unknown {
  if (input && typeof input === "object" && "raw" in input) {
    return (input as Record<string, unknown>).raw
  }
  return input
}

function toNumber(input: unknown): number | null {
  const value = fromRaw(input)
  if (typeof value === "number" && Number.isFinite(value)) return value
  const text = asText(value).replace(/,/g, "").trim()
  if (!text) return null
  const parsed = Number(text.replace(/[^0-9.-]/g, ""))
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function toPercent(input: unknown): number | null {
  const value = toNumber(input)
  if (value === null) return null
  if (Math.abs(value) <= 1) return Number((value * 100).toFixed(6))
  return value
}

function toIsoDate(input: unknown) {
  const raw = asText(input).trim()
  if (!raw) return new Date().toISOString()
  const numeric = Number(raw)
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric > 9_999_999_999 ? numeric : numeric * 1000
    return new Date(ms).toISOString()
  }
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return new Date().toISOString()
  return date.toISOString()
}

function hasNumber(input: unknown): input is number {
  return typeof input === "number" && Number.isFinite(input)
}

function rows(input: unknown): Record<string, unknown>[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => (item && typeof item === "object" ? [item as Record<string, unknown>] : []))
}

function firstResult(payload: unknown) {
  if (!payload || typeof payload !== "object") return {} as Record<string, unknown>
  const result = ((payload as Record<string, unknown>).quoteSummary as Record<string, unknown> | undefined)?.result
  return rows(result)[0] ?? {}
}

function emptyFetch(key: SourceKey, label: string, url: string, error: string): SourceFetch<Record<string, unknown>> {
  return {
    meta: {
      key,
      label,
      url,
      retrievedAt: new Date().toISOString(),
    },
    error,
  }
}

function sumNullableNumbers(values: Array<number | null>): number {
  return values.reduce<number>((acc, item) => acc + (item ?? 0), 0)
}

function compactCurrency(input: number | null) {
  if (!hasNumber(input)) return "unknown"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(input) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(input) >= 1_000_000 ? 2 : 2,
  }).format(input)
}

function compactNumber(input: number | null) {
  if (!hasNumber(input)) return "unknown"
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(input) >= 1_000 ? "compact" : "standard",
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
  return Number.isInteger(input) ? `${input}` : trimNumber(input)
}

function trimNumber(input: number, digits = 2) {
  return input.toFixed(digits).replace(/\.?0+$/, "")
}

function isoDate(input: string) {
  return toIsoDate(input).slice(0, 10)
}

function periodLabel(endDate: string, fiscalPeriod: string, fallback: "annual" | "quarterly") {
  const year = endDate.slice(0, 4) || "unknown"
  const period = fiscalPeriod.trim().toUpperCase()
  if (/^Q[1-4]$/.test(period)) return `${period} ${year}`
  if (period === "FY") return `FY ${year}`
  return fallback === "quarterly" ? `Q ${year}` : `FY ${year}`
}

function statementKey(period: Pick<StatementPeriod, "timeframe" | "endDate" | "fiscalPeriod">) {
  return `${period.timeframe}:${period.endDate}:${period.fiscalPeriod}`
}

async function credential(providerID: FinanceAuthProviderID): Promise<string | undefined> {
  const env = FINANCE_AUTH_PROVIDER[providerID].env.map((key) => Env.get(key)?.trim()).find(Boolean)
  if (env) return env
  const auth = await Auth.get(providerID)
  if (auth?.type === "api" || auth?.type === "wellknown") return auth.key
  return undefined
}

async function fetchJson<T>(input: {
  key: SourceKey
  label: string
  url: string
  headers?: Record<string, string>
  signal?: AbortSignal
}): Promise<SourceFetch<T>> {
  const { signal, clearTimeout } = abortAfterAny(DEFAULT_TIMEOUT_MS, ...(input.signal ? [input.signal] : []))
  try {
    const response = await fetch(input.url, {
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "opencode-finance/1.0",
        ...input.headers,
      },
    })
    clearTimeout()
    if (!response.ok) {
      const text = await response.text()
      return {
        meta: {
          key: input.key,
          label: input.label,
          url: input.url,
          retrievedAt: new Date().toISOString(),
        },
        error: `${response.status}: ${text || response.statusText}`,
      }
    }
    return {
      meta: {
        key: input.key,
        label: input.label,
        url: input.url,
        retrievedAt: new Date().toISOString(),
      },
      data: (await response.json()) as T,
    }
  } catch (error) {
    clearTimeout()
    return {
      meta: {
        key: input.key,
        label: input.label,
        url: input.url,
        retrievedAt: new Date().toISOString(),
      },
      error: normalizeErrorText(error),
    }
  }
}

function parseYahooSummary(payload: unknown): YahooSummaryData {
  const row = firstResult(payload)
  const financialData = (row.financialData as Record<string, unknown> | undefined) ?? {}
  const defaultKeyStatistics = (row.defaultKeyStatistics as Record<string, unknown> | undefined) ?? {}
  const summaryDetail = (row.summaryDetail as Record<string, unknown> | undefined) ?? {}
  const price = (row.price as Record<string, unknown> | undefined) ?? {}
  return {
    currentPrice: toNumber(price.regularMarketPrice),
    marketCap: toNumber(price.marketCap ?? summaryDetail.marketCap),
    trailingPe: toNumber(summaryDetail.trailingPE ?? defaultKeyStatistics.trailingPE),
    priceToSales: toNumber(summaryDetail.priceToSalesTrailing12Months ?? defaultKeyStatistics.priceToSalesTrailing12Months),
    priceToBook: toNumber(defaultKeyStatistics.priceToBook),
    dividendYieldPercent: toPercent(summaryDetail.dividendYield),
    payoutRatioPercent: toPercent(summaryDetail.payoutRatio),
    beta: toNumber(defaultKeyStatistics.beta ?? defaultKeyStatistics.beta3Year),
    sharesOutstanding: toNumber(defaultKeyStatistics.sharesOutstanding ?? price.sharesOutstanding),
    analystPriceTargetMedian: toNumber(financialData.targetMedianPrice),
    revenueTtm: toNumber(financialData.totalRevenue),
    netIncomeTtm: toNumber(financialData.netIncomeToCommon),
    grossMarginPercent: toPercent(financialData.grossMargins),
    debtToEquity: toNumber(financialData.debtToEquity),
    roePercent: toPercent(financialData.returnOnEquity),
    freeCashFlowTtm: toNumber(financialData.freeCashflow),
  }
}

function parseFinnhubQuote(payload: unknown): FinnhubQuoteData {
  const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  return {
    currentPrice: toNumber(row.c),
  }
}

function pickMetricValue(metric: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metric[key]
    const percent = /yield|ratio|margin|growth|roe|roa|roic|return/i.test(key) ? toPercent(value) : toNumber(value)
    if (percent !== null) return percent
  }
  return null
}

function parseFinnhubMetric(payload: unknown): FinnhubMetricData {
  const metric = payload && typeof payload === "object" ? (((payload as Record<string, unknown>).metric as Record<string, unknown> | undefined) ?? {}) : {}
  return {
    trailingPe: pickMetricValue(metric, ["peTTM", "peNormalizedTTM", "peNormalizedAnnual"]),
    priceToSales: pickMetricValue(metric, ["psTTM", "psAnnual"]),
    priceToBook: pickMetricValue(metric, ["pbQuarterly", "pbAnnual"]),
    dividendYieldPercent: pickMetricValue(metric, ["dividendYieldIndicatedAnnual", "currentDividendYieldTTM", "dividendYieldTTM"]),
    payoutRatioPercent: pickMetricValue(metric, ["payoutRatioTTM", "payoutRatioAnnual"]),
    beta: pickMetricValue(metric, ["beta"]),
    sharesOutstanding: pickMetricValue(metric, ["shareOutstanding", "sharesOutstanding"]),
    epsGrowthPercent: pickMetricValue(metric, [
      "epsGrowthTTMYoy",
      "epsGrowthQuarterlyYoy",
      "epsGrowthTTM",
      "epsGrowth3Y",
      "epsGrowth5Y",
    ]),
    revenueTtm: pickMetricValue(metric, ["ttmRevenue"]),
    netIncomeTtm: pickMetricValue(metric, ["netIncomeTTM", "netIncome"]),
    grossMarginPercent: pickMetricValue(metric, ["grossMarginTTM", "grossMargin"]),
    debtToEquity: pickMetricValue(metric, ["totalDebtToEquityQuarterly", "totalDebtToEquityAnnual"]),
    roePercent: pickMetricValue(metric, ["roeTTM", "roaeTTM"]),
    freeCashFlowTtm: pickMetricValue(metric, ["freeCashFlowTTM", "freeCashFlowAnnual"]),
  }
}

function parseFinnhubPriceTarget(payload: unknown): FinnhubPriceTargetData {
  const row = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  return {
    targetMedian: toNumber(row.targetMedian),
  }
}

function metricObjectValue(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key]
    if (value && typeof value === "object" && "value" in value) {
      const parsed = toNumber((value as Record<string, unknown>).value)
      if (parsed !== null) return parsed
    }
    const parsed = toNumber(value)
    if (parsed !== null) return parsed
  }
  return null
}

function statementBase(input: {
  timeframe: "annual" | "quarterly"
  endDate: string
  fiscalPeriod: string
  sourceKey: SourceKey
}) {
  return {
    timeframe: input.timeframe,
    endDate: isoDate(input.endDate || new Date().toISOString()),
    fiscalPeriod: input.fiscalPeriod || (input.timeframe === "annual" ? "FY" : ""),
    label: periodLabel(isoDate(input.endDate || new Date().toISOString()), input.fiscalPeriod, input.timeframe),
    revenue: null,
    netIncome: null,
    grossProfit: null,
    operatingIncome: null,
    pretaxIncome: null,
    incomeTaxExpense: null,
    operatingCashFlow: null,
    capex: null,
    freeCashFlow: null,
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
    sources: {} as Partial<Record<StatementField, SourceKey>>,
  } satisfies StatementPeriod
}

function setStatementValue(period: StatementPeriod, field: StatementField, value: number | null, sourceKey: SourceKey) {
  period[field] = value
  if (value !== null) {
    period.sources[field] = sourceKey
  }
}

function parsePolygonStatement(entry: Record<string, unknown>, timeframe: "annual" | "quarterly", sourceKey: SourceKey): StatementPeriod {
  const financials = entry.financials && typeof entry.financials === "object" ? (entry.financials as Record<string, unknown>) : {}
  const income = financials.income_statement && typeof financials.income_statement === "object"
    ? (financials.income_statement as Record<string, unknown>)
    : {}
  const balance = financials.balance_sheet && typeof financials.balance_sheet === "object"
    ? (financials.balance_sheet as Record<string, unknown>)
    : {}
  const cash = financials.cash_flow_statement && typeof financials.cash_flow_statement === "object"
    ? (financials.cash_flow_statement as Record<string, unknown>)
    : {}
  const period = statementBase({
    timeframe,
    endDate: asText(entry.end_date || entry.filing_date).trim(),
    fiscalPeriod: asText(entry.fiscal_period).trim().toUpperCase(),
    sourceKey,
  })

  setStatementValue(period, "revenue", metricObjectValue(income, ["revenues", "sales_revenue_net"]), sourceKey)
  setStatementValue(period, "netIncome", metricObjectValue(income, ["net_income_loss"]), sourceKey)
  setStatementValue(period, "grossProfit", metricObjectValue(income, ["gross_profit"]), sourceKey)
  setStatementValue(period, "operatingIncome", metricObjectValue(income, ["operating_income_loss", "operating_income"]), sourceKey)
  setStatementValue(
    period,
    "pretaxIncome",
    metricObjectValue(income, ["income_before_tax_expense_benefit", "pretax_income_loss", "income_before_tax"]),
    sourceKey,
  )
  setStatementValue(period, "incomeTaxExpense", metricObjectValue(income, ["income_tax_expense_benefit"]), sourceKey)
  setStatementValue(
    period,
    "operatingCashFlow",
    metricObjectValue(cash, [
      "net_cash_flow_from_operating_activities",
      "net_cash_flow_from_operating_activities_continuing",
      "net_cash_provided_by_used_in_operating_activities",
    ]),
    sourceKey,
  )
  setStatementValue(
    period,
    "capex",
    metricObjectValue(cash, ["capital_expenditure", "capital_expenditures", "payments_to_acquire_property_plant_and_equipment"]),
    sourceKey,
  )
  setStatementValue(
    period,
    "currentAssets",
    metricObjectValue(balance, ["current_assets", "assets_current"]),
    sourceKey,
  )
  setStatementValue(
    period,
    "currentLiabilities",
    metricObjectValue(balance, ["current_liabilities", "liabilities_current"]),
    sourceKey,
  )
  setStatementValue(period, "totalAssets", metricObjectValue(balance, ["assets"]), sourceKey)
  setStatementValue(period, "totalLiabilities", metricObjectValue(balance, ["liabilities"]), sourceKey)
  setStatementValue(
    period,
    "equity",
    metricObjectValue(balance, ["equity", "stockholders_equity", "stockholders_equity_including_portion_attributable_to_noncontrolling_interest"]),
    sourceKey,
  )
  setStatementValue(
    period,
    "cash",
    metricObjectValue(balance, [
      "cash_and_cash_equivalents_at_carrying_value",
      "cash_cash_equivalents_and_short_term_investments",
      "cash_and_short_term_investments",
    ]),
    sourceKey,
  )
  setStatementValue(
    period,
    "longTermDebt",
    metricObjectValue(balance, [
      "long_term_debt_noncurrent",
      "long_term_debt",
      "long_term_debt_and_capital_lease_obligations",
    ]),
    sourceKey,
  )
  setStatementValue(
    period,
    "currentDebt",
    metricObjectValue(balance, ["long_term_debt_current", "debt_current", "short_term_borrowings"]),
    sourceKey,
  )
  setStatementValue(
    period,
    "retainedEarnings",
    metricObjectValue(balance, ["retained_earnings", "retained_earnings_accumulated_deficit"]),
    sourceKey,
  )
  const dilutedShares =
    metricObjectValue(income, [
      "weighted_average_number_of_diluted_shares_outstanding",
      "weighted_average_number_of_share_outstanding_diluted",
    ]) ?? metricObjectValue(balance, ["common_stock_shares_outstanding"])
  const basicShares =
    metricObjectValue(income, [
      "weighted_average_number_of_shares_outstanding_basic",
      "weighted_average_number_of_share_outstanding_basic_and_diluted",
    ]) ?? metricObjectValue(balance, ["common_stock_shares_outstanding"])
  setStatementValue(period, "sharesDiluted", dilutedShares, sourceKey)
  setStatementValue(period, "sharesBasic", basicShares, sourceKey)

  const totalDebt = sumNullableNumbers([period.longTermDebt, period.currentDebt])
  if (totalDebt > 0) {
    setStatementValue(period, "totalDebt", totalDebt, sourceKey)
  }
  if (period.operatingCashFlow !== null) {
    const freeCashFlow = period.capex !== null ? period.operatingCashFlow - Math.abs(period.capex) : null
    if (freeCashFlow !== null) {
      setStatementValue(period, "freeCashFlow", freeCashFlow, sourceKey)
    }
  }
  if (period.incomeTaxExpense !== null && period.pretaxIncome !== null && period.pretaxIncome > 0) {
    setStatementValue(period, "effectiveTaxRatePercent", (period.incomeTaxExpense / period.pretaxIncome) * 100, sourceKey)
  }
  return period
}

function statementValue(rowsInput: Record<string, unknown>[], concepts: string[]) {
  if (!rowsInput.length) return null
  for (const concept of concepts) {
    const found = rowsInput.find((row) => asText(row.concept).toLowerCase() === concept.toLowerCase())
    const value = toNumber(found?.value)
    if (value !== null) return value
  }
  return null
}

function parseFinnhubStatement(entry: Record<string, unknown>, timeframe: "annual" | "quarterly", sourceKey: SourceKey): StatementPeriod {
  const report = entry.report && typeof entry.report === "object" ? (entry.report as Record<string, unknown>) : {}
  const income = rows(report.ic)
  const balance = rows(report.bs)
  const cash = rows(report.cf)
  const fiscalPeriod =
    timeframe === "quarterly" && hasNumber(toNumber(entry.quarter)) ? `Q${toNumber(entry.quarter)}` : "FY"
  const period = statementBase({
    timeframe,
    endDate: asText(entry.endDate || entry.filedDate || entry.acceptedDate).trim(),
    fiscalPeriod,
    sourceKey,
  })

  setStatementValue(
    period,
    "revenue",
    statementValue(income, [
      "us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax",
      "us-gaap_Revenues",
      "us-gaap_SalesRevenueNet",
    ]),
    sourceKey,
  )
  setStatementValue(period, "netIncome", statementValue(income, ["us-gaap_NetIncomeLoss"]), sourceKey)
  setStatementValue(period, "grossProfit", statementValue(income, ["us-gaap_GrossProfit"]), sourceKey)
  setStatementValue(period, "operatingIncome", statementValue(income, ["us-gaap_OperatingIncomeLoss"]), sourceKey)
  setStatementValue(period, "pretaxIncome", statementValue(income, ["us-gaap_IncomeBeforeTaxExpenseBenefit"]), sourceKey)
  setStatementValue(period, "incomeTaxExpense", statementValue(income, ["us-gaap_IncomeTaxExpenseBenefit"]), sourceKey)
  setStatementValue(
    period,
    "operatingCashFlow",
    statementValue(cash, ["us-gaap_NetCashProvidedByUsedInOperatingActivities"]),
    sourceKey,
  )
  setStatementValue(
    period,
    "capex",
    statementValue(cash, [
      "us-gaap_PaymentsToAcquirePropertyPlantAndEquipment",
      "us-gaap_PaymentsToAcquireProductiveAssets",
    ]),
    sourceKey,
  )
  setStatementValue(period, "currentAssets", statementValue(balance, ["us-gaap_AssetsCurrent"]), sourceKey)
  setStatementValue(period, "currentLiabilities", statementValue(balance, ["us-gaap_LiabilitiesCurrent"]), sourceKey)
  setStatementValue(period, "totalAssets", statementValue(balance, ["us-gaap_Assets"]), sourceKey)
  setStatementValue(period, "totalLiabilities", statementValue(balance, ["us-gaap_Liabilities"]), sourceKey)
  setStatementValue(
    period,
    "equity",
    statementValue(balance, [
      "us-gaap_StockholdersEquity",
      "us-gaap_StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ]),
    sourceKey,
  )
  setStatementValue(
    period,
    "cash",
    statementValue(balance, [
      "us-gaap_CashAndCashEquivalentsAtCarryingValue",
      "us-gaap_CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ]),
    sourceKey,
  )
  setStatementValue(period, "longTermDebt", statementValue(balance, ["us-gaap_LongTermDebtNoncurrent"]), sourceKey)
  setStatementValue(
    period,
    "currentDebt",
    statementValue(balance, ["us-gaap_LongTermDebtCurrent", "us-gaap_DebtCurrent", "us-gaap_ShortTermBorrowings"]),
    sourceKey,
  )
  setStatementValue(period, "retainedEarnings", statementValue(balance, ["us-gaap_RetainedEarningsAccumulatedDeficit"]), sourceKey)
  setStatementValue(
    period,
    "sharesDiluted",
    statementValue(income, [
      "us-gaap_WeightedAverageNumberOfDilutedSharesOutstanding",
      "us-gaap_CommonStockSharesOutstanding",
    ]),
    sourceKey,
  )
  setStatementValue(
    period,
    "sharesBasic",
    statementValue(income, [
      "us-gaap_WeightedAverageNumberOfSharesOutstandingBasic",
      "us-gaap_CommonStockSharesOutstanding",
    ]),
    sourceKey,
  )

  const totalDebt = sumNullableNumbers([period.longTermDebt, period.currentDebt])
  if (totalDebt > 0) {
    setStatementValue(period, "totalDebt", totalDebt, sourceKey)
  }
  if (period.operatingCashFlow !== null) {
    const freeCashFlow = period.capex !== null ? period.operatingCashFlow - Math.abs(period.capex) : null
    if (freeCashFlow !== null) {
      setStatementValue(period, "freeCashFlow", freeCashFlow, sourceKey)
    }
  }
  if (period.incomeTaxExpense !== null && period.pretaxIncome !== null && period.pretaxIncome > 0) {
    setStatementValue(period, "effectiveTaxRatePercent", (period.incomeTaxExpense / period.pretaxIncome) * 100, sourceKey)
  }
  return period
}

function sortPeriods(periods: StatementPeriod[]) {
  return [...periods].sort((left, right) => {
    if (left.endDate !== right.endDate) return left.endDate < right.endDate ? 1 : -1
    return left.fiscalPeriod < right.fiscalPeriod ? 1 : -1
  })
}

function mergePeriods(primary: StatementPeriod[], fallback: StatementPeriod[]) {
  const fallbackByKey = new Map(fallback.map((item) => [statementKey(item), item]))
  const merged = primary.map((item) => mergePeriod(item, fallbackByKey.get(statementKey(item))))
  const primaryKeys = new Set(primary.map((item) => statementKey(item)))
  fallback.forEach((item) => {
    if (primaryKeys.has(statementKey(item))) return
    merged.push(item)
  })
  return sortPeriods(merged)
}

function mergePeriod(primary: StatementPeriod, fallback?: StatementPeriod): StatementPeriod {
  if (!fallback) return primary
  const merged = {
    ...primary,
    sources: { ...primary.sources },
  }
  const fields: StatementField[] = [
    "revenue",
    "netIncome",
    "grossProfit",
    "operatingIncome",
    "pretaxIncome",
    "incomeTaxExpense",
    "operatingCashFlow",
    "capex",
    "freeCashFlow",
    "currentAssets",
    "currentLiabilities",
    "totalAssets",
    "totalLiabilities",
    "equity",
    "cash",
    "longTermDebt",
    "currentDebt",
    "totalDebt",
    "retainedEarnings",
    "sharesBasic",
    "sharesDiluted",
    "effectiveTaxRatePercent",
  ]
  fields.forEach((field) => {
    if (merged[field] !== null) return
    merged[field] = fallback[field]
    if (fallback[field] !== null && fallback.sources[field]) {
      merged.sources[field] = fallback.sources[field]
    }
  })
  return merged
}

function fieldSources(periods: StatementPeriod[], fields: StatementField[]) {
  const out: SourceKey[] = []
  periods.forEach((period) => {
    fields.forEach((field) => {
      const key = period.sources[field]
      if (!key || out.includes(key)) return
      out.push(key)
    })
  })
  return out
}

function latestValue<T>(values: (T | null | undefined)[]) {
  for (const value of values) {
    if (value !== null && value !== undefined) return value
  }
  return null
}

function currentAnnualDebt(period: StatementPeriod | undefined) {
  if (!period) return null
  return latestValue([period.totalDebt, period.longTermDebt])
}

function trailingFourSum(periods: StatementPeriod[], field: StatementField) {
  const slice = periods.slice(0, 4)
  if (slice.length < 4) return null
  const values = slice.map((item) => item[field])
  if (values.some((item) => item === null)) return null
  return sumNullableNumbers(values)
}

function priorFourSum(periods: StatementPeriod[], field: StatementField) {
  const slice = periods.slice(4, 8)
  if (slice.length < 4) return null
  const values = slice.map((item) => item[field])
  if (values.some((item) => item === null)) return null
  return sumNullableNumbers(values)
}

function revenueGrowthPercent(periods: StatementPeriod[]): DerivedResult {
  const current = trailingFourSum(periods, "revenue")
  const prior = priorFourSum(periods, "revenue")
  if (current === null || prior === null || prior === 0) {
    return { value: null, reason: "requires eight quarters of revenue history" }
  }
  return {
    value: ((current - prior) / prior) * 100,
  }
}

function deriveMarketCap(currentPrice: number | null, sharesOutstanding: number | null): DerivedResult {
  if (currentPrice === null || sharesOutstanding === null) {
    return { value: null, reason: "requires current price and shares outstanding" }
  }
  return {
    value: currentPrice * sharesOutstanding,
  }
}

function calculateDcfPerShare(input: DcfInput): DerivedResult {
  if (input.ttmFreeCashFlow === null || input.ttmFreeCashFlow <= 0) {
    return { value: null, reason: "requires positive TTM free cash flow" }
  }
  if (input.revenueGrowthPercent === null) {
    return { value: null, reason: "requires trailing four-quarter revenue growth" }
  }
  if (input.cash === null || input.totalDebt === null) {
    return { value: null, reason: "requires cash and total debt" }
  }
  if (input.sharesOutstanding === null || input.sharesOutstanding <= 0) {
    return { value: null, reason: "requires shares outstanding" }
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

function calculatePegy(input: {
  trailingPe: number | null
  epsGrowthPercent: number | null
  dividendYieldPercent: number | null
}): DerivedResult {
  if (input.trailingPe === null || input.trailingPe <= 0) {
    return { value: null, reason: "requires positive trailing P/E" }
  }
  if (input.epsGrowthPercent === null) {
    return { value: null, reason: "requires Finnhub EPS growth" }
  }
  const denominator = input.epsGrowthPercent + (input.dividendYieldPercent ?? 0)
  if (denominator <= 0) {
    return { value: null, reason: "requires positive EPS growth plus dividend yield" }
  }
  return {
    value: input.trailingPe / denominator,
  }
}

function calculateFcfYield(freeCashFlow: number | null, marketCap: number | null): DerivedResult {
  if (freeCashFlow === null || marketCap === null || marketCap === 0) {
    return { value: null, reason: "requires market cap and free cash flow" }
  }
  return {
    value: (freeCashFlow / marketCap) * 100,
  }
}

function calculatePriceToFcf(marketCap: number | null, freeCashFlow: number | null): DerivedResult {
  if (marketCap === null || freeCashFlow === null || freeCashFlow === 0) {
    return { value: null, reason: "requires market cap and non-zero free cash flow" }
  }
  return {
    value: marketCap / freeCashFlow,
  }
}

function calculateRuleOf40(input: {
  revenueGrowthPercent: number | null
  ttmRevenue: number | null
  ttmFreeCashFlow: number | null
}): DerivedResult {
  if (input.revenueGrowthPercent === null) {
    return { value: null, reason: "requires trailing four-quarter revenue growth" }
  }
  if (input.ttmRevenue === null || input.ttmRevenue === 0 || input.ttmFreeCashFlow === null) {
    return { value: null, reason: "requires TTM revenue and TTM free cash flow" }
  }
  const margin = (input.ttmFreeCashFlow / input.ttmRevenue) * 100
  return {
    value: input.revenueGrowthPercent + margin,
  }
}

function calculateSustainableGrowthRate(roePercent: number | null, payoutRatioPercent: number | null): DerivedResult {
  if (roePercent === null || payoutRatioPercent === null) {
    return { value: null, reason: "requires ROE and payout ratio" }
  }
  return {
    value: roePercent * (1 - payoutRatioPercent / 100),
  }
}

function calculateRoic(input: RoicInput): DerivedResult {
  if (input.operatingIncome === null) {
    return { value: null, reason: "requires operating income" }
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
  const taxRate = (input.effectiveTaxRatePercent ?? FALLBACK_TAX_RATE) / 100
  const nopat = input.operatingIncome * (1 - taxRate)
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

function calculatePiotroskiFScore(input: PiotroskiInput): DerivedResult {
  const required = [
    input.currentNetIncome,
    input.currentOperatingCashFlow,
    input.currentTotalAssets,
    input.currentLongTermDebt,
    input.currentCurrentAssets,
    input.currentCurrentLiabilities,
    input.currentGrossProfit,
    input.currentRevenue,
    input.currentSharesDiluted,
    input.priorNetIncome,
    input.priorOperatingCashFlow,
    input.priorTotalAssets,
    input.priorLongTermDebt,
    input.priorCurrentAssets,
    input.priorCurrentLiabilities,
    input.priorGrossProfit,
    input.priorRevenue,
    input.priorSharesDiluted,
  ]
  if (required.some((item) => item === null)) {
    return { value: null, reason: "requires current and prior annual statement coverage" }
  }

  const currentAssetsAverage = ((input.currentTotalAssets as number) + (input.priorTotalAssets as number)) / 2
  const priorRoa = (input.priorNetIncome as number) / (input.priorTotalAssets as number)
  const currentRoa = (input.currentNetIncome as number) / currentAssetsAverage
  const accrual = (input.currentOperatingCashFlow as number) > (input.currentNetIncome as number)
  const leverageImprovement =
    (input.currentLongTermDebt as number) / (input.currentTotalAssets as number) <
    (input.priorLongTermDebt as number) / (input.priorTotalAssets as number)
  const currentRatioImprovement =
    (input.currentCurrentAssets as number) / (input.currentCurrentLiabilities as number) >
    (input.priorCurrentAssets as number) / (input.priorCurrentLiabilities as number)
  const noDilution = (input.currentSharesDiluted as number) <= (input.priorSharesDiluted as number)
  const grossMarginImprovement =
    (input.currentGrossProfit as number) / (input.currentRevenue as number) >
    (input.priorGrossProfit as number) / (input.priorRevenue as number)
  const assetTurnoverImprovement =
    (input.currentRevenue as number) / currentAssetsAverage >
    (input.priorRevenue as number) / (input.priorTotalAssets as number)

  const score = [
    currentRoa > 0,
    (input.currentOperatingCashFlow as number) > 0,
    currentRoa > priorRoa,
    accrual,
    leverageImprovement,
    currentRatioImprovement,
    noDilution,
    grossMarginImprovement,
    assetTurnoverImprovement,
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
    return { value: null, reason: "requires working capital, retained earnings, EBIT, assets, liabilities, and equity" }
  }
  if (input.totalAssets <= 0 || input.totalLiabilities <= 0) {
    return { value: null, reason: "requires positive total assets and total liabilities" }
  }
  const score =
    6.56 * (input.workingCapital / input.totalAssets) +
    3.26 * (input.retainedEarnings / input.totalAssets) +
    6.72 * (input.ebit / input.totalAssets) +
    1.05 * (input.equity / input.totalLiabilities)
  return {
    value: score,
  }
}

function sourceSummary(sourceMap: Map<SourceKey, SourceMeta>, keys: SourceKey[]) {
  const items = Array.from(new Set(keys)).flatMap((key) => {
    const meta = sourceMap.get(key)
    return meta ? [meta] : []
  })
  if (!items.length) {
    return {
      source: "unknown",
      source_url: "unknown",
      retrieved_at: "unknown",
    }
  }
  return {
    source: items.map((item) => item.label).join(" + "),
    source_url: items.map((item) => item.url).join(" | "),
    retrieved_at: items.map((item) => item.retrievedAt).sort((left, right) => (left > right ? -1 : 1))[0] ?? "unknown",
  }
}

function firstAvailable(candidates: Array<{ value: number | null; key: SourceKey }>) {
  for (const candidate of candidates) {
    if (candidate.value === null) continue
    return candidate
  }
  return
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

export async function buildReportEvaluationSnapshot(input: {
  ticker: string
  signal?: AbortSignal
}): Promise<ReportEvaluationSnapshot> {
  const ticker = normalizeTicker(input.ticker)
  if (!ticker) throw new Error("ticker must include at least one valid symbol character")

  const [finnhubKey, polygonKey] = await Promise.all([credential("finnhub"), credential("polygon")])
  const sourceMap = new Map<SourceKey, SourceMeta>()
  const errors: string[] = []

  const yahooModules = encodeURIComponent("financialData,defaultKeyStatistics,summaryDetail,price")
  const yahooUrl = `${YAHOO_BASE}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${yahooModules}`
  const requests = await Promise.all([
    fetchJson<Record<string, unknown>>({
      key: "yahoo_summary",
      label: "Yahoo Finance",
      url: yahooUrl,
      signal: input.signal,
    }),
    finnhubKey
      ? fetchJson<Record<string, unknown>>({
          key: "finnhub_quote",
          label: "Finnhub",
          url: `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(finnhubKey)}`,
          signal: input.signal,
        })
      : Promise.resolve(
          emptyFetch("finnhub_quote", "Finnhub", `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(ticker)}`, "missing credential"),
        ),
    finnhubKey
      ? fetchJson<Record<string, unknown>>({
          key: "finnhub_metric",
          label: "Finnhub",
          url: `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${encodeURIComponent(finnhubKey)}`,
          signal: input.signal,
        })
      : Promise.resolve(
          emptyFetch(
            "finnhub_metric",
            "Finnhub",
            `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all`,
            "missing credential",
          ),
        ),
    finnhubKey
      ? fetchJson<Record<string, unknown>>({
          key: "finnhub_price_target",
          label: "Finnhub",
          url: `${FINNHUB_BASE}/stock/price-target?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(finnhubKey)}`,
          signal: input.signal,
        })
      : Promise.resolve(
          emptyFetch(
            "finnhub_price_target",
            "Finnhub",
            `${FINNHUB_BASE}/stock/price-target?symbol=${encodeURIComponent(ticker)}`,
            "missing credential",
          ),
        ),
    polygonKey
      ? fetchJson<Record<string, unknown>>({
          key: "polygon_annual",
          label: "Polygon",
          url: `${POLYGON_BASE}/vX/reference/financials?ticker=${encodeURIComponent(ticker)}&timeframe=annual&limit=2&apiKey=${encodeURIComponent(polygonKey)}`,
          signal: input.signal,
        })
      : Promise.resolve(
          emptyFetch(
            "polygon_annual",
            "Polygon",
            `${POLYGON_BASE}/vX/reference/financials?ticker=${encodeURIComponent(ticker)}&timeframe=annual&limit=2`,
            "missing credential",
          ),
        ),
    polygonKey
      ? fetchJson<Record<string, unknown>>({
          key: "polygon_quarterly",
          label: "Polygon",
          url: `${POLYGON_BASE}/vX/reference/financials?ticker=${encodeURIComponent(ticker)}&timeframe=quarterly&limit=8&apiKey=${encodeURIComponent(polygonKey)}`,
          signal: input.signal,
        })
      : Promise.resolve(
          emptyFetch(
            "polygon_quarterly",
            "Polygon",
            `${POLYGON_BASE}/vX/reference/financials?ticker=${encodeURIComponent(ticker)}&timeframe=quarterly&limit=8`,
            "missing credential",
          ),
        ),
    finnhubKey
      ? fetchJson<Record<string, unknown>>({
          key: "finnhub_annual",
          label: "Finnhub",
          url: `${FINNHUB_BASE}/stock/financials-reported?symbol=${encodeURIComponent(ticker)}&freq=annual&token=${encodeURIComponent(finnhubKey)}`,
          signal: input.signal,
        })
      : Promise.resolve(
          emptyFetch(
            "finnhub_annual",
            "Finnhub",
            `${FINNHUB_BASE}/stock/financials-reported?symbol=${encodeURIComponent(ticker)}&freq=annual`,
            "missing credential",
          ),
        ),
    finnhubKey
      ? fetchJson<Record<string, unknown>>({
          key: "finnhub_quarterly",
          label: "Finnhub",
          url: `${FINNHUB_BASE}/stock/financials-reported?symbol=${encodeURIComponent(ticker)}&freq=quarterly&token=${encodeURIComponent(finnhubKey)}`,
          signal: input.signal,
        })
      : Promise.resolve(
          emptyFetch(
            "finnhub_quarterly",
            "Finnhub",
            `${FINNHUB_BASE}/stock/financials-reported?symbol=${encodeURIComponent(ticker)}&freq=quarterly`,
            "missing credential",
          ),
        ),
  ])

  requests.forEach((item) => {
    sourceMap.set(item.meta.key, item.meta)
    if (item.error) {
      errors.push(`${item.meta.label} (${item.meta.key}): ${item.error}`)
    }
  })

  const [yahooRaw, finnhubQuoteRaw, finnhubMetricRaw, finnhubTargetRaw, polygonAnnualRaw, polygonQuarterlyRaw, finnhubAnnualRaw, finnhubQuarterlyRaw] =
    requests

  const yahoo = yahooRaw.data ? parseYahooSummary(yahooRaw.data) : parseYahooSummary({})
  const finnhubQuote = finnhubQuoteRaw.data ? parseFinnhubQuote(finnhubQuoteRaw.data) : parseFinnhubQuote({})
  const finnhubMetric = finnhubMetricRaw.data ? parseFinnhubMetric(finnhubMetricRaw.data) : parseFinnhubMetric({})
  const finnhubTarget = finnhubTargetRaw.data ? parseFinnhubPriceTarget(finnhubTargetRaw.data) : parseFinnhubPriceTarget({})

  const polygonAnnual = rows(polygonAnnualRaw.data?.results).map((item) => parsePolygonStatement(item, "annual", "polygon_annual"))
  const polygonQuarterly = rows(polygonQuarterlyRaw.data?.results).map((item) =>
    parsePolygonStatement(item, "quarterly", "polygon_quarterly"),
  )
  const finnhubAnnual = rows(finnhubAnnualRaw.data?.data).map((item) => parseFinnhubStatement(item, "annual", "finnhub_annual"))
  const finnhubQuarterly = rows(finnhubQuarterlyRaw.data?.data).map((item) =>
    parseFinnhubStatement(item, "quarterly", "finnhub_quarterly"),
  )

  const annual = mergePeriods(sortPeriods(polygonAnnual), sortPeriods(finnhubAnnual))
  const quarterly = mergePeriods(sortPeriods(polygonQuarterly), sortPeriods(finnhubQuarterly))

  const currentAnnual = annual[0]
  const priorAnnual = annual[1]
  const latestQuarterly = quarterly.slice(0, 4)
  const quarterlyAscending = [...latestQuarterly].reverse()

  const revenueGrowth = revenueGrowthPercent(quarterly)
  const ttmRevenue = latestValue([
    yahoo.revenueTtm,
    finnhubMetric.revenueTtm,
    trailingFourSum(quarterly, "revenue"),
  ])
  const ttmNetIncome = latestValue([
    yahoo.netIncomeTtm,
    finnhubMetric.netIncomeTtm,
    trailingFourSum(quarterly, "netIncome"),
  ])
  const ttmFreeCashFlow = latestValue([
    yahoo.freeCashFlowTtm,
    finnhubMetric.freeCashFlowTtm,
    trailingFourSum(quarterly, "freeCashFlow"),
  ])
  const ttmGrossProfit = trailingFourSum(quarterly, "grossProfit")
  const currentPriceObserved = firstAvailable([
    { value: yahoo.currentPrice, key: "yahoo_summary" as const },
    { value: finnhubQuote.currentPrice, key: "finnhub_quote" as const },
  ])
  const currentPrice = currentPriceObserved?.value ?? null
  const sharesObserved = firstAvailable([
    { value: yahoo.sharesOutstanding, key: "yahoo_summary" as const },
    { value: finnhubMetric.sharesOutstanding, key: "finnhub_metric" as const },
    { value: currentAnnual?.sharesDiluted ?? null, key: currentAnnual?.sources.sharesDiluted ?? "polygon_annual" },
  ])
  const marketCapDirect = firstAvailable([{ value: yahoo.marketCap, key: "yahoo_summary" as const }])
  const marketCapDerived = deriveMarketCap(currentPrice, sharesObserved?.value ?? null)
  const marketCap = marketCapDirect?.value ?? marketCapDerived.value
  const marketCapKeys = marketCapDirect ? [marketCapDirect.key] : sourceKeysFromMaybe([currentPriceObserved?.key, sharesObserved?.key])

  const dcf = calculateDcfPerShare({
    ttmFreeCashFlow,
    revenueGrowthPercent: revenueGrowth.value,
    cash: currentAnnual?.cash ?? null,
    totalDebt: currentAnnualDebt(currentAnnual),
    sharesOutstanding: sharesObserved?.value ?? null,
  })
  const priceTarget = firstAvailable([
    { value: finnhubTarget.targetMedian, key: "finnhub_price_target" as const },
    { value: yahoo.analystPriceTargetMedian, key: "yahoo_summary" as const },
  ])
  const trailingPeDirect = firstAvailable([
    { value: yahoo.trailingPe, key: "yahoo_summary" as const },
    { value: finnhubMetric.trailingPe, key: "finnhub_metric" as const },
  ])
  const trailingPeDerived =
    !trailingPeDirect && marketCap !== null && ttmNetIncome !== null && ttmNetIncome > 0
      ? { value: marketCap / ttmNetIncome, key: "polygon_quarterly" as const }
      : undefined
  const trailingPe = trailingPeDirect?.value ?? trailingPeDerived?.value ?? null
  const trailingPeKeys = trailingPeDirect ? [trailingPeDirect.key] : sourceKeysFromMaybe([...marketCapKeys, ...fieldSources(quarterly.slice(0, 4), ["netIncome"])])

  const pegy = calculatePegy({
    trailingPe,
    epsGrowthPercent: finnhubMetric.epsGrowthPercent,
    dividendYieldPercent: yahoo.dividendYieldPercent ?? finnhubMetric.dividendYieldPercent,
  })
  const priceToSalesDirect = firstAvailable([
    { value: yahoo.priceToSales, key: "yahoo_summary" as const },
    { value: finnhubMetric.priceToSales, key: "finnhub_metric" as const },
  ])
  const priceToSalesDerived =
    !priceToSalesDirect && marketCap !== null && ttmRevenue !== null && ttmRevenue > 0 ? marketCap / ttmRevenue : null
  const priceToSales = priceToSalesDirect?.value ?? priceToSalesDerived
  const priceToBookDirect = firstAvailable([
    { value: yahoo.priceToBook, key: "yahoo_summary" as const },
    { value: finnhubMetric.priceToBook, key: "finnhub_metric" as const },
  ])
  const priceToBookDerived =
    !priceToBookDirect && marketCap !== null && currentAnnual?.equity !== null && currentAnnual.equity > 0
      ? marketCap / currentAnnual.equity
      : null
  const priceToBook = priceToBookDirect?.value ?? priceToBookDerived
  const dividendYield = latestValue([yahoo.dividendYieldPercent, finnhubMetric.dividendYieldPercent])
  const payoutRatio = latestValue([yahoo.payoutRatioPercent, finnhubMetric.payoutRatioPercent])
  const fcfYield = calculateFcfYield(ttmFreeCashFlow, marketCap)
  const priceToFcf = calculatePriceToFcf(marketCap, ttmFreeCashFlow)
  const piotroski = currentAnnual && priorAnnual
    ? calculatePiotroskiFScore({
        currentNetIncome: currentAnnual.netIncome,
        currentOperatingCashFlow: currentAnnual.operatingCashFlow,
        currentTotalAssets: currentAnnual.totalAssets,
        currentLongTermDebt: currentAnnualDebt(currentAnnual),
        currentCurrentAssets: currentAnnual.currentAssets,
        currentCurrentLiabilities: currentAnnual.currentLiabilities,
        currentGrossProfit: currentAnnual.grossProfit,
        currentRevenue: currentAnnual.revenue,
        currentSharesDiluted: latestValue([currentAnnual.sharesDiluted, currentAnnual.sharesBasic]),
        priorNetIncome: priorAnnual.netIncome,
        priorOperatingCashFlow: priorAnnual.operatingCashFlow,
        priorTotalAssets: priorAnnual.totalAssets,
        priorLongTermDebt: currentAnnualDebt(priorAnnual),
        priorCurrentAssets: priorAnnual.currentAssets,
        priorCurrentLiabilities: priorAnnual.currentLiabilities,
        priorGrossProfit: priorAnnual.grossProfit,
        priorRevenue: priorAnnual.revenue,
        priorSharesDiluted: latestValue([priorAnnual.sharesDiluted, priorAnnual.sharesBasic]),
      })
    : { value: null, reason: "requires two annual statement periods" }
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
  const roic = currentAnnual && priorAnnual
    ? calculateRoic({
        operatingIncome: currentAnnual.operatingIncome,
        effectiveTaxRatePercent: currentAnnual.effectiveTaxRatePercent,
        currentDebt: currentAnnualDebt(currentAnnual),
        currentEquity: currentAnnual.equity,
        currentCash: currentAnnual.cash,
        priorDebt: currentAnnualDebt(priorAnnual),
        priorEquity: priorAnnual.equity,
        priorCash: priorAnnual.cash,
      })
    : { value: null, reason: "requires current and prior annual statement periods" }
  const roeDirect = firstAvailable([
    { value: yahoo.roePercent, key: "yahoo_summary" as const },
    { value: finnhubMetric.roePercent, key: "finnhub_metric" as const },
  ])
  const roeDerived =
    !roeDirect && ttmNetIncome !== null && currentAnnual?.equity !== null && priorAnnual?.equity !== null
      ? (ttmNetIncome / ((currentAnnual.equity + priorAnnual.equity) / 2)) * 100
      : null
  const roe = roeDirect?.value ?? roeDerived
  const debtToEquityDirect = firstAvailable([
    { value: yahoo.debtToEquity, key: "yahoo_summary" as const },
    { value: finnhubMetric.debtToEquity, key: "finnhub_metric" as const },
  ])
  const debtToEquityDerived =
    !debtToEquityDirect && currentAnnual?.equity !== null && currentAnnual.equity !== 0 && currentAnnualDebt(currentAnnual) !== null
      ? (currentAnnualDebt(currentAnnual) as number) / currentAnnual.equity
      : null
  const debtToEquity = debtToEquityDirect?.value ?? debtToEquityDerived
  const ruleOf40 = calculateRuleOf40({
    revenueGrowthPercent: revenueGrowth.value,
    ttmRevenue,
    ttmFreeCashFlow,
  })
  const grossMarginDirect = firstAvailable([
    { value: yahoo.grossMarginPercent, key: "yahoo_summary" as const },
    { value: finnhubMetric.grossMarginPercent, key: "finnhub_metric" as const },
  ])
  const grossMarginDerived = !grossMarginDirect && ttmGrossProfit !== null && ttmRevenue !== null && ttmRevenue !== 0
    ? (ttmGrossProfit / ttmRevenue) * 100
    : null
  const grossMargin = grossMarginDirect?.value ?? grossMarginDerived
  const sustainableGrowth = calculateSustainableGrowthRate(roe, payoutRatio)
  const beta = latestValue([yahoo.beta, finnhubMetric.beta])

  const unknowns = [...errors]

  const fairness: EvaluationMetric[] = [
    metricRecord({
      key: "dcf",
      label: "DCF",
      category: "fairness",
      value: dcf.value,
      basis: "modeled",
      format: moneyPerShare,
      sourceKeys: sourceKeysFromMaybe([
        ...fieldSources(quarterly.slice(0, 8), ["revenue", "freeCashFlow"]),
        ...fieldSources(annual.slice(0, 1), ["cash", "totalDebt"]),
        sharesObserved?.key,
      ]),
      sourceMap,
      formula: "TTM FCF grown for 5 years using clamped trailing 4Q revenue growth; discounted at 10%; terminal growth 2.5%",
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
      value: priceTarget?.value ?? null,
      basis: "reported",
      format: moneyPerShare,
      sourceKeys: sourceKeysFromMaybe([priceTarget?.key]),
      sourceMap,
      notes: ["Observed analyst consensus target median"],
    }),
    metricRecord({
      key: "pegy",
      label: "PEGY Ratio",
      category: "fairness",
      value: pegy.value,
      basis: "derived",
      format: decimalText,
      sourceKeys: sourceKeysFromMaybe([...trailingPeKeys, "finnhub_metric", "yahoo_summary"]),
      sourceMap,
      formula: "trailing_pe / (eps_growth_percent + dividend_yield_percent)",
      notes: pegy.reason ? [pegy.reason] : undefined,
    }),
    metricRecord({
      key: "price_to_earnings",
      label: "Price-to-Earnings",
      category: "fairness",
      value: trailingPe,
      basis: trailingPeDirect ? "reported" : "derived",
      format: ratioText,
      sourceKeys: trailingPeDirect ? [trailingPeDirect.key] : trailingPeKeys,
      sourceMap,
      formula: trailingPeDirect ? undefined : "market_cap / ttm_net_income",
      notes:
        !trailingPeDirect && trailingPe === null
          ? ["requires observed P/E or positive TTM net income and market cap"]
          : undefined,
    }),
    metricRecord({
      key: "price_to_sales",
      label: "Price-to-Sales",
      category: "fairness",
      value: priceToSales,
      basis: priceToSalesDirect ? "reported" : "derived",
      format: ratioText,
      sourceKeys: priceToSalesDirect ? [priceToSalesDirect.key] : sourceKeysFromMaybe([...marketCapKeys, ...fieldSources(quarterly.slice(0, 4), ["revenue"])]),
      sourceMap,
      formula: priceToSalesDirect ? undefined : "market_cap / ttm_revenue",
      notes:
        !priceToSalesDirect && priceToSales === null
          ? ["requires observed P/S or positive TTM revenue and market cap"]
          : undefined,
    }),
    metricRecord({
      key: "price_to_book",
      label: "Price-to-Book",
      category: "fairness",
      value: priceToBook,
      basis: priceToBookDirect ? "reported" : "derived",
      format: ratioText,
      sourceKeys: priceToBookDirect ? [priceToBookDirect.key] : sourceKeysFromMaybe([...marketCapKeys, ...fieldSources(annual.slice(0, 1), ["equity"])]),
      sourceMap,
      formula: priceToBookDirect ? undefined : "market_cap / latest_equity",
      notes:
        !priceToBookDirect && priceToBook === null
          ? ["requires observed P/B or positive equity and market cap"]
          : undefined,
    }),
    metricRecord({
      key: "fcf_yield",
      label: "Free Cash Flow Yield",
      category: "fairness",
      value: fcfYield.value,
      basis: "derived",
      format: percentText,
      sourceKeys: sourceKeysFromMaybe([...marketCapKeys, ...fieldSources(quarterly.slice(0, 4), ["freeCashFlow"])]),
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
      sourceKeys: sourceKeysFromMaybe([...marketCapKeys, ...fieldSources(quarterly.slice(0, 4), ["freeCashFlow"])]),
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
      sourceKeys: fieldSources(annual.slice(0, 2), [
        "netIncome",
        "operatingCashFlow",
        "totalAssets",
        "longTermDebt",
        "totalDebt",
        "currentAssets",
        "currentLiabilities",
        "grossProfit",
        "revenue",
        "sharesDiluted",
        "sharesBasic",
      ]),
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
      sourceKeys: fieldSources(annual.slice(0, 1), [
        "currentAssets",
        "currentLiabilities",
        "retainedEarnings",
        "operatingIncome",
        "equity",
        "totalAssets",
        "totalLiabilities",
      ]),
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
      sourceKeys: fieldSources(annual.slice(0, 2), ["operatingIncome", "effectiveTaxRatePercent", "totalDebt", "longTermDebt", "equity", "cash"]),
      sourceMap,
      formula: "NOPAT / average invested capital",
      notes: [
        `Fallback tax rate ${trimNumber(FALLBACK_TAX_RATE)}% when observed effective tax rate is unavailable`,
        ...(roic.reason ? [roic.reason] : []),
      ],
    }),
    metricRecord({
      key: "roe",
      label: "Return on Equity",
      category: "quality",
      value: roe,
      basis: roeDirect ? "reported" : "derived",
      format: percentText,
      sourceKeys: roeDirect ? [roeDirect.key] : sourceKeysFromMaybe([...fieldSources(annual.slice(0, 2), ["equity"]), ...fieldSources(quarterly.slice(0, 4), ["netIncome"])]),
      sourceMap,
      formula: roeDirect ? undefined : "ttm_net_income / average_equity",
      notes: !roeDirect && roe === null ? ["requires observed ROE or TTM net income plus average equity"] : undefined,
    }),
    metricRecord({
      key: "debt_to_equity",
      label: "Debt to Equity",
      category: "quality",
      value: debtToEquity,
      basis: debtToEquityDirect ? "reported" : "derived",
      format: ratioText,
      sourceKeys: debtToEquityDirect ? [debtToEquityDirect.key] : fieldSources(annual.slice(0, 1), ["totalDebt", "longTermDebt", "equity"]),
      sourceMap,
      formula: debtToEquityDirect ? undefined : "latest_total_debt / latest_equity",
      notes: !debtToEquityDirect && debtToEquity === null ? ["requires observed debt-to-equity or latest debt and equity"] : undefined,
    }),
    metricRecord({
      key: "rule_of_40",
      label: "Rule of 40",
      category: "quality",
      value: ruleOf40.value,
      basis: "derived",
      format: percentText,
      sourceKeys: sourceKeysFromMaybe([...fieldSources(quarterly.slice(0, 8), ["revenue", "freeCashFlow"])]),
      sourceMap,
      formula: "trailing_4q_revenue_growth_percent + ttm_free_cash_flow_margin_percent",
      notes: ruleOf40.reason ? [ruleOf40.reason] : undefined,
    }),
    metricRecord({
      key: "gross_profit_margin_ttm",
      label: "Gross Profit Margin TTM",
      category: "quality",
      value: grossMargin,
      basis: grossMarginDirect ? "reported" : "derived",
      format: percentText,
      sourceKeys: grossMarginDirect ? [grossMarginDirect.key] : fieldSources(quarterly.slice(0, 4), ["grossProfit", "revenue"]),
      sourceMap,
      formula: grossMarginDirect ? undefined : "ttm_gross_profit / ttm_revenue",
      notes: !grossMarginDirect && grossMargin === null ? ["requires observed margin or TTM gross profit and revenue"] : undefined,
    }),
    metricRecord({
      key: "sustainable_growth_rate_ttm",
      label: "Sustainable Growth Rate TTM",
      category: "quality",
      value: sustainableGrowth.value,
      basis: "derived",
      format: percentText,
      sourceKeys: sourceKeysFromMaybe([
        ...(roeDirect ? [roeDirect.key] : fieldSources(annual.slice(0, 2), ["equity"])),
        "yahoo_summary",
        "finnhub_metric",
      ]),
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
      value: payoutRatio,
      basis: latestValue([yahoo.payoutRatioPercent, finnhubMetric.payoutRatioPercent]) !== null ? "reported" : "derived",
      format: percentText,
      sourceKeys: sourceKeysFromMaybe([
        yahoo.payoutRatioPercent !== null ? "yahoo_summary" : undefined,
        finnhubMetric.payoutRatioPercent !== null ? "finnhub_metric" : undefined,
      ]),
      sourceMap,
      notes: payoutRatio === null ? ["requires observed payout ratio"] : undefined,
    }),
    metricRecord({
      key: "dividend_yield",
      label: "Dividend Yield",
      category: "dividend",
      value: dividendYield,
      basis: latestValue([yahoo.dividendYieldPercent, finnhubMetric.dividendYieldPercent]) !== null ? "reported" : "derived",
      format: percentText,
      sourceKeys: sourceKeysFromMaybe([
        yahoo.dividendYieldPercent !== null ? "yahoo_summary" : undefined,
        finnhubMetric.dividendYieldPercent !== null ? "finnhub_metric" : undefined,
      ]),
      sourceMap,
      notes: dividendYield === null ? ["requires observed dividend yield"] : undefined,
    }),
  ]

  const stability: EvaluationMetric[] = [
    metricRecord({
      key: "beta",
      label: "Beta",
      category: "stability",
      value: beta,
      basis: "reported",
      format: decimalText,
      sourceKeys: sourceKeysFromMaybe([
        yahoo.beta !== null ? "yahoo_summary" : undefined,
        finnhubMetric.beta !== null ? "finnhub_metric" : undefined,
      ]),
      sourceMap,
      notes: beta === null ? ["requires observed beta"] : undefined,
    }),
  ]

  ;[...fairness, ...quality, ...dividend, ...stability].forEach((item) => {
    if (item.formatted === "unknown") {
      const reason = item.notes?.find(Boolean) ?? "unknown"
      unknowns.push(unknownReason(item.label, reason))
    }
  })

  if (quarterlyAscending.length < 4) {
    unknowns.push("Last 4 quarters chart: fewer than four quarterly statement periods are available")
  }

  const lastFourQuarters: QuarterlyBar[] = quarterlyAscending.map((period) => {
    const source = sourceSummary(sourceMap, fieldSources([period], ["revenue", "netIncome"]))
    return {
      quarter: period.label,
      revenue: period.revenue,
      netIncome: period.netIncome,
      source: source.source,
      source_url: source.source_url,
      retrieved_at: source.retrieved_at,
    }
  })

  return {
    ticker,
    generated_at: new Date().toISOString(),
    current_price: currentPrice,
    fairness,
    quality,
    dividend,
    stability,
    last_four_quarters: lastFourQuarters,
    unknowns: normalizeUnknowns(unknowns),
  }
}

function sourceKeysFromMaybe(input: Array<SourceKey | undefined>) {
  return input.filter((item): item is SourceKey => Boolean(item))
}

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

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br/>")
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
  calculatePegy,
  calculatePiotroskiFScore,
  calculatePriceToFcf,
  calculateRoic,
  calculateRuleOf40,
  calculateSustainableGrowthRate,
}
