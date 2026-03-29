import { afterEach, describe, expect, test } from "bun:test"
import { buildReportEvaluationSnapshot, ReportEvaluationSnapshotSchema } from "../../src/report/evaluation"

const originalFetch = globalThis.fetch

type MockConfig = {
  summaryStatus?: number
  summaryBody?: unknown
  annualStatus?: number
  annualBody?: unknown
  quarterlyStatus?: number
  quarterlyBody?: unknown
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  })
}

function installYahooFetchMock(config: MockConfig = {}) {
  globalThis.fetch = (async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

    if (url.includes("/v10/finance/quoteSummary/")) {
      if ((config.summaryStatus ?? 200) !== 200) {
        return new Response("Edge: Too Many Requests", { status: config.summaryStatus ?? 429 })
      }
      return jsonResponse(config.summaryBody ?? makeSummaryPayload())
    }

    const type = new URL(url).searchParams.get("type") ?? ""
    if (type.startsWith("annual")) {
      if ((config.annualStatus ?? 200) !== 200) {
        return new Response("request failed", { status: config.annualStatus ?? 500 })
      }
      return jsonResponse(config.annualBody ?? makeAnnualPayload())
    }

    if (type.startsWith("quarterly")) {
      if ((config.quarterlyStatus ?? 200) !== 200) {
        return new Response("request failed", { status: config.quarterlyStatus ?? 500 })
      }
      return jsonResponse(config.quarterlyBody ?? makeQuarterlyPayload())
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }) as typeof fetch
}

function makeSummaryPayload(overrides?: Partial<Record<string, unknown>>) {
  return {
    quoteSummary: {
      result: [
        {
          financialData: {
            targetMedianPrice: { raw: 240 },
            totalRevenue: { raw: 395 },
            revenueGrowth: { raw: 0.12 },
            netIncomeToCommon: { raw: 97 },
            freeCashflow: { raw: 88 },
            grossMargins: { raw: 0.45 },
            ...(overrides?.financialData as Record<string, unknown> | undefined),
          },
          defaultKeyStatistics: {
            sharesOutstanding: { raw: 16 },
            beta: { raw: 1.08 },
            ...(overrides?.defaultKeyStatistics as Record<string, unknown> | undefined),
          },
          summaryDetail: {
            dividendYield: { raw: 0.0055 },
            payoutRatio: { raw: 0.2 },
            ...(overrides?.summaryDetail as Record<string, unknown> | undefined),
          },
          price: {
            regularMarketPrice: { raw: 210 },
            marketCap: null,
            ...(overrides?.price as Record<string, unknown> | undefined),
          },
        },
      ],
      error: overrides?.error ?? null,
    },
  }
}

function makeTimeSeriesPayload(
  timeframe: "annual" | "quarterly",
  input: Record<string, Array<{ asOfDate: string; raw: number }>>,
) {
  const prefix = timeframe === "annual" ? "annual" : "quarterly"
  return {
    timeseries: {
      result: Object.entries(input).map(([key, values]) => ({
        meta: {},
        [`${prefix}${key}`]: values.map((value) => ({
          asOfDate: value.asOfDate,
          reportedValue: { raw: value.raw },
        })),
      })),
    },
  }
}

function makeAnnualPayload(overrides?: Record<string, Array<{ asOfDate: string; raw: number }>>) {
  return makeTimeSeriesPayload("annual", {
    TotalRevenue: [
      { asOfDate: "2025-09-27", raw: 400 },
      { asOfDate: "2024-09-28", raw: 360 },
    ],
    NetIncome: [
      { asOfDate: "2025-09-27", raw: 100 },
      { asOfDate: "2024-09-28", raw: 90 },
    ],
    GrossProfit: [
      { asOfDate: "2025-09-27", raw: 180 },
      { asOfDate: "2024-09-28", raw: 160 },
    ],
    OperatingIncome: [
      { asOfDate: "2025-09-27", raw: 120 },
      { asOfDate: "2024-09-28", raw: 105 },
    ],
    PretaxIncome: [
      { asOfDate: "2025-09-27", raw: 115 },
      { asOfDate: "2024-09-28", raw: 100 },
    ],
    TaxProvision: [
      { asOfDate: "2025-09-27", raw: 21 },
      { asOfDate: "2024-09-28", raw: 20 },
    ],
    TaxRateForCalcs: [
      { asOfDate: "2025-09-27", raw: 0.18 },
      { asOfDate: "2024-09-28", raw: 0.2 },
    ],
    OperatingCashFlow: [
      { asOfDate: "2025-09-27", raw: 130 },
      { asOfDate: "2024-09-28", raw: 120 },
    ],
    CurrentAssets: [
      { asOfDate: "2025-09-27", raw: 150 },
      { asOfDate: "2024-09-28", raw: 140 },
    ],
    CurrentLiabilities: [
      { asOfDate: "2025-09-27", raw: 100 },
      { asOfDate: "2024-09-28", raw: 100 },
    ],
    TotalAssets: [
      { asOfDate: "2025-09-27", raw: 500 },
      { asOfDate: "2024-09-28", raw: 470 },
    ],
    TotalLiabilitiesNetMinorityInterest: [
      { asOfDate: "2025-09-27", raw: 260 },
      { asOfDate: "2024-09-28", raw: 250 },
    ],
    StockholdersEquity: [
      { asOfDate: "2025-09-27", raw: 240 },
      { asOfDate: "2024-09-28", raw: 220 },
    ],
    CashAndCashEquivalents: [
      { asOfDate: "2025-09-27", raw: 60 },
      { asOfDate: "2024-09-28", raw: 55 },
    ],
    LongTermDebt: [
      { asOfDate: "2025-09-27", raw: 70 },
      { asOfDate: "2024-09-28", raw: 75 },
    ],
    CurrentDebt: [
      { asOfDate: "2025-09-27", raw: 20 },
      { asOfDate: "2024-09-28", raw: 20 },
    ],
    TotalDebt: [
      { asOfDate: "2025-09-27", raw: 90 },
      { asOfDate: "2024-09-28", raw: 95 },
    ],
    RetainedEarnings: [
      { asOfDate: "2025-09-27", raw: 150 },
      { asOfDate: "2024-09-28", raw: 135 },
    ],
    BasicAverageShares: [
      { asOfDate: "2025-09-27", raw: 15.5 },
      { asOfDate: "2024-09-28", raw: 15.8 },
    ],
    DilutedAverageShares: [
      { asOfDate: "2025-09-27", raw: 16 },
      { asOfDate: "2024-09-28", raw: 16.2 },
    ],
    ...overrides,
  })
}

