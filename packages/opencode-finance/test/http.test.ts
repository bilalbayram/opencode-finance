import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { HttpError, getText } from "../src/core/http"

let server: ReturnType<typeof Bun.serve>
let hits: Record<string, number> = {}
let cacheDir = ""
const savedCache = process.env.FINANCE_CACHE_DIR

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url)
      hits[pathname] = (hits[pathname] ?? 0) + 1
      if (pathname === "/flaky" && hits[pathname]! < 2) return new Response("busy", { status: 503 })
      if (pathname === "/missing") return new Response("nope", { status: 404 })
      return new Response(`body ${hits[pathname]}`)
    },
  })
})

afterAll(() => server.stop(true))

beforeEach(async () => {
  hits = {}
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "fin-http-"))
  process.env.FINANCE_CACHE_DIR = cacheDir
})

afterEach(async () => {
  if (savedCache === undefined) delete process.env.FINANCE_CACHE_DIR
  else process.env.FINANCE_CACHE_DIR = savedCache
  await fs.rm(cacheDir, { recursive: true, force: true })
})

const url = (pathname: string) => `http://localhost:${server.port}${pathname}`

describe("getText", () => {
  test("serves fresh copies from the cache with their original fetch time", async () => {
    const first = await getText(url("/data"), { ttl: 60 })
    const second = await getText(url("/data"), { ttl: 60 })
    expect(first.cached).toBe(false)
    expect(second).toEqual({ ...first, cached: true })
    expect(hits["/data"]).toBe(1)
  })

  test("refresh and ttl 0 bypass the cache", async () => {
    await getText(url("/data"), { ttl: 60 })
    expect((await getText(url("/data"), { ttl: 60, refresh: true })).body).toBe("body 2")
    expect((await getText(url("/data"), { ttl: 0 })).body).toBe("body 3")
  })

  test("retries server errors and fails fast on client errors", async () => {
    expect((await getText(url("/flaky"), { ttl: 0 })).body).toBe("body 2")
    await expect(getText(url("/missing"), { ttl: 0 })).rejects.toBeInstanceOf(HttpError)
    expect(hits["/missing"]).toBe(1)
  })

  test("spaces requests to the same host", async () => {
    const started = Date.now()
    await Promise.all([1, 2, 3].map((index) => getText(url(`/spaced-${index}`), { ttl: 0, minIntervalMs: 100 })))
    expect(Date.now() - started).toBeGreaterThanOrEqual(190)
  })
})
