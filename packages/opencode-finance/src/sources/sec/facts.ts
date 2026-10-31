import { type SecContext, TTL, filingIndexUrl, padCik, secJson } from "./client"
import { resolveCompany } from "./company"

export type XbrlFact = {
  start?: string
  end: string
  val: number
  accn: string
  fy?: number | null
  fp?: string | null
  form: string
  filed: string
  frame?: string
}

type XbrlConcept = { label?: string | null; description?: string | null; units: Record<string, XbrlFact[]> }

export type CompanyFacts = {
  cik: number
  entityName: string
  facts: Record<string, Record<string, XbrlConcept>>
}

type Kind = "money" | "per_share" | "shares"

type MetricDef = {
  label: string
  kind: Kind
  // "duration" metrics cover a period (income, cash flow); "instant" metrics are point-in-time (balance sheet).
  timing: "duration" | "instant"
  // Candidate concepts in priority order; companies switch tags over time, so all are merged per period.
  tags: string[]
}

export const METRICS: Record<string, MetricDef> = {
  revenue: {
    label: "Revenue",
    kind: "money",
    timing: "duration",
    tags: [
      "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      "us-gaap:Revenues",
      "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
      "us-gaap:SalesRevenueNet",
      "ifrs-full:Revenue",
    ],
  },
  cost_of_revenue: {
    label: "Cost of revenue",
    kind: "money",
    timing: "duration",
    tags: ["us-gaap:CostOfGoodsAndServicesSold", "us-gaap:CostOfRevenue", "ifrs-full:CostOfSales"],
  },
  gross_profit: { label: "Gross profit", kind: "money", timing: "duration", tags: ["us-gaap:GrossProfit", "ifrs-full:GrossProfit"] },
  research_and_development: {
    label: "Research and development",
    kind: "money",
    timing: "duration",
    tags: ["us-gaap:ResearchAndDevelopmentExpense", "ifrs-full:ResearchAndDevelopmentExpense"],
  },
  selling_general_admin: {
    label: "Selling, general and administrative",
    kind: "money",
    timing: "duration",
    tags: ["us-gaap:SellingGeneralAndAdministrativeExpense"],
  },
  operating_income: {
    label: "Operating income",
    kind: "money",
    timing: "duration",
    tags: ["us-gaap:OperatingIncomeLoss", "ifrs-full:ProfitLossFromOperatingActivities"],
  },
  interest_expense: {
    label: "Interest expense",
    kind: "money",
    timing: "duration",
    tags: ["us-gaap:InterestExpense", "us-gaap:InterestExpenseNonoperating", "us-gaap:InterestExpenseDebt"],
  },
  income_tax: {
    label: "Income tax expense",
    kind: "money",
    timing: "duration",
    tags: ["us-gaap:IncomeTaxExpenseBenefit", "ifrs-full:IncomeTaxExpenseContinuingOperations"],
  },
  net_income: {
    label: "Net income",
    kind: "money",
    timing: "duration",
    tags: ["us-gaap:NetIncomeLoss", "us-gaap:ProfitLoss", "ifrs-full:ProfitLossAttributableToOwnersOfParent", "ifrs-full:ProfitLoss"],
  },
  eps_basic: {
    label: "EPS, basic",
    kind: "per_share",
    timing: "duration",
    tags: ["us-gaap:EarningsPerShareBasic", "ifrs-full:BasicEarningsLossPerShare"],
  },
  eps_diluted: {
    label: "EPS, diluted",
    kind: "per_share",
    timing: "duration",
    tags: ["us-gaap:EarningsPerShareDiluted", "ifrs-full:DilutedEarningsLossPerShare"],
  },
  diluted_shares: {
    label: "Weighted average diluted shares",
    kind: "shares",
    timing: "duration",
    tags: ["us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding"],
  },
  operating_cash_flow: {
    label: "Cash from operations",
    kind: "money",
    timing: "duration",
    tags: [
      "us-gaap:NetCashProvidedByUsedInOperatingActivities",
      "us-gaap:NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
      "ifrs-full:CashFlowsFromUsedInOperatingActivities",
    ],
  },
  capital_expenditure: {
    label: "Capital expenditure",
    kind: "money",
    timing: "duration",
    tags: [
      "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment",
      "us-gaap:PaymentsToAcquireProductiveAssets",
      "ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
    ],
  },
  depreciation_amortization: {
    label: "Depreciation and amortization",
    kind: "money",
    timing: "duration",
    tags: [
      "us-gaap:DepreciationDepletionAndAmortization",
      "us-gaap:DepreciationAndAmortization",
      "us-gaap:DepreciationAmortizationAndAccretionNet",
    ],
  },
  stock_based_compensation: {
    label: "Stock-based compensation",
    kind: "money",
    timing: "duration",
    tags: ["us-gaap:ShareBasedCompensation", "us-gaap:AllocatedShareBasedCompensationExpense"],
  },
  dividends_paid: {
    label: "Dividends paid",
    kind: "money",
    timing: "duration",
    tags: ["us-gaap:PaymentsOfDividends", "us-gaap:PaymentsOfDividendsCommonStock", "ifrs-full:DividendsPaidClassifiedAsFinancingActivities"],
  },
  share_repurchases: {
    label: "Share repurchases",
    kind: "money",
    timing: "duration",
    tags: ["us-gaap:PaymentsForRepurchaseOfCommonStock"],
  },
  cash: {
    label: "Cash and equivalents",
    kind: "money",
    timing: "instant",
    tags: [
      "us-gaap:CashAndCashEquivalentsAtCarryingValue",
      "us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
      "ifrs-full:CashAndCashEquivalents",
    ],
  },
  current_assets: { label: "Current assets", kind: "money", timing: "instant", tags: ["us-gaap:AssetsCurrent", "ifrs-full:CurrentAssets"] },
  total_assets: { label: "Total assets", kind: "money", timing: "instant", tags: ["us-gaap:Assets", "ifrs-full:Assets"] },
  current_liabilities: {
    label: "Current liabilities",
    kind: "money",
    timing: "instant",
    tags: ["us-gaap:LiabilitiesCurrent", "ifrs-full:CurrentLiabilities"],
  },
  total_liabilities: { label: "Total liabilities", kind: "money", timing: "instant", tags: ["us-gaap:Liabilities", "ifrs-full:Liabilities"] },
  long_term_debt: {
    label: "Long-term debt, noncurrent",
    kind: "money",
    timing: "instant",
    tags: ["us-gaap:LongTermDebtNoncurrent", "us-gaap:LongTermDebtAndCapitalLeaseObligations"],
  },
  long_term_debt_current: {
    label: "Long-term debt, current portion",
    kind: "money",
    timing: "instant",
    tags: ["us-gaap:LongTermDebtCurrent", "us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent"],
  },
  stockholders_equity: {
    label: "Stockholders' equity",
    kind: "money",
    timing: "instant",
    tags: [
      "us-gaap:StockholdersEquity",
      "us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
      "ifrs-full:EquityAttributableToOwnersOfParent",
      "ifrs-full:Equity",
    ],
  },
  shares_outstanding: {
    label: "Shares outstanding (cover page)",
    kind: "shares",
    timing: "instant",
    tags: ["dei:EntityCommonStockSharesOutstanding"],
  },
}

