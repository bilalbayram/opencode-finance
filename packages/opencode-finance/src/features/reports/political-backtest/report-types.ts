import type { QuiverTier } from "../../../integrations/finance/quiver-tier"
import type { BenchmarkMode, EventAnchorMode } from "./types"

export type BacktestMetadata = {
  mode: "ticker" | "portfolio"
  ticker?: string
  tickers: string[]
  anchor_mode: EventAnchorMode
  windows: number[]
  benchmark_mode: BenchmarkMode
  quiver_tier: QuiverTier
  output_root: string
  report_path: string
  dashboard_path: string
  assumptions_path: string
  raw_paths: string[]
  events: number
}

export type BacktestArtifactPaths = {
  reportPath: string
  dashboardPath: string
  assumptionsPath: string
  eventsPath: string
  windowReturnsPath: string
  benchmarkReturnsPath: string
  aggregatePath: string
  comparisonPath: string
}