function makeQuarterlyPayload(input?: Array<{ asOfDate: string; revenue: number; netIncome: number }>) {
  const rows =
    input ??
    [
      { asOfDate: "2025-03-31", revenue: 90, netIncome: 20 },
      { asOfDate: "2025-06-30", revenue: 95, netIncome: 22 },
      { asOfDate: "2025-09-30", revenue: 100, netIncome: 25 },
      { asOfDate: "2025-12-31", revenue: 110, netIncome: 30 },
    ]

  return makeTimeSeriesPayload("quarterly", {
    TotalRevenue: rows.map((row) => ({ asOfDate: row.asOfDate, raw: row.revenue })),
    NetIncome: rows.map((row) => ({ asOfDate: row.asOfDate, raw: row.netIncome })),
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("buildReportEvaluationSnapshot", () => {
  test("builds a Yahoo-only snapshot and drops PEGY", async () => {
    installYahooFetchMock()

    const snapshot = await buildReportEvaluationSnapshot({ ticker: "AAPL" })

    expect(snapshot.ticker).toBe("AAPL")
    expect(snapshot.current_price).toBe(210)
    expect(snapshot.fairness.some((metric) => metric.key === "pegy")).toBe(false)
    expect(snapshot.fairness.find((metric) => metric.key === "price_to_earnings")?.formatted).toBe("34.64x")
    expect(snapshot.quality.find((metric) => metric.key === "rule_of_40")?.formatted).toBe("34.28%")
    expect(snapshot.last_four_quarters).toHaveLength(4)
    expect(snapshot.unknowns).toEqual([])
  })

  test("marks ROIC unknown when Yahoo tax inputs are unavailable", async () => {
    installYahooFetchMock({
      annualBody: makeAnnualPayload({
        TaxProvision: [],
        TaxRateForCalcs: [],
      }),
    })

    const snapshot = await buildReportEvaluationSnapshot({ ticker: "AAPL" })
    const roic = snapshot.quality.find((metric) => metric.key === "roic")

    expect(roic?.formatted).toBe("unknown")
    expect(snapshot.unknowns).toContain("Return on Invested Capital: requires annual effective tax rate")
  })

  test("records an explicit unknown when fewer than four quarterly periods are available", async () => {
    installYahooFetchMock({
      quarterlyBody: makeQuarterlyPayload([
        { asOfDate: "2025-06-30", revenue: 95, netIncome: 22 },
        { asOfDate: "2025-09-30", revenue: 100, netIncome: 25 },
        { asOfDate: "2025-12-31", revenue: 110, netIncome: 30 },
      ]),
    })

    const snapshot = await buildReportEvaluationSnapshot({ ticker: "AAPL" })

    expect(snapshot.last_four_quarters).toHaveLength(3)
    expect(snapshot.unknowns).toContain("Last 4 quarters chart: fewer than four quarterly statement periods are available")
  })

  test("keeps schema validity and explicit unknowns on Yahoo rate limiting", async () => {
    installYahooFetchMock({
      summaryStatus: 429,
      annualBody: { timeseries: { result: [] } },
      quarterlyBody: { timeseries: { result: [] } },
    })

    const snapshot = await buildReportEvaluationSnapshot({ ticker: "AAPL" })

    expect(ReportEvaluationSnapshotSchema.parse(snapshot).ticker).toBe("AAPL")
    expect(snapshot.current_price).toBeNull()
    expect(snapshot.last_four_quarters).toEqual([])
    expect(snapshot.unknowns.some((item) => item.includes("summary") && item.includes("429"))).toBe(true)
  })
})
