import crypto from "crypto"
import fs from "fs/promises"
import path from "path"
import { Paths } from "./paths"

export type FetchOptions = {
  headers?: Record<string, string>
  // Seconds a cached copy stays fresh. 0 disables caching.
  ttl: number
  refresh?: boolean
  signal?: AbortSignal
  // Minimum spacing between requests to the same host, in milliseconds.
  minIntervalMs?: number
  timeoutMs?: number
}

export type FetchResult = {
  url: string
  body: string
  fetchedAt: string
  cached: boolean
}

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    body: string,
  ) {
    super(`GET ${url} failed with HTTP ${status}${body ? `: ${body.slice(0, 200).replace(/\s+/g, " ").trim()}` : ""}`)
  }
}

const MAX_ATTEMPTS = 3
const lastRequestAt = new Map<string, number>()

function cacheFile(url: string) {
  const hash = crypto.createHash("sha256").update(url).digest("hex")
  return path.join(Paths.cache, "http", hash.slice(0, 2), `${hash}.json`)
}

async function readCache(url: string, ttl: number): Promise<FetchResult | undefined> {
  try {
    const entry = JSON.parse(await fs.readFile(cacheFile(url), "utf8")) as { url: string; body: string; fetchedAt: string }
    if (entry.url !== url) return
    if (Date.now() - Date.parse(entry.fetchedAt) > ttl * 1000) return
    return { ...entry, cached: true }
  } catch {
    return
  }
}

async function writeCache(result: FetchResult) {
  const file = cacheFile(result.url)
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    await fs.writeFile(temp, JSON.stringify({ url: result.url, body: result.body, fetchedAt: result.fetchedAt }))
    await fs.rename(temp, file)
  } catch {
    // A cache write failure must never fail the request.
  }
}

async function throttle(url: string, minIntervalMs: number, signal?: AbortSignal) {
  if (!minIntervalMs) return
  const host = new URL(url).host
  // Reserve the next slot synchronously so concurrent callers queue instead of racing.
  const slot = Math.max(Date.now(), (lastRequestAt.get(host) ?? 0) + minIntervalMs)
  lastRequestAt.set(host, slot)
  await sleep(slot - Date.now(), signal)
}

function sleep(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

function retryable(status: number) {
  return status === 429 || status >= 500
}

export async function getText(url: string, options: FetchOptions): Promise<FetchResult> {
  if (options.ttl > 0 && !options.refresh) {
    const cached = await readCache(url, options.ttl)
    if (cached) return cached
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await throttle(url, options.minIntervalMs ?? 0, options.signal)
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 20_000)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    try {
      const response = await fetch(url, { headers: options.headers, signal })
      const body = await response.text()
      if (!response.ok) {
        const error = new HttpError(url, response.status, body)
        if (!retryable(response.status) || attempt === MAX_ATTEMPTS) throw error
        lastError = error
      } else {
        const result = { url, body, fetchedAt: new Date().toISOString(), cached: false }
        if (options.ttl > 0) await writeCache(result)
        return result
      }
    } catch (error) {
      if (error instanceof HttpError && !retryable(error.status)) throw error
      if (options.signal?.aborted) throw error
      lastError = error
      if (attempt === MAX_ATTEMPTS) break
    }
    await sleep(500 * 2 ** (attempt - 1), options.signal)
  }
  throw lastError instanceof Error ? lastError : new Error(`GET ${url} failed: ${String(lastError)}`)
}

export async function getJson<T>(url: string, options: FetchOptions): Promise<FetchResult & { json: T }> {
  const result = await getText(url, options)
  try {
    return { ...result, json: JSON.parse(result.body) as T }
  } catch {
    throw new Error(`GET ${url} returned a non-JSON response: ${result.body.slice(0, 120).replace(/\s+/g, " ")}`)
  }
}
