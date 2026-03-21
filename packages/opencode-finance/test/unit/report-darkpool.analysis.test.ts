import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { readHistoricalRuns } from "../../src/tool/report-darkpool/analysis"

const tempRoots: string[] = []

async function createScopeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-darkpool-"))
  tempRoots.push(root)
  return root
}

async function writeEvidence(scopeRoot: string, date: string, content: string) {
  const runRoot = path.join(scopeRoot, date, "darkpool-anomaly")
  await fs.mkdir(runRoot, { recursive: true })
  await Bun.write(path.join(runRoot, "evidence.json"), content)
  return runRoot
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("readHistoricalRuns", () => {
  test("ignores malformed evidence, skips the current output root, and sorts surviving runs", async () => {
    const primaryRoot = await createScopeRoot()
    const secondaryRoot = await createScopeRoot()

    await writeEvidence(
      primaryRoot,
      "2026-01-01",
      JSON.stringify({
        generated_at: "2026-01-01T08:00:00.000Z",
        anomalies: [{ key: "AAPL" }],
      }),
    )

    await writeEvidence(primaryRoot, "2026-01-02", "{invalid-json")

    const currentOutputRoot = await writeEvidence(
      primaryRoot,
      "2026-01-03",
      JSON.stringify({
        generated_at: "2026-01-03T08:00:00.000Z",
        anomalies: [{ key: "MSFT" }],
      }),
    )

    await writeEvidence(
      secondaryRoot,
      "2026-01-04",
      JSON.stringify({
        generated_at: "2026-01-04T08:00:00.000Z",
        anomalies: [{ key: "NVDA" }],
      }),
    )

    await writeEvidence(
      secondaryRoot,
      "2026-01-05",
      JSON.stringify({
        generated_at: "2026-01-05T08:00:00.000Z",
        anomalies: "not-an-array",
      }),
    )

    const runs = await readHistoricalRuns({
      scopeRoots: [primaryRoot, secondaryRoot, path.join(primaryRoot, "missing")],
      outputRoot: currentOutputRoot,
    })

    expect(runs).toHaveLength(2)
    expect(runs.map((run) => run.generated_at)).toEqual(["2026-01-01T08:00:00.000Z", "2026-01-04T08:00:00.000Z"])
    expect(runs.map((run) => path.basename(path.dirname(run.path)))).toEqual(["darkpool-anomaly", "darkpool-anomaly"])
  })
})
