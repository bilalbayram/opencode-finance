import fs from "fs/promises"
import os from "os"
import path from "path"
import z from "zod"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { COMMANDS, runCli } from "../src/cli"
import { UsageError, buildToolArgs, splitArgv } from "../src/cli/args"

const ENV_KEYS = ["FINANCE_CREDENTIALS_FILE", "XDG_DATA_HOME", "SEC_EDGAR_IDENTITY", "SEC_API_USER_AGENT"]
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
let root = ""

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fin-cli-"))
  process.env.FINANCE_CREDENTIALS_FILE = path.join(root, "config", "credentials.json")
  process.env.XDG_DATA_HOME = path.join(root, "data")
  delete process.env.SEC_EDGAR_IDENTITY
  delete process.env.SEC_API_USER_AGENT
})

afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await fs.rm(root, { recursive: true, force: true })
})

function capture() {
  const out: string[] = []
  const err: string[] = []
  return {
    io: { stdout: (text: string) => void out.push(text), stderr: (text: string) => void err.push(text) },
    out: () => out.join(""),
    err: () => err.join(""),
  }
}

const shape = {
  company: z.string().optional(),
  output_root: z.string().optional(),
  limit: z.number().int().optional(),
  include_amendments: z.boolean().optional(),
  forms: z.array(z.string()).optional(),
}

function args(argv: string[], positionalKeys: string[] = []) {
  const parsed = splitArgv(argv)
  return buildToolArgs({ shape, positional: parsed.positional, positionalKeys, flags: parsed.flags })
}

describe("argument parsing", () => {
  test("coerces by schema type and maps kebab-case flags to schema keys", () => {
    expect(args(["AAPL", "--limit", "5", "--include-amendments", "--output-root=out", "--forms", "10-K,8-K", "--forms", "DEF 14A"], ["company"])).toEqual({
      company: "AAPL",
      limit: 5,
      include_amendments: true,
      output_root: "out",
      forms: ["10-K", "8-K", "DEF 14A"],
    })
  })

  test("supports --no-flag and --args JSON", () => {
    expect(args(["--no-include-amendments", "--args", '{"company":"MSFT","limit":3}'])).toEqual({
      include_amendments: false,
      company: "MSFT",
      limit: 3,
    })
  })

  test("rejects unknown options, bad numbers and extra positionals", () => {
    expect(() => args(["--bogus", "1"])).toThrow(UsageError)
    expect(() => args(["--limit", "abc"])).toThrow(/expects a number/)
    expect(() => args(["AAPL", "MSFT"], ["company"])).toThrow(/unexpected argument: MSFT/)
  })
})

describe("runCli", () => {
  test("every command's positionals are schema keys", () => {
    for (const item of COMMANDS) {
      for (const key of item.positional) expect(Object.keys(item.schema.shape)).toContain(key)
    }
  })

  test("usage errors exit 2 with JSON on stderr", async () => {
    for (const argv of [["sec"], ["nope"], ["sec", "facts", "AAPL", "--period", "weekly"], ["sec", "filings", "AAPL", "--since", "2025/01/01"]]) {
      const io = capture()
      expect(await runCli(argv, io.io)).toBe(2)
      expect(JSON.parse(io.err())).toMatchObject({ code: 2 })
    }
  })

  test("command help lists options with defaults", async () => {
    const io = capture()
    expect(await runCli(["sec", "facts", "--help"], io.io)).toBe(0)
    expect(io.out()).toContain("--period")
    expect(io.out()).toContain('[default: "annual"]')
    expect(io.out()).toContain("revenue, cost_of_revenue")
  })

  test("SEC commands without an identity exit 3 and say how to fix it", async () => {
    const io = capture()
    expect(await runCli(["sec", "company", "AAPL"], io.io)).toBe(3)
    expect(JSON.parse(io.err()).error).toContain('fin auth set sec-edgar "<value>"')
  })

  test("auth set writes a private file that auth list reports", async () => {
    expect(await runCli(["auth", "set", "sec-edgar", "Jane", "Doe", "jane@example.com"], capture().io)).toBe(0)
    const file = process.env.FINANCE_CREDENTIALS_FILE!
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ "sec-edgar": { type: "api", key: "Jane Doe jane@example.com" } })
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)

    const io = capture()
    expect(await runCli(["auth", "list"], io.io)).toBe(0)
    expect(JSON.parse(io.out()).providers[0]).toMatchObject({ provider: "sec-edgar", set: true, origin: file })

    expect(await runCli(["auth", "remove", "sec-edgar"], capture().io)).toBe(0)
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({})
    expect(await runCli(["auth", "set", "not-a-provider", "x"], capture().io)).toBe(2)
  })

  test("reads the identity saved by the retired OpenCode installer", async () => {
    const legacy = path.join(process.env.XDG_DATA_HOME!, "opencode", "auth.json")
    await fs.mkdir(path.dirname(legacy), { recursive: true })
    await fs.writeFile(legacy, JSON.stringify({ "sec-edgar": { type: "api", key: "Old User old@example.com" } }))
    const io = capture()
    await runCli(["auth", "list"], io.io)
    expect(JSON.parse(io.out()).providers[0]).toMatchObject({ set: true, origin: legacy })
  })
})
