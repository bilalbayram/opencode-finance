import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"

const packageDir = path.resolve(import.meta.dir, "../..")
const distEntrypoint = pathToFileURL(path.join(packageDir, "dist/index.js")).href
const expectedExports = [
  "AlphaVantageAuthPlugin",
  "FinancialModelingPrepAuthPlugin",
  "FinnhubAuthPlugin",
  "OpenCodeFinancePlugin",
  "PolygonAuthPlugin",
  "QuartrAuthPlugin",
  "QuiverQuantAuthPlugin",
  "SecEdgarAuthPlugin",
]

async function loadEntrypoint() {
  return import(distEntrypoint)
}

function createPluginInput() {
  return {
    client: {
      tui: {
        async showToast() {},
      },
    },
    project: {},
    directory: packageDir,
    worktree: packageDir,
    serverUrl: new URL("http://localhost"),
    $: {},
  }
}

function decode(bytes: Uint8Array<ArrayBufferLike>) {
  return new TextDecoder().decode(bytes)
}

describe("plugin package entrypoint contract", () => {
  test("exports only plugin functions", async () => {
    const entrypoint = await loadEntrypoint()
    const names = Object.keys(entrypoint).toSorted()

    expect(names).toEqual(expectedExports.toSorted())
    expect(names).not.toContain("default")
    expect(names).not.toContain("OpenCodeFinanceInternal")

    for (const value of Object.values(entrypoint)) {
      expect(typeof value).toBe("function")
    }
  })

  test("all exported plugins initialize without throwing", async () => {
    const entrypoint = await loadEntrypoint()
    const input = createPluginInput()

    for (const [name, plugin] of Object.entries(entrypoint)) {
      const hooks = await plugin(input as any)
      expect(hooks).toBeTruthy()
      expect(typeof hooks).toBe("object")
      expect(name.length).toBeGreaterThan(0)
    }
  })

  test("npm pack only publishes built runtime assets", () => {
    const npmCache = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-finance-npm-cache-"))
    const pack = Bun.spawnSync(["npm", "pack", "--dry-run", "--json", "."], {
      cwd: packageDir,
      env: {
        ...process.env,
        npm_config_cache: npmCache,
      },
      stderr: "pipe",
      stdout: "pipe",
    })

    expect(pack.exitCode).toBe(0)

    const raw = decode(pack.stdout).trim()
    expect(raw).toBeTruthy()

    const [{ files }] = JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>
    const paths = files.map((file) => file.path)

    expect(paths).toContain("package.json")
    expect(paths).toContain("README.md")
    expect(paths.some((file) => file.startsWith("dist/"))).toBe(true)

    for (const prefix of ["src/", "test/", ".desloppify/", ".claude/"]) {
      expect(paths.some((file) => file.startsWith(prefix))).toBe(false)
    }

    expect(paths).not.toContain("scorecard.png")
  })
})
