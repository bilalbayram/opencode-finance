import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, describe, expect, test } from "bun:test"
import { OPENCLAW_TOOL_IDS, createOpenClawExecutionContext, loadOpenClawToolEntries } from "../../src/entrypoints/openclaw/tool-adapter"

const TEMP_ROOTS: string[] = []

function reportArtifacts() {
  const timestamp = "2026-02-14T12:00:00.000Z"
  const url = "https://finance.yahoo.com/quote/AAPL"
  return {
    report: [
      "# AAPL Research Report",
      "",
      "Ticker: AAPL",
      "Report Date: 2026-02-14",
      "Sector: Technology",
      "Headquarters: Cupertino, CA, USA",
      "Website: https://www.apple.com",
      "Icon URL: https://logo.clearbit.com/apple.com",
      "",
      "## Executive Summary",
      "Apple remains resilient on installed-base monetization and cash generation. [1]",
      "",
      "Score: 72 | Band: bullish",
      "",
      "## Technical Analysis",
      "- Price is above its medium-term trend. [1]",
      "",
      "## Fundamental Analysis",
      "Revenue: $391B [1]",
      "Net income: $94B [1]",
      "Free cash flow: $99B [1]",
      "Debt-to-equity: 1.5x [1]",
      "",
      "## Risk Assessment",
      "- China demand remains a monitoring item. [1]",
      "",
      "## Portfolio Fit",
      "Not evaluated: missing portfolio holdings, benchmark, and mandate",
      "",
      "## Market Intelligence",
      "- Services growth remains a core support. [1]",
      "",
      "## Scenario Valuation",
      "- Base case assumes mid-single-digit revenue growth. [1]",
      "",
      "## Directional Conviction Score and Monitoring Triggers",
      "- Watch gross margin stability and services mix. [1]",
      "",
      "## Top Positive Drivers",
      "- Services growth supporting margin durability. [1]",
      "- Balance sheet flexibility and buyback capacity. [1]",
      "",
      "## Top Negative Drivers",
      "- iPhone demand volatility in China. [1]",
      "- Platform regulation risk. [1]",
      "",
      "## Sources",
      '[1] Yahoo Finance, "Apple Inc. quote", https://finance.yahoo.com/quote/AAPL. Retrieved 2026-02-14.',
    ].join("\n"),
    dashboard: [
      "# Dashboard",
      "",
      "| KPI | Value | Period | Source | Source URL | Retrieval timestamp |",
      "| --- | --- | --- | --- | --- | --- |",
      `| Stock Price | $210.10 | Daily | Yahoo Finance | ${url} | ${timestamp} |`,
      `| Previous close | $208.40 | Daily | Yahoo Finance | ${url} | ${timestamp} |`,
      `| Daily change | $1.70 | Daily | Yahoo Finance | ${url} | ${timestamp} |`,
      `| Daily change percent | 0.82% | Daily | Yahoo Finance | ${url} | ${timestamp} |`,
      `| 52W range | $164.00 to $215.00 | 52W | Yahoo Finance | ${url} | ${timestamp} |`,
      `| YTD return | 12.10% | YTD | Yahoo Finance | ${url} | ${timestamp} |`,
      `| Market cap | $3.1T | Daily | Yahoo Finance | ${url} | ${timestamp} |`,
      `| Analyst consensus | Moderate Buy (28 buy / 10 hold / 2 sell) | Daily | Yahoo Finance | ${url} | ${timestamp} |`,
      `| Revenue | $391B | TTM | Yahoo Finance | ${url} | ${timestamp} |`,
      `| Net income | $94B | TTM | Yahoo Finance | ${url} | ${timestamp} |`,
      `| Free cash flow | $99B | TTM | Yahoo Finance | ${url} | ${timestamp} |`,
      `| Debt-to-equity | 1.50x | TTM | Yahoo Finance | ${url} | ${timestamp} |`,
    ].join("\n"),
    assumptions: JSON.stringify(
      {
        scenario_assumptions: { base: "mid-single-digit growth" },
        score_inputs: { valuation: 22, quality: 25, momentum: 25 },
        factor_weights: { valuation: 0.3, quality: 0.4, momentum: 0.3 },
        uncertainty_flags: ["macro sensitivity"],
      },
      null,
      2,
    ),
    evaluation: [
      "# Deterministic Evaluation Snapshot",
      "",
      "Ticker: AAPL",
      "Generated At: 2026-02-14T12:00:00.000Z",
      "Current Price: $210.10",
    ].join("\n"),
    evaluationSnapshot: JSON.stringify(
      {
        ticker: "AAPL",
        generated_at: "2026-02-14T12:00:00.000Z",
        current_price: 210.1,
        fairness: [
          {
            key: "dcf",
            label: "DCF",
            category: "fairness",
            value: 220.5,
            formatted: "$220.50",
            basis: "modeled",
            source: "Yahoo Finance",
            source_url: url,
            retrieved_at: timestamp,
          },
        ],
        quality: [
          {
            key: "roe",
            label: "Return on Equity",
            category: "quality",
            value: 32.1,
            formatted: "32.1%",
            basis: "reported",
            source: "Yahoo Finance",
            source_url: url,
            retrieved_at: timestamp,
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
            source_url: url,
            retrieved_at: timestamp,
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
            source_url: url,
            retrieved_at: timestamp,
          },
        ],
        last_four_quarters: [
          {
            quarter: "Q1 2025",
            revenue: 120000000000,
            netIncome: 34000000000,
            source: "Yahoo Finance",
            source_url: url,
            retrieved_at: timestamp,
          },
          {
            quarter: "Q2 2025",
            revenue: 118000000000,
            netIncome: 31000000000,
            source: "Yahoo Finance",
            source_url: url,
            retrieved_at: timestamp,
          },
          {
            quarter: "Q3 2025",
            revenue: 124000000000,
            netIncome: 36000000000,
            source: "Yahoo Finance",
            source_url: url,
            retrieved_at: timestamp,
          },
          {
            quarter: "Q4 2025",
            revenue: 130000000000,
            netIncome: 39000000000,
            source: "Yahoo Finance",
            source_url: url,
            retrieved_at: timestamp,
          },
        ],
        unknowns: [],
      },
      null,
      2,
    ),
  }
}