export type Period = "annual" | "quarterly"

export type MetricValue = {
  period_start: string | null
  period_end: string
  value: number
  unit: string
  tag: string
  form: string
  accession: string
  filed: string
  filing_url: string
}

const ANNUAL_FORMS = /^(10-K|10-KT|20-F|40-F)(\/A)?$/

function days(start: string, end: string) {
  return (Date.parse(end) - Date.parse(start)) / 86_400_000
}

function pickUnit(units: Record<string, XbrlFact[]>, kind: Kind) {
  const names = Object.keys(units)
  if (kind === "shares") return names.find((name) => name === "shares")
  if (kind === "per_share") return names.find((name) => name === "USD/shares") ?? names.find((name) => /^[A-Z]{3}\/shares$/.test(name))
  return names.find((name) => name === "USD") ?? names.find((name) => /^[A-Z]{3}$/.test(name))
}

export function inPeriod(fact: XbrlFact, timing: MetricDef["timing"], period: Period) {
  if (timing === "duration") {
    if (!fact.start) return false
    const length = days(fact.start, fact.end)
    return period === "annual" ? length >= 350 && length <= 380 : length >= 80 && length <= 100
  }
  if (fact.start) return false
  // Balance sheet values: annual = as reported in annual reports; quarterly = every reported quarter end.
  return period === "annual" ? ANNUAL_FORMS.test(fact.form) : true
}

// Merges candidate tags into one series: one value per period, best tag first, latest filing (restatements) winning.
export function extractMetric(facts: CompanyFacts, key: string, period: Period, limit: number): MetricValue[] {
  const def = METRICS[key]!
  const byPeriod = new Map<string, MetricValue & { rank: number }>()
  def.tags.forEach((tag, rank) => {
    const [taxonomy, name] = tag.split(":") as [string, string]
    const concept = facts.facts[taxonomy]?.[name]
    if (!concept) return
    const unit = pickUnit(concept.units, def.kind)
    if (!unit) return
    for (const fact of concept.units[unit] ?? []) {
      if (typeof fact.val !== "number" || !inPeriod(fact, def.timing, period)) continue
      const id = `${fact.start ?? ""}/${fact.end}`
      const existing = byPeriod.get(id)
      if (existing && (existing.rank < rank || (existing.rank === rank && existing.filed >= fact.filed))) continue
      byPeriod.set(id, {
        rank,
        period_start: fact.start ?? null,
        period_end: fact.end,
        value: fact.val,
        unit,
        tag,
        form: fact.form,
        accession: fact.accn,
        filed: fact.filed,
        filing_url: filingIndexUrl(facts.cik, fact.accn),
      })
    }
  })

  return [...byPeriod.values()]
    .sort((a, b) => (a.period_end === b.period_end ? 0 : a.period_end < b.period_end ? 1 : -1))
    .slice(0, limit)
    .map(({ rank: _rank, ...value }) => value)
}

