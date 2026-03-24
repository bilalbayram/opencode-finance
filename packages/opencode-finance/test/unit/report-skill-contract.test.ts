import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"

const packageDir = path.resolve(import.meta.dir, "../..")
const skillPath = path.join(packageDir, "src", "skill", "finance-comprehensive-report.SKILL.md")

describe("finance report skill contract", () => {
  test("keeps the decision-first, evidence-tagged report structure", async () => {
    const text = await fs.readFile(skillPath, "utf8")

    expect(text).toContain("## Objective")
    expect(text).toContain("## Evidence Rules")
    expect(text).toContain("`Observed`")
    expect(text).toContain("`Needs verification`")
    expect(text).toContain("## Public Source Coverage")
    expect(text).toContain("## `report.md` Requirements")
    expect(text).toContain("`## Things the Market May Miss`")
    expect(text).toContain("`## Variant Perception and Market-Implied Expectations`")
    expect(text).toContain("`## Risk Assessment and Red-Team`")
    expect(text).toContain("`## Monitoring Dashboard`")
  })
})
