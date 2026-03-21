import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(scriptDir, "..")
const srcDir = path.join(packageDir, "src")
const distDir = path.join(packageDir, "dist")

rmSync(distDir, { force: true, recursive: true })

const tsc = spawnSync("bun", ["x", "tsc", "-p", "tsconfig.json"], {
  cwd: packageDir,
  stdio: "inherit",
})

if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1)
}

copyRuntimeAssets(srcDir)

function copyRuntimeAssets(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      copyRuntimeAssets(source)
      continue
    }

    if (!shouldCopyAsset(entry.name)) continue

    const relative = path.relative(srcDir, source)
    const target = path.join(distDir, relative)
    mkdirSync(path.dirname(target), { recursive: true })
    cpSync(source, target)
  }
}

function shouldCopyAsset(filename) {
  return filename.endsWith(".txt") || filename.endsWith(".SKILL.md")
}
