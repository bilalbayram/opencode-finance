import { spawnSync } from "node:child_process"
import { chmodSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const flag = process.argv.indexOf("--outfile")
const outfile = flag > 0 ? path.resolve(process.argv[flag + 1]) : path.join(packageDir, "skill", "scripts", "fin.mjs")
const { version } = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"))

rmSync(outfile, { force: true })

// One self-contained file so the skill folder runs anywhere Node 20+ is installed, with no npm install.
const build = spawnSync(
  "bun",
  [
    "build",
    "./src/cli/main.ts",
    "--outfile",
    outfile,
    "--target",
    "node",
    "--format",
    "esm",
    "--define",
    `process.env.FIN_VERSION=${JSON.stringify(version)}`,
  ],
  { cwd: packageDir, stdio: "inherit" },
)

if (build.status !== 0) process.exit(build.status ?? 1)
chmodSync(outfile, 0o755)
