import path from "path"
import z from "zod"
import {
  CREDENTIAL_PROVIDERS,
  MissingCredentialError,
  credentialStatus,
  findProvider,
  removeCredential,
  setCredential,
} from "../core/credentials"
import { SourceCollector } from "../core/envelope"
import { Paths, homeDir } from "../core/paths"
import { INTERVALS, RANGES, price } from "../sources/price"
import { companyProfile } from "../sources/sec/company"
import { document } from "../sources/sec/document"
import { METRICS, concept, facts, frames } from "../sources/sec/facts"
import { filings } from "../sources/sec/filings"
import { insiders } from "../sources/sec/insiders"
import { search } from "../sources/sec/search"
import { InstallError, bundledSkillDir, detectTargets, installSkill, legacyNotices, uninstallSkill, type Target } from "../install"
import { UsageError, buildToolArgs, splitArgv } from "./args"

type RunContext = { collector: SourceCollector; refresh: boolean; signal: AbortSignal }

export type Command<S extends z.ZodObject = z.ZodObject> = {
  path: string[]
  summary: string
  details?: string
  positional: string[]
  schema: S
  run(args: z.infer<S>, ctx: RunContext): Promise<unknown>
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
const company = z.string().min(1).describe("Ticker (AAPL, BRK-B) or SEC CIK")
const limit = (fallback: number, max: number) => z.number().int().min(1).max(max).default(fallback).describe(`Maximum rows (default ${fallback})`)

function command<S extends z.ZodObject>(input: Command<S>): Command {
  return input as unknown as Command
}

export const COMMANDS: Command[] = [
  command({
    path: ["sec", "company"],
    summary: "Company profile: CIK, name, tickers, SIC industry, fiscal year end, address, website",
    positional: ["company"],
    schema: z.object({ company }),
    run: (args, ctx) => companyProfile(ctx, args.company),
  }),
  command({
    path: ["sec", "filings"],
    summary: "Filing history with links to each document",
    positional: ["company"],
    schema: z.object({
      company,
      forms: z.array(z.string()).optional().describe("Form types, comma separated: 10-K,10-Q,8-K,DEF 14A,4,SC 13G"),
      since: date.optional().describe("Filed on or after YYYY-MM-DD"),
      until: date.optional().describe("Filed on or before YYYY-MM-DD"),
      limit: limit(20, 1000),
    }),
    run: (args, ctx) => filings(ctx, args.company, args),
  }),
  command({
    path: ["sec", "facts"],
    summary: "As-reported fundamentals from XBRL, one series per metric with the filing behind every value",
    details: `Metrics: ${Object.keys(METRICS).join(", ")}`,
    positional: ["company"],
    schema: z.object({
      company,
      period: z.enum(["annual", "quarterly"]).default("annual").describe("annual (fiscal years) or quarterly (3-month periods)"),
      metrics: z.array(z.string()).optional().describe("Subset of metrics, comma separated (default: all)"),
      limit: limit(5, 40).describe("Periods per metric (default 5)"),
    }),
    run: (args, ctx) => facts(ctx, args.company, { period: args.period, limit: args.limit, metrics: args.metrics }),
  }),
  command({
    path: ["sec", "concept"],
    summary: "Every reported value of one XBRL tag for one company",
    positional: ["company", "tag"],
    schema: z.object({
      company,
      tag: z.string().min(1).describe("XBRL tag, e.g. us-gaap:InventoryNet (taxonomy defaults to us-gaap)"),
      unit: z.string().optional().describe("Unit filter, e.g. USD, shares, USD/shares"),
      limit: limit(40, 1000),
    }),
    run: (args, ctx) => concept(ctx, args.company, args.tag, args),
  }),
  command({
    path: ["sec", "frames"],
    summary: "One XBRL tag across all filers for a calendar period (cross-company comparison)",
    positional: ["tag", "period"],
    schema: z.object({
      tag: z.string().min(1).describe("XBRL tag, e.g. us-gaap:Revenues"),
      period: z.string().describe("CY2025 (annual), CY2025Q3 (quarter) or CY2025Q4I (instant)"),
      unit: z.string().default("USD").describe("Unit (default USD; shares; USD/shares)"),
      order: z.enum(["desc", "asc"]).default("desc").describe("Sort by value"),
      limit: limit(50, 10000),
    }),
    run: (args, ctx) => frames(ctx, args.tag, args.period, args),
  }),
  command({
    path: ["sec", "search"],
    summary: "Full-text search inside EDGAR filings since 2001",
    positional: ["query"],
    schema: z.object({
      query: z.string().min(1).describe('Search text; quote exact phrases, e.g. "\\"going concern\\""'),
      company: company.optional(),
      forms: z.array(z.string()).optional().describe("Form types, comma separated"),
      since: date.optional().describe("Filed on or after YYYY-MM-DD"),
      until: date.optional().describe("Filed on or before YYYY-MM-DD"),
      limit: limit(20, 1000),
    }),
    run: (args, ctx) => search(ctx, args.query, args),
  }),
  command({
    path: ["sec", "insiders"],
    summary: "Insider transactions parsed from Form 4 XML (who, role, code, shares, price, holdings after, 10b5-1)",
    positional: ["company"],
    schema: z.object({
      company,
      since: date.optional().describe("Filed on or after YYYY-MM-DD"),
      until: date.optional().describe("Filed on or before YYYY-MM-DD"),
      limit: limit(20, 200).describe("Maximum Form 4 filings to parse (default 20)"),
      include_amendments: z.boolean().default(false).describe("Include 4/A amendments"),
    }),
    run: (args, ctx) =>
      insiders(ctx, args.company, { since: args.since, until: args.until, limit: args.limit, includeAmendments: args.include_amendments }),
  }),
  command({
    path: ["sec", "document"],
    summary: "Read a filing document from sec.gov as plain text, page by page or by searching for a phrase",
    positional: ["url"],
    schema: z.object({
      url: z.string().url().describe("A document_url from fin sec filings or fin sec search"),
      offset: z.number().int().min(0).default(0).describe("Character offset to start from"),
      length: z.number().int().min(1000).max(200_000).default(40_000).describe("Characters to return"),
      find: z.string().optional().describe('Return offsets and context for a phrase instead of text, e.g. "Risk Factors"'),
    }),
    run: (args, ctx) => document(ctx, args.url, args),
  }),
  command({
    path: ["price"],
    summary: "Last price, previous close and OHLCV bars (unofficial: Yahoo, then Nasdaq)",
    positional: ["symbol"],
    schema: z.object({
      symbol: z.string().min(1).describe("Ticker as the venue lists it, e.g. AAPL, BRK-B, THYAO.IS"),
      range: z.enum(RANGES).default("1mo").describe(`History window: ${RANGES.join(", ")}`),
      interval: z.enum(INTERVALS).default("1d").describe(`Bar size: ${INTERVALS.join(", ")}`),
    }),
    run: (args, ctx) => price(ctx, args.symbol, args),
  }),
]

const VERSION = process.env.FIN_VERSION ?? "dev"

export type Io = { stdout(text: string): void; stderr(text: string): void }

const defaultIo: Io = {
  stdout: (text) => process.stdout.write(text.endsWith("\n") ? text : `${text}\n`),
  stderr: (text) => process.stderr.write(text.endsWith("\n") ? text : `${text}\n`),
}

function usageLine(item: Command) {
  return `fin ${item.path.join(" ")} ${item.positional.map((key) => `<${key}>`).join(" ")}`.trim()
}

function usage() {
  const width = Math.max(...COMMANDS.map((item) => usageLine(item).length))
  return [
    "fin: finance data from primary sources. Output is JSON: {data, sources, warnings}.",
    "",
    ...COMMANDS.map((item) => `  ${usageLine(item).padEnd(width)}  ${item.summary}`),
    "",
    "Setup:",
    "  fin install [--agents agents,claude,gemini] [--dir <skills dir>] [--uninstall] [--sec-identity <value>]",
    "  fin auth list | fin auth set <provider> <value> | fin auth remove <provider>",
    "",
    "Global options:",
    "  --refresh       Bypass the local cache",
    "  --args <json>   Pass options as a JSON object",
    "  --help          Options for a command, e.g. fin sec facts --help",
  ].join("\n")
}

function describe(schema: z.ZodType) {
  return z.toJSONSchema(schema) as { description?: string; default?: unknown }
}

function commandHelp(item: Command) {
  const shape = item.schema.shape as Record<string, z.ZodType>
  const args = item.positional.map((key) => `  <${key}>  ${describe(shape[key]!).description ?? ""}`)
  const options = Object.entries(shape)
    .filter(([key]) => !item.positional.includes(key))
    .map(([key, schema]) => {
      const json = describe(schema)
      const fallback = json.default === undefined ? "" : ` [default: ${JSON.stringify(json.default)}]`
      return `  --${key.replace(/_/g, "-")}  ${json.description ?? ""}${fallback}`
    })
  return [
    usageLine(item),
    "",
    item.summary,
    ...(item.details ? ["", item.details] : []),
    "",
    "Arguments:",
    ...args,
    ...(options.length ? ["", "Options:", ...options] : []),
  ].join("\n")
}

function findCommand(words: string[]) {
  return COMMANDS.filter((item) => item.path.every((part, index) => words[index] === part)).sort(
    (a, b) => b.path.length - a.path.length,
  )[0]
}

async function runAuth(argv: string[], io: Io) {
  const [action = "list", id, ...rest] = argv
  if (action === "list") {
    const providers = await Promise.all(
      CREDENTIAL_PROVIDERS.map(async (provider) => {
        const found = await credentialStatus(provider.id)
        return { provider: provider.id, name: provider.name, set: Boolean(found), origin: found?.origin ?? null, env: provider.env, hint: provider.hint }
      }),
    )
    io.stdout(JSON.stringify({ credentials_file: Paths.credentials, providers }, null, 2))
    return 0
  }
  const provider = id ? findProvider(id) : undefined
  if (!provider) throw new UsageError(`auth ${action} needs a provider: ${CREDENTIAL_PROVIDERS.map((item) => item.id).join(", ")}`)
  if (action === "set") {
    const value = rest.join(" ").trim()
    if (!value) throw new UsageError(`auth set ${provider.id} needs a value. ${provider.hint}`)
    await setCredential(provider.id, value)
    io.stdout(JSON.stringify({ saved: provider.id, credentials_file: Paths.credentials }, null, 2))
    return 0
  }
  if (action === "remove") {
    await removeCredential(provider.id)
    io.stdout(JSON.stringify({ removed: provider.id, credentials_file: Paths.credentials }, null, 2))
    return 0
  }
  throw new UsageError(`unknown auth action "${action}". Use list, set or remove.`)
}

export type Prompt = (question: string) => Promise<string>

async function ttyPrompt(question: string) {
  const readline = await import("readline/promises")
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

async function runInstall(argv: string[], io: Io, prompt: Prompt | undefined) {
  const { positional, flags } = splitArgv(argv)
  const known = new Set(["agents", "dir", "uninstall", "sec-identity", "no-prompt", "prompt", "source"])
  for (const key of flags.keys()) if (!known.has(key)) throw new UsageError(`unknown option --${key} for fin install`)
  if (positional.length) throw new UsageError(`unexpected argument: ${positional.join(" ")}`)
  const last = (key: string) => flags.get(key)?.at(-1)

  // --dir alone means "only there"; otherwise install into every detected agent.
  let targets: Target[] = flags.has("dir") && !flags.has("agents") ? [] : await detectTargets()
  const wanted = flags.get("agents")?.flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean)
  if (wanted?.length) {
    const ids = ["agents", "claude", "gemini"]
    const unknown = wanted.filter((id) => !ids.includes(id))
    if (unknown.length) throw new UsageError(`unknown agent target(s): ${unknown.join(", ")}. Use ${ids.join(", ")}`)
    const home = homeDir()
    const all: Target[] = [
      { id: "agents", label: "Codex, Cursor, Copilot CLI, OpenCode", dir: path.join(home, ".agents", "skills") },
      { id: "claude", label: "Claude Code", dir: path.join(home, ".claude", "skills") },
      { id: "gemini", label: "Gemini CLI", dir: path.join(home, ".gemini", "skills") },
    ]
    targets = all.filter((target) => wanted.includes(target.id))
  }
  for (const dir of flags.get("dir") ?? []) targets.push({ id: "custom", label: "Custom", dir: path.resolve(dir) })

  const results = []
  for (const target of targets) {
    results.push(last("uninstall") === "true" ? await uninstallSkill(target) : await installSkill(last("source") ?? bundledSkillDir(), target))
  }
  const lines = results.map((item) => `  ${item.status.padEnd(9)} ${item.path}  (${item.target.label})`)

  if (last("uninstall") !== "true") {
    const identity = last("sec-identity")?.trim()
    if (identity) await setCredential("sec-edgar", identity)
    const current = await credentialStatus("sec-edgar")
    if (!current && prompt && last("prompt") !== "false") {
      io.stderr("SEC asks every client to identify itself. Your name and email are sent only to sec.gov as the User-Agent.")
      const answer = (await prompt('SEC identity, e.g. "Jane Doe jane@example.com" (leave empty to skip): ')).trim()
      if (answer) await setCredential("sec-edgar", answer)
    }
    const after = await credentialStatus("sec-edgar")
    lines.push(
      "",
      after
        ? `SEC identity: set (${after.origin})`
        : `SEC identity: not set. Before using SEC commands run:\n  node ${path.join(results[0]?.path ?? bundledSkillDir(), "scripts", "fin.mjs")} auth set sec-edgar "Your Name you@example.com"`,
    )
    const notices = await legacyNotices()
    if (notices.length) lines.push("", "Old plugin leftovers:", ...notices.map((notice) => `  - ${notice}`))
    lines.push("", "Restart your agent, then ask it for company data or a report, e.g. \"research AAPL\".")
  }

  io.stdout([last("uninstall") === "true" ? "Removed opencode-finance:" : `Installed opencode-finance ${VERSION}:`, ...lines].join("\n"))
  return 0
}

export async function runCli(
  argv: string[],
  io: Io = defaultIo,
  signal = new AbortController().signal,
  prompt: Prompt | undefined = process.stdin.isTTY ? ttyPrompt : undefined,
) {
  try {
    const [first] = argv
    if (!first || first === "help" || first === "--help" || first === "-h") {
      io.stdout(usage())
      return 0
    }
    if (first === "--version" || first === "version") {
      io.stdout(VERSION)
      return 0
    }
    if (first === "auth") return await runAuth(argv.slice(1), io)
    if (first === "install") return await runInstall(argv.slice(1), io, prompt)

    const item = findCommand(argv)
    if (!item) {
      const group = COMMANDS.filter((entry) => entry.path[0] === first)
      if (group.length) throw new UsageError(`"${first}" needs a subcommand: ${group.map((entry) => entry.path.slice(1).join(" ")).join(", ")}`)
      throw new UsageError(`unknown command "${argv.join(" ")}"`)
    }

    const parsed = splitArgv(argv.slice(item.path.length))
    if (parsed.flags.has("help")) {
      io.stdout(commandHelp(item))
      return 0
    }
    const refresh = parsed.flags.get("refresh")?.at(-1) === "true"
    parsed.flags.delete("refresh")

    const args = buildToolArgs({
      shape: item.schema.shape as Record<string, z.ZodType>,
      positional: parsed.positional,
      positionalKeys: item.positional,
      flags: parsed.flags,
    })
    const checked = item.schema.safeParse(args)
    if (!checked.success) throw new UsageError(`invalid arguments for ${usageLine(item)}:\n${z.prettifyError(checked.error)}`)

    const collector = new SourceCollector()
    const data = await item.run(checked.data, { collector, refresh, signal })
    io.stdout(JSON.stringify(collector.envelope(data), null, 2))
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof UsageError || error instanceof InstallError ? 2 : error instanceof MissingCredentialError ? 3 : 1
    io.stderr(JSON.stringify({ error: message, code }, null, 2))
    return code
  }
}