async function makeReportDirectory() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-finance-openclaw-"))
  TEMP_ROOTS.push(root)
  const outputRoot = path.join(root, "reports", "AAPL", "2026-02-14")
  const artifacts = reportArtifacts()
  await fs.mkdir(outputRoot, { recursive: true })
  await Promise.all([
    fs.writeFile(path.join(outputRoot, "report.md"), artifacts.report, "utf8"),
    fs.writeFile(path.join(outputRoot, "dashboard.md"), artifacts.dashboard, "utf8"),
    fs.writeFile(path.join(outputRoot, "assumptions.json"), artifacts.assumptions, "utf8"),
    fs.writeFile(path.join(outputRoot, "evaluation.md"), artifacts.evaluation, "utf8"),
    fs.writeFile(path.join(outputRoot, "evaluation-snapshot.json"), artifacts.evaluationSnapshot, "utf8"),
  ])
  return {
    root,
    outputRoot,
  }
}

afterEach(async () => {
  await Promise.all(TEMP_ROOTS.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("OpenClaw tool adapter", () => {
  test("exposes only the OpenClaw v1 report tools", async () => {
    const entries = await loadOpenClawToolEntries()

    expect(entries.map((entry) => entry.name).toSorted()).toEqual([...OPENCLAW_TOOL_IDS].toSorted())

    const wrapped = entries.map((entry) => entry.create({ workspaceDir: "/tmp/workspace" }))
    expect(wrapped.map((tool) => tool.name).toSorted()).toEqual([...OPENCLAW_TOOL_IDS].toSorted())
    wrapped.forEach((tool) => {
      expect(tool.parameters).toMatchObject({ type: "object" })
    })
  })

  test("creates a runtime-neutral execution context rooted at the OpenClaw workspace", async () => {
    const abort = new AbortController()
    const context = createOpenClawExecutionContext({ workspaceDir: "/tmp/workspace" }, abort.signal)

    expect(context.directory).toBe("/tmp/workspace")
    expect(context.worktree).toBe("/tmp/workspace")
    expect(context.abort).toBe(abort.signal)
    await expect(
      context.ask({
        permission: "edit",
        patterns: ["reports/*"],
        always: ["*"],
      }),
    ).resolves.toBeUndefined()
  })

  test("wraps report_pdf for OpenClaw execution", async () => {
    const { root, outputRoot } = await makeReportDirectory()
    const entries = await loadOpenClawToolEntries()
    const reportPdf = entries.find((entry) => entry.name === "report_pdf")

    expect(reportPdf).toBeTruthy()

    const tool = reportPdf!.create({ workspaceDir: root })
    const result = await tool.execute("call-1", {
      subcommand: "report",
      outputRoot: path.relative(root, outputRoot),
      filename: "AAPL-2026-02-14.pdf",
    })

    expect(result.content[0]?.type).toBe("text")
    expect(result.content[0]?.text).toContain("Generated PDF report")
    await expect(fs.stat(path.join(outputRoot, "AAPL-2026-02-14.pdf"))).resolves.toBeTruthy()
  })
})
