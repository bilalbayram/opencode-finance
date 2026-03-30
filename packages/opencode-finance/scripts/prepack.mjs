import { spawnSync } from "node:child_process"
import { cpSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(scriptDir, "..")
const distIndex = path.join(packageDir, "dist", "index.js")
const distOpenClaw = path.join(packageDir, "dist", "openclaw", "index.cjs")

if (!existsSync(distIndex) || !existsSync(distOpenClaw)) {
  const build = spawnSync("bun", ["run", "build"], {
    cwd: packageDir,
    stdio: "inherit",
  })

  if (build.status !== 0) {
    process.exit(build.status ?? 1)
  }
}

cpSync(path.resolve(packageDir, "../../README.md"), path.join(packageDir, "README.md"))

