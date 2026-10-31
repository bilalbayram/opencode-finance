import { spawnSync } from "child_process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { expect, test } from "bun:test"

const packageDir = path.resolve(import.meta.dir, "..")

// Skill installers copy the folder straight from git, so the committed bundle must match the source.
test("skill/scripts/fin.mjs is up to date (run `bun run build`)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fin-bundle-"))
  try {
    const outfile = path.join(dir, "fin.mjs")
    const build = spawnSync("node", ["./scripts/build.mjs", "--outfile", outfile], { cwd: packageDir, encoding: "utf8" })
    expect(build.status, build.stderr).toBe(0)
    const [fresh, committed] = await Promise.all([
      fs.readFile(outfile, "utf8"),
      fs.readFile(path.join(packageDir, "skill", "scripts", "fin.mjs"), "utf8"),
    ])
    expect(committed === fresh).toBe(true)

    const run = spawnSync("node", [outfile, "--version"], { encoding: "utf8" })
    expect(run.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}, 60_000)