export async function companyFacts(ctx: SecContext, cik: string) {
  return secJson<CompanyFacts>(
    ctx,
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`,
    TTL.facts,
    "XBRL company facts",
  )
}

export async function facts(ctx: SecContext, input: string, options: { period: Period; limit: number; metrics?: string[] }) {
  const unknown = (options.metrics ?? []).filter((key) => !METRICS[key])
  if (unknown.length) throw new Error(`unknown metric(s): ${unknown.join(", ")}. Known: ${Object.keys(METRICS).join(", ")}`)

  const ref = await resolveCompany(ctx, input)
  const data = await companyFacts(ctx, ref.cik)
  const keys = options.metrics?.length ? options.metrics : Object.keys(METRICS)
  const metrics: Record<string, { label: string; values: MetricValue[] }> = {}
  const missing: string[] = []
  for (const key of keys) {
    const values = extractMetric(data, key, options.period, options.limit)
    if (values.length) metrics[key] = { label: METRICS[key]!.label, values }
    else missing.push(key)
  }

  if (options.period === "quarterly" && metrics.revenue) {
    ctx.collector.warn(
      "Quarterly values are 3-month periods as filed in 10-Qs. Fiscal Q4 is usually not filed separately; derive it as annual minus Q1-Q3 and label it derived.",
    )
  }
  if (missing.length) {
    ctx.collector.warn(
      `No value found for: ${missing.join(", ")}. The company may use a custom tag; inspect with \`fin sec concept\` or the filing itself.`,
    )
  }

  return {
    company: { ...ref, name: data.entityName },
    period: options.period,
    metrics,
    missing,
  }
}

export async function concept(ctx: SecContext, input: string, tag: string, options: { unit?: string; limit: number }) {
  const [taxonomy, name] = tag.includes(":") ? tag.split(":") : ["us-gaap", tag]
  const ref = await resolveCompany(ctx, input)
  const payload = await secJson<{ entityName: string; label: string; description: string; units: Record<string, XbrlFact[]> }>(
    ctx,
    `https://data.sec.gov/api/xbrl/companyconcept/CIK${ref.cik}/${taxonomy}/${name}.json`,
    TTL.facts,
    `XBRL concept ${taxonomy}:${name}`,
  )
  const units = options.unit ? [options.unit] : Object.keys(payload.units)
  const series = Object.fromEntries(
    units
      .filter((unit) => payload.units[unit])
      .map((unit) => [
        unit,
        [...payload.units[unit]!]
          .sort((a, b) => (a.end === b.end ? (a.filed < b.filed ? 1 : -1) : a.end < b.end ? 1 : -1))
          .slice(0, options.limit)
          .map((fact) => ({
            period_start: fact.start ?? null,
            period_end: fact.end,
            // fy/fp describe the filing that reported the value, not the period itself.
            filing_fiscal_year: fact.fy ?? null,
            filing_fiscal_period: fact.fp ?? null,
            value: fact.val,
            form: fact.form,
            accession: fact.accn,
            filed: fact.filed,
            frame: fact.frame ?? null,
            filing_url: filingIndexUrl(ref.cik, fact.accn),
          })),
      ]),
  )
  if (options.unit && !payload.units[options.unit]) {
    throw new Error(`${taxonomy}:${name} has no ${options.unit} values. Units: ${Object.keys(payload.units).join(", ")}`)
  }
  return {
    company: { ...ref, name: payload.entityName },
    tag: `${taxonomy}:${name}`,
    label: payload.label,
    description: payload.description,
    units: series,
  }
}

export async function frames(
  ctx: SecContext,
  tag: string,
  period: string,
  options: { unit: string; limit: number; order: "desc" | "asc" },
) {
  const [taxonomy, name] = tag.includes(":") ? tag.split(":") : ["us-gaap", tag]
  if (!/^CY\d{4}(Q[1-4]I?)?$/.test(period)) {
    throw new Error(`period must look like CY2025 (annual), CY2025Q3 (quarter) or CY2025Q4I (instant), got ${period}`)
  }
  const payload = await secJson<{ label: string; description: string; pts: number; data: { accn: string; cik: number; entityName: string; loc: string; start?: string; end: string; val: number }[] }>(
    ctx,
    `https://data.sec.gov/api/xbrl/frames/${taxonomy}/${name}/${options.unit.replace("/", "-per-")}/${period}.json`,
    TTL.frames,
    `XBRL frame ${taxonomy}:${name} ${period}`,
  )
  const sorted = [...payload.data].sort((a, b) => (options.order === "desc" ? b.val - a.val : a.val - b.val))
  return {
    tag: `${taxonomy}:${name}`,
    label: payload.label,
    period,
    unit: options.unit,
    companies: payload.pts,
    rows: sorted.slice(0, options.limit).map((row) => ({
      cik: padCik(row.cik),
      name: row.entityName,
      location: row.loc,
      period_start: row.start ?? null,
      period_end: row.end,
      value: row.val,
      accession: row.accn,
      filing_url: filingIndexUrl(row.cik, row.accn),
    })),
  }
}
