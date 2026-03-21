import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { AggregateWindow } from "../../src/finance/political-backtest"
import { buildRunComparison } from "../../src/tool/financial-political-backtest/comparison"
import { buildPersistenceTrends, clampLimit, createRunId } from "../../src/tool/report-government-trading/persistence"

const tempRoots: string[] = []

function aggregate(input: Partial<AggregateWindow> = {}): AggregateWindow {
  return {
    anchor_kind: "transaction",
    window_sessions: 5,
    benchmark_symbol: "SPY",
    sample_size: 3,
    hit_rate_percent: 50,
    mean_return_percent: 1,
    median_return_percent: 1,
    stdev_return_percent: 0.5,
    mean_excess_return_percent: 0.5,
    mean_relative_return_percent: 0.5,
    ...input,
  }
}

function event(identityKey: string, ticker = "AAPL") {
  return {
    identityKey,
    materialFingerprint: `${identityKey}-fp`,
    datasetId: "ticker_house_trading",
    datasetLabel: "Ticker House Trading",
    rowIndex: 0,
    identityFields: {
      actor: "Rep. Example",
      ticker,
      transaction_date: "2026-01-02",
      transaction_type: "Purchase",
      amount: "$1,001 - $15,000",
    },
    materialFields: {},
    canonicalRow: {},
    rawRow: {},
  }
}

async function createBacktestRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-backtest-"))
  tempRoots.push(root)
  return root
}

async function writeHistoricalRun(input: {
  root: string
  scopeKey: string
  runName: string
  generatedAt: string
  aggregates: AggregateWindow[]
  eventIDs: string[]
}) {
  const outputRoot = path.join(input.root, "reports", "political-backtest", input.scopeKey, input.runName)
  await fs.mkdir(outputRoot, { recursive: true })
  await Bun.write(
    path.join(outputRoot, "assumptions.json"),
    JSON.stringify({
      workflow: "financial_political_backtest",
      generated_at: input.generatedAt,
    }),
  )
  await Bun.write(path.join(outputRoot, "aggregate-results.json"), JSON.stringify(input.aggregates))
  await Bun.write(
    path.join(outputRoot, "events.json"),
    JSON.stringify(input.eventIDs.map((eventID) => ({ event_id: eventID }))),
  )
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("buildRunComparison", () => {
  test("loads the latest historical run for the scoped political-backtest workflow", async () => {
    const reportsRoot = await createBacktestRoot()

    await writeHistoricalRun({
      root: reportsRoot,
      scopeKey: "AAPL",
      runName: "run-1",
      generatedAt: "2026-01-01T08:00:00.000Z",
      aggregates: [aggregate({ mean_excess_return_percent: -0.25 })],
      eventIDs: ["evt-1"],
    })

    await writeHistoricalRun({
      root: reportsRoot,
      scopeKey: "AAPL",
      runName: "run-2",
      generatedAt: "2026-01-02T08:00:00.000Z",
      aggregates: [aggregate({ mean_excess_return_percent: -0.1, sample_size: 4 })],
      eventIDs: ["evt-1", "evt-2"],
    })

    const comparison = await buildRunComparison({
      reportsRoot,
      scopeKey: "AAPL",
      currentSnapshot: {
        workflow: "financial_political_backtest",
        output_root: path.join(reportsRoot, "current"),
        generated_at: "2026-01-03T08:00:00.000Z",
        aggregates: [aggregate({ mean_excess_return_percent: 0.2, sample_size: 5 })],
        event_ids: ["evt-2", "evt-3"],
      },
    })

    expect(comparison.first_run).toBeFalse()
    expect(comparison.baseline).toEqual({
      output_root: path.join(reportsRoot, "reports", "political-backtest", "AAPL", "run-2"),
      generated_at: "2026-01-02T08:00:00.000Z",
    })
    expect(comparison.event_sample).toEqual({
      current: 2,
      baseline: 2,
      new_events: ["evt-3"],
      removed_events: ["evt-1"],
      persisted_events: ["evt-2"],
    })
    expect(comparison.aggregate_drift[0]).toMatchObject({
      key: "transaction|5|SPY",
      baseline_sample_size: 4,
      current_sample_size: 5,
      sample_delta: 1,
      mean_excess_delta: 0.3,
    })
    expect(comparison.conclusion_changes).toEqual([
      {
        key: "transaction|5|SPY",
        benchmark_symbol: "SPY",
        window_sessions: 5,
        anchor_kind: "transaction",
        baseline_view: "underperform",
        current_view: "outperform",
      },
    ])
  })
})

describe("government-trading persistence", () => {
  test("clamps limits and creates run IDs from timestamps", () => {
    expect(clampLimit(Number.NaN)).toBe(50)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(999)).toBe(200)
    expect(createRunId("2026-01-02T03:04:05.000Z")).toBe("2026-01-02__03-04-05.000Z")
  })

  test("summarizes prior-run presence and consecutive streaks", () => {
    const trends = buildPersistenceTrends({
      runId: "2026-01-03__00-00-00.000Z",
      currentEvents: [event("evt-1"), event("evt-2", "MSFT")],
      historyRuns: [
        {
          runId: "2026-01-02__00-00-00.000Z",
          directory: "/tmp/run-2",
          normalizedEventsPath: "/tmp/run-2/events.json",
          assumptionsPath: "/tmp/run-2/assumptions.json",
          normalizedEvents: [event("evt-1")],
          assumptions: {},
        },
        {
          runId: "2026-01-01__00-00-00.000Z",
          directory: "/tmp/run-1",
          normalizedEventsPath: "/tmp/run-1/events.json",
          assumptionsPath: "/tmp/run-1/assumptions.json",
          normalizedEvents: [event("evt-1")],
          assumptions: {},
        },
      ],
    })

    expect(trends).toHaveLength(2)
    expect(trends[0]).toMatchObject({
      identity_key: "evt-1",
      seen_in_prior_runs: 2,
      seen_including_current: 3,
      total_runs_including_current: 3,
      persistence_ratio: 1,
      first_seen_run_id: "2026-01-01__00-00-00.000Z",
      last_seen_run_id: "2026-01-03__00-00-00.000Z",
      consecutive_run_streak: 3,
    })
    expect(trends[1]).toMatchObject({
      identity_key: "evt-2",
      seen_in_prior_runs: 0,
      seen_including_current: 1,
      total_runs_including_current: 3,
      persistence_ratio: 0.3333,
      first_seen_run_id: "2026-01-03__00-00-00.000Z",
      consecutive_run_streak: 1,
    })
  })
})
