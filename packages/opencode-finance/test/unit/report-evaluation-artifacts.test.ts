import fs from "fs/promises"
import os from "os"
import path from "path"
import { describe, expect, test } from "bun:test"
import {
  renderReportEvaluationMarkdown,
  ReportEvaluationSnapshotSchema,
  writeReportEvaluationArtifacts,
} from "../../src/report/evaluation"

const SNAPSHOT = ReportEvaluationSnapshotSchema.parse({
  ticker: "AAPL",
  generated_at: "2026-02-26T00:00:00.000Z",
  current_price: 210.1,
  fairness: [
    {
      key: "dcf",
      label: "DCF",
      category: "fairness",
      value: 225.4,
      formatted: "$225.40",
      basis: "modeled",
      source: "Yahoo Finance",
      source_url: "https://finance.yahoo.com/quote/AAPL",
      retrieved_at: "2026-02-26T00:00:00.000Z",
    },
  ],
  quality: [
    {
      key: "roe",
      label: "Return on Equity",
      category: "quality",
      value: 32.4,
      formatted: "32.4%",
      basis: "derived",
      source: "Yahoo Finance",
      source_url: "https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=financialData%2CdefaultKeyStatistics%2CsummaryDetail%2Cprice | https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/AAPL?symbol=AAPL&type=annualTotalRevenue",
      retrieved_at: "2026-02-26T00:00:00.000Z",
    },
  ],
  dividend: [
    {
      key: "dividend_yield",
      label: "Dividend Yield",
      category: "dividend",
      value: 0.55,
      formatted: "0.55%",
      basis: "reported",
      source: "Yahoo Finance",
      source_url: "https://finance.yahoo.com/quote/AAPL",
      retrieved_at: "2026-02-26T00:00:00.000Z",
    },
  ],
  stability: [
    {
      key: "beta",
      label: "Beta",
      category: "stability",
      value: 1.08,
      formatted: "1.08",
      basis: "reported",
      source: "Yahoo Finance",
      source_url: "https://finance.yahoo.com/quote/AAPL",
      retrieved_at: "2026-02-26T00:00:00.000Z",
    },
  ],
  last_four_quarters: [
    {
      quarter: "Q1 2025",
      revenue: 120000000000,
      netIncome: 34000000000,
      source: "Yahoo Finance",
      source_url:
        "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/AAPL?symbol=AAPL&type=quarterlyTotalRevenue%2CquarterlyNetIncome",
      retrieved_at: "2026-02-26T00:00:00.000Z",
    },
    {
      quarter: "Q2 2025",
      revenue: 118000000000,
      netIncome: 31000000000,
      source: "Yahoo Finance",
      source_url:
        "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/AAPL?symbol=AAPL&type=quarterlyTotalRevenue%2CquarterlyNetIncome",
      retrieved_at: "2026-02-26T00:00:00.000Z",
    },
    {
      quarter: "Q3 2025",
      revenue: 124000000000,
      netIncome: 36000000000,
      source: "Yahoo Finance",
      source_url:
        "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/AAPL?symbol=AAPL&type=quarterlyTotalRevenue%2CquarterlyNetIncome",
      retrieved_at: "2026-02-26T00:00:00.000Z",
    },
    {
      quarter: "Q4 2025",
      revenue: 130000000000,
      netIncome: 39000000000,
      source: "Yahoo Finance",
      source_url:
        "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/AAPL?symbol=AAPL&type=quarterlyTotalRevenue%2CquarterlyNetIncome",
      retrieved_at: "2026-02-26T00:00:00.000Z",
    },
  ],
  unknowns: [],
})

describe("report evaluation artifacts", () => {
  test("renders markdown sections for every metric group", () => {
    const markdown = renderReportEvaluationMarkdown(SNAPSHOT)

    expect(markdown).toContain("# Deterministic Evaluation Snapshot")
    expect(markdown).toContain("## Fairness")
    expect(markdown).toContain("## Quality")
    expect(markdown).toContain("## Dividend")
    expect(markdown).toContain("## Price Stability")
    expect(markdown).toContain("## Last 4 Quarters")
  })

  test("writes evaluation artifacts to disk", async () => {
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "report-evaluation-artifacts-"))
    try {
      const result = await writeReportEvaluationArtifacts({
        outputRoot,
        snapshot: SNAPSHOT,
      })

      const markdown = await fs.readFile(result.evaluation_path, "utf8")
      const snapshot = JSON.parse(await fs.readFile(result.snapshot_path, "utf8"))

      expect(markdown).toContain("Deterministic Evaluation Snapshot")
      expect(snapshot.ticker).toBe("AAPL")
      expect(snapshot.fairness[0].label).toBe("DCF")
    } finally {
      await fs.rm(outputRoot, { recursive: true, force: true })
    }
  })
})
