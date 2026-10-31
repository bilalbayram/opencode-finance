import { describe, expect, test } from "bun:test"
import { parseNasdaq, parseYahoo } from "../src/sources/price"

// 2026-10-28, 10-29 and 10-30 at 13:30 UTC (09:30 New York).
const DAYS = [1793194200, 1793280600, 1793367000]

function yahoo(meta: Record<string, unknown>, close: (number | null)[]) {
  return {
    chart: {
      result: [
        {
          meta: { symbol: "AAPL", currency: "USD", exchangeTimezoneName: "America/New_York", fullExchangeName: "NasdaqGS", ...meta },
          timestamp: DAYS,
          indicators: { quote: [{ open: close, high: close, low: close, close, volume: [1, 2, 3] }], adjclose: [{ adjclose: close }] },
        },
      ],
      error: null,
    },
  }
}

describe("parseYahoo", () => {
  test("previous close is the prior session, never chartPreviousClose (the close before the range)", () => {
    const data = parseYahoo(yahoo({ regularMarketPrice: 105, regularMarketTime: DAYS[2]! + 23_400, chartPreviousClose: 50 }, [98, 100, 105]), "1mo", "1d")
    expect(data.last).toEqual({ price: 105, time: "2026-10-30T20:00:00.000Z", session_date: "2026-10-30" })
    expect(data.previous_close).toBe(100)
    expect(data.change).toBe(5)
    expect(data.change_percent).toBe(5)
    expect(data.bars.map((bar) => bar.date)).toEqual(["2026-10-28", "2026-10-29", "2026-10-30"])
  })

  test("skips null closes and rounds float32 noise", () => {
    const data = parseYahoo(yahoo({ regularMarketPrice: 344.6300048828125, regularMarketTime: DAYS[2] }, [98, null, 344.6300048828125]), "5d", "1d")
    expect(data.previous_close).toBe(98)
    expect(data.last.price).toBe(344.63)
    expect(data.bars[2]!.close).toBe(344.63)
  })

  test("leaves previous close empty for non-daily bars", () => {
    const data = parseYahoo(yahoo({ regularMarketPrice: 105, regularMarketTime: DAYS[2] }, [98, 100, 105]), "1y", "1wk")
    expect(data.previous_close).toBeNull()
    expect(data.change).toBeNull()
  })

  test("surfaces Yahoo errors", () => {
    expect(() => parseYahoo({ chart: { result: [], error: { code: "Not Found", description: "No data found" } } }, "1mo", "1d")).toThrow("No data found")
  })
})

test("parseNasdaq converts US dates and currency strings, oldest first", () => {
  const data = parseNasdaq(
    {
      data: {
        symbol: "AAPL",
        tradesTable: {
          rows: [
            { date: "10/30/2026", close: "$344.63", volume: "67,841,560", open: "$346.715", high: "$349.19", low: "$334.35" },
            { date: "10/29/2026", close: "$348.91", volume: "42,582,130", open: "$348.00", high: "$351.43", low: "$347.30" },
          ],
        },
      },
    },
    "aapl",
    "5d",
  )
  expect(data.symbol).toBe("AAPL")
  expect(data.bars[0]).toEqual({ date: "2026-10-29", open: 348, high: 351.43, low: 347.3, close: 348.91, adj_close: null, volume: 42582130 })
  expect(data.last).toEqual({ price: 344.63, time: null, session_date: "2026-10-30" })
  expect(data.previous_close).toBe(348.91)
})
