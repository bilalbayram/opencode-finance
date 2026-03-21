import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Auth } from "../../src/auth"
import { Env } from "../../src/env"
import { Global } from "../../src/global"
import { Storage } from "../../src/storage/storage"
import { resolveQuiverAuth } from "../../src/tool/_shared/resolve-auth"
import { writeToolArtifacts } from "../../src/tool/_shared/write-artifacts"
import { assertExternalDirectory } from "../../src/tool/external-directory"
import { abortAfter, abortAfterAny } from "../../src/util/abort"

type AuthGet = typeof Auth.get
type EnvGet = typeof Env.get
type StoredAuth = Awaited<ReturnType<typeof Auth.get>>

const originalAuthGet: AuthGet = Auth.get
const originalEnvGet: EnvGet = Env.get
const tempRoots: string[] = []

function setCredentialState(input: {
  env?: Record<string, string | undefined>
  authByProvider?: Record<string, StoredAuth | undefined>
}) {
  ;(Env as any).get = ((key: string) => input.env?.[key]) as EnvGet
  ;(Auth as any).get = (async (providerID: string) => input.authByProvider?.[providerID]) as AuthGet
}

async function createTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shared-"))
  tempRoots.push(root)
  return root
}

function createToolContext() {
  const asks: unknown[] = []
  return {
    asks,
    ctx: {
      directory: path.resolve(import.meta.dir, "..", ".."),
      worktree: path.resolve(import.meta.dir, "..", ".."),
      abort: new AbortController().signal,
      async ask(input: unknown) {
        asks.push(input)
      },
      metadata() {},
    } as any,
  }
}

afterEach(async () => {
  ;(Env as any).get = originalEnvGet
  ;(Auth as any).get = originalAuthGet
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("abort helpers", () => {
  test("abortAfter and abortAfterAny produce abortable signals", async () => {
    const timeout = abortAfter(1)
    await Bun.sleep(10)
    expect(timeout.signal.aborted).toBeTrue()
    timeout.clearTimeout()

    const upstream = new AbortController()
    const combined = abortAfterAny(1_000, upstream.signal)
    upstream.abort()
    expect(combined.signal.aborted).toBeTrue()
    combined.clearTimeout()
  })
})

describe("assertExternalDirectory", () => {
  test("asks only when the target escapes the worktree", async () => {
    const inside = createToolContext()
    await assertExternalDirectory(inside.ctx, path.join(inside.ctx.worktree, "reports", "report.md"))
    expect(inside.asks).toHaveLength(0)

    const outside = createToolContext()
    const externalPath = path.join(os.tmpdir(), "report.md")
    await assertExternalDirectory(outside.ctx, externalPath)

    expect(outside.asks).toEqual([
      {
        permission: "external_directory",
        patterns: [path.join(os.tmpdir(), "*")],
        always: [path.join(os.tmpdir(), "*")],
        metadata: {
          filepath: externalPath,
          parentDir: os.tmpdir(),
        },
      },
    ])
  })
})

describe("Global paths", () => {
  test("exposes stable app metadata and initialized directories", async () => {
    expect(Global.App).toEqual({
      name: "opencode",
      dot: ".opencode",
      files: ["opencode.jsonc", "opencode.json"],
    })
    expect(Global.Path.data).toEndWith(path.join("opencode"))
    expect(Global.Path.cache).toEndWith(path.join("opencode"))
    expect(Global.Path.config).toEndWith(path.join("opencode"))
    expect((await fs.stat(Global.Path.data)).isDirectory()).toBeTrue()
    expect((await fs.stat(Global.Path.log)).isDirectory()).toBeTrue()
  })
})

describe("Storage", () => {
  test("round-trips values and raises NotFoundError for missing keys", async () => {
    const key = ["codex-tests", `shared-${Date.now()}`]

    await expect(Storage.read(key)).rejects.toBeInstanceOf(Storage.NotFoundError)

    await Storage.write(key, { ok: true })
    await expect(Storage.read<{ ok: boolean }>(key)).resolves.toEqual({ ok: true })

    await Storage.remove(key)
    await expect(Storage.read(key)).rejects.toBeInstanceOf(Storage.NotFoundError)
  })
})

describe("resolveQuiverAuth", () => {
  test("returns env-backed credentials for tierless interactive use", async () => {
    setCredentialState({
      env: {
        QUIVER_QUANT_API_KEY: " env-key ",
      },
      authByProvider: {
        "quiver-quant": undefined,
      },
    })

    await expect(resolveQuiverAuth()).resolves.toEqual({
      key: "env-key",
      tier: "tier_1",
      inferred: true,
      warning:
        "Quiver plan metadata was not found in saved credentials. Defaulting to Public (Tier 0). Re-run `opencode auth login` and select `quiver-quant` to set the correct plan.",
    })
  })

  test("rejects insufficient stored tiers for required endpoint access", async () => {
    setCredentialState({
      authByProvider: {
        "quiver-quant": {
          type: "api",
          key: "quiver-key",
          provider_tier: "tier_1",
          provider_tag: "quiver-quant",
        },
      },
    })

    await expect(resolveQuiverAuth({ requiredEndpointTier: "tier_1", capabilityLabel: "off-exchange activity" })).rejects.toThrow(
      /Minimum required plan is Hobbyist \(Tier 0 \+ Tier 1\)/,
    )
  })
})

describe("writeToolArtifacts", () => {
  test("archives prior artifacts and requests the required permissions", async () => {
    const outputRoot = await createTempRoot()
    const reportPath = path.join(outputRoot, "report.md")
    await Bun.write(reportPath, "previous report")

    const tool = createToolContext()
    const written = await writeToolArtifacts({
      ctx: tool.ctx,
      outputRoot,
      files: {
        "report.md": "next report",
        "assumptions.json": "{}\n",
      },
      archivePaths: [reportPath],
    })

    expect(await Bun.file(written["report.md"]).text()).toBe("next report")
    expect(await Bun.file(written["assumptions.json"]).text()).toBe("{}\n")

    const historyEntries = await fs.readdir(path.join(outputRoot, "history"))
    expect(historyEntries).toHaveLength(1)
    expect(await Bun.file(path.join(outputRoot, "history", historyEntries[0], "report.md")).text()).toBe("previous report")

    expect((tool.asks as any[]).map((entry) => entry.permission)).toEqual(["external_directory", "edit"])
  })
})
