import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"

const packageDir = path.resolve(import.meta.dir, "../..")
const repoRoot = path.resolve(packageDir, "../..")
const canonicalSkillPath = path.join(packageDir, "src", "skill", "finance-comprehensive-report.SKILL.md")
const installScriptPath = path.join(repoRoot, "packages", "web", "public", "install.sh")

function extractEmbeddedSkill(text: string) {
  const match = text.match(/FINANCE_SKILL_CONTENT = """([\s\S]*?)"""/)
  if (!match) {
    throw new Error("Unable to locate FINANCE_SKILL_CONTENT in install.sh")
  }
  return match[1]
}

describe("installer skill sync", () => {
  test("embeds the canonical finance-comprehensive-report skill content", async () => {
    const [canonicalSkill, installScript] = await Promise.all([
      fs.readFile(canonicalSkillPath, "utf8"),
      fs.readFile(installScriptPath, "utf8"),
    ])

    expect(extractEmbeddedSkill(installScript)).toBe(canonicalSkill)
  })
})
