import { afterEach, describe, expect, test } from "bun:test"
import { Auth } from "../../src/core/auth"
import { Env } from "../../src/core/env"
import { ReportDarkpoolAnomalyInternal } from "../../src/features/reports/darkpool-anomaly/tool"

type AuthGet = typeof Auth.get
type EnvGet = typeof Env.get

const originalAuthGet: AuthGet = Auth.get
const originalEnvGet: EnvGet = Env.get

afterEach(() => {
  ;(Env as any).get = originalEnvGet
  ;(Auth as any).get = originalAuthGet
})

describe("report_darkpool_anomaly auth", () => {
  test("allows env-only Quiver keys without stored tier metadata", async () => {
    ;(Env as any).get = ((key: string) => (key === "QUIVER_QUANT_API_KEY" ? "env-key" : undefined)) as EnvGet
    ;(Auth as any).get = (async () => undefined) as AuthGet

    await expect(ReportDarkpoolAnomalyInternal.resolveAuth()).resolves.toEqual({
      key: "env-key",
      tier: "tier_1",
    })
  })
})
