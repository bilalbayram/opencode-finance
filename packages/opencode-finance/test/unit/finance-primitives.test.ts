import { afterEach, describe, expect, test } from "bun:test"
import { FINANCE_AUTH_PROVIDER, FINANCE_AUTH_PROVIDER_ID } from "../../src/integrations/finance/auth-provider"
import { FinanceCache } from "../../src/integrations/finance/cache"
import { headquarters, rows, asText, toDateOnly, toIsoDate, toNumber, toPercent } from "../../src/integrations/finance/parse-helpers"
import { isValidSymbol, toUpperSymbol } from "../../src/features/reports/political-backtest/symbol"
import {
  QUIVER_TIER_FALLBACK_WARNING,
  endpointMinimumPlan,
  normalizeQuiverTier,
  quiverPlanLabel,
  resolveQuiverTierFromAuth,
  tierAllows,
} from "../../src/integrations/finance/quiver-tier"
import type { NormalizedFinanceQuery } from "../../src/integrations/finance/types"

const originalDateNow = Date.now

const baseQuery: NormalizedFinanceQuery = {
  query: "aapl quote",
  intent: "quote",
  ticker: "aapl",
  coverage: "default",
  limit: 5,
}

function setNow(value: number) {
  ;(Date as any).now = () => value
}

afterEach(() => {
  ;(Date as any).now = originalDateNow
})

describe("finance auth providers", () => {
  test("keeps every provider ID addressable from the provider map", () => {
    expect(new Set(Object.keys(FINANCE_AUTH_PROVIDER))).toEqual(new Set(FINANCE_AUTH_PROVIDER_ID))
    expect(FINANCE_AUTH_PROVIDER["sec-edgar"]).toMatchObject({
      name: "SEC EDGAR",
      credential: "identity",
      env: ["SEC_EDGAR_IDENTITY", "SEC_API_USER_AGENT"],
    })
  })
})

describe("FinanceCache", () => {
  test("builds stable cache keys and respects TTL expiry", () => {
    const cache = new FinanceCache()
    expect(cache.getKey(baseQuery)).toBe("AAPL:quote:default:auto::5")

    setNow(1_000)
    cache.set(baseQuery, { price: 123 }, "quote")

    setNow(300_000)
    expect(cache.get<{ price: number }>(baseQuery)).toEqual({ price: 123 })

    setNow(302_000)
    expect(cache.get(baseQuery)).toBeNull()
  })

  test("clears all cached values", () => {
    const cache = new FinanceCache()
    setNow(1_000)
    cache.set(baseQuery, { price: 123 }, "quote")
    cache.clear()
    expect(cache.get(baseQuery)).toBeNull()
  })
})

describe("parse helpers", () => {
  test("normalizes text, numbers, and percentages", () => {
    expect(asText(null)).toBe("")
    expect(toNumber("$1,234.50")).toBe(1234.5)
    expect(toNumber("n/a")).toBeNull()
    expect(toPercent("0.125")).toBe(12.5)
    expect(toPercent("15")).toBe(15)
  })

  test("formats dates and record collections consistently", () => {
    expect(toIsoDate("1704067200")).toBe("2024-01-01T00:00:00.000Z")
    expect(toDateOnly("2024-01-02T15:30:00Z")).toBe("2024-01-02")
    expect(toDateOnly("not-a-date")).toBe("not-a-date")
    expect(headquarters({ city: "New York", state: "NY", country: "USA" })).toBe("New York, NY, USA")
    expect(rows([{ id: 1 }, null, "ignored", 7, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }])
  })
})

describe("symbol helpers", () => {
  test("normalizes symbols and validates exchange-style tickers", () => {
    expect(toUpperSymbol(" brk.b ")).toBe("BRK.B")
    expect(toUpperSymbol("   ")).toBeNull()
    expect(isValidSymbol("BRK.B")).toBeTrue()
    expect(isValidSymbol("too-long-symbol")).toBeFalse()
  })
})

describe("quiver tier helpers", () => {
  test("normalizes aliases and exposes plan labels", () => {
    expect(normalizeQuiverTier("public")).toBe("tier_1")
    expect(normalizeQuiverTier("hobbyist")).toBe("tier_2")
    expect(normalizeQuiverTier("T3")).toBe("tier_3")
    expect(normalizeQuiverTier("enterprise")).toBe("enterprise")
    expect(quiverPlanLabel("tier_2")).toBe("Hobbyist (Tier 0 + Tier 1)")
    expect(endpointMinimumPlan("tier_2")).toBe("Trader (Tier 0 + Tier 1 + Tier 2)")
  })

  test("derives access and auth fallback metadata", () => {
    expect(tierAllows("tier_1", "tier_1")).toBeFalse()
    expect(tierAllows("tier_1", "tier_2")).toBeTrue()

    expect(resolveQuiverTierFromAuth(undefined)).toEqual({
      tier: "tier_1",
      inferred: true,
      warning: QUIVER_TIER_FALLBACK_WARNING,
    })

    expect(
      resolveQuiverTierFromAuth({
        type: "api",
        key: "quiver-key",
        provider_tier: "tier_3",
        provider_tag: "quiver-quant",
      }),
    ).toEqual({
      tier: "tier_3",
      inferred: false,
      warning: undefined,
    })
  })
})
