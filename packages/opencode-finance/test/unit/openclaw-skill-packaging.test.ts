import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"

const packageDir = path.resolve(import.meta.dir, "../..")
const skillPath = path.join(packageDir, "skills", "report", "SKILL.md")

function frontmatterValue(frontmatter: string, key: string) {
  return frontmatter
    .split("\n")
    .find((line) => line.startsWith(`${key}:`))
    ?.slice(key.length + 1)
    .trim()
}

describe("OpenClaw skill packaging", () => {
  test("ships the bundled /report skill with the expected frontmatter", async () => {
    const text = await fs.readFile(skillPath, "utf8")
    const match = text.match(/^---\n([\s\S]*?)\n---/)

    expect(match).toBeTruthy()

    const frontmatter = match![1]
    expect(frontmatterValue(frontmatter, "name")).toBe("report")
    expect(frontmatterValue(frontmatter, "user-invocable")).toBe("true")
    expect(frontmatterValue(frontmatter, "disable-model-invocation")).toBe("true")
    expect(frontmatterValue(frontmatter, "metadata")).toContain('"skillKey": "opencode-finance-report"')
  })
})
