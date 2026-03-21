import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"

const packageDir = path.resolve(import.meta.dir, "../..")
const distEntrypoint = pathToFileURL(path.join(packageDir, "dist/index.js")).href
const openClawEntrypoint = pathToFileURL(path.join(packageDir, "dist/openclaw/index.cjs")).href
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

async function loadOpenClawPlugin() {
  const entrypoint = await import(openClawEntrypoint)
  const plugin = (entrypoint.default as { default?: unknown })?.default ?? entrypoint.default
  return plugin as {
    register(api: {
      registerTool(factory: unknown, options?: { names?: string[] }): void
    }): Promise<void> | void
  }
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

function parsePackFiles(raw: string) {
  const match = raw.match(/(\[\s*\{[\s\S]*\}\s*\])\s*$/)
  if (!match) {
    throw new Error(`Unable to locate npm pack JSON payload in output:\n${raw}`)
  }
  return JSON.parse(match[1]) as Array<{ files: Array<{ path: string }> }>
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

  test("built OpenClaw entrypoint imports under Node without Bun globals", () => {
    const script = `import(${JSON.stringify(openClawEntrypoint)}).then(() => {}).catch((error) => { console.error(error); process.exit(1); })`
    const proc = Bun.spawnSync(["node", "--input-type=module", "--eval", script], {
      cwd: packageDir,
      stderr: "pipe",
      stdout: "pipe",
    })

    expect(proc.exitCode).toBe(0)
  })

  test("OpenClaw plugin registers only the v1 report tools", async () => {
    const plugin = await loadOpenClawPlugin()
    const registrations: Array<{ options?: { names?: string[] } }> = []

    await plugin.register({
      registerTool(factory, options) {
        expect(typeof factory).toBe("function")
        registrations.push({ options })
      },
    })

    expect(registrations).toHaveLength(2)
    expect(registrations.map((entry) => entry.options?.names?.[0]).toSorted()).toEqual(["financial_search", "report_pdf"])
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

    const [{ files }] = parsePackFiles(raw)
    const paths = files.map((file) => file.path)

    expect(paths).toContain("package.json")
    expect(paths).toContain("README.md")
    expect(paths).toContain("openclaw.plugin.json")
    expect(paths).toContain("skills/report/SKILL.md")
    expect(paths.some((file) => file.startsWith("dist/"))).toBe(true)
    expect(paths).toContain("dist/openclaw/index.cjs")

    for (const prefix of ["src/", "test/", ".desloppify/", ".claude/"]) {
      expect(paths.some((file) => file.startsWith(prefix))).toBe(false)
    }

    expect(paths).not.toContain("scorecard.png")
  })
})
