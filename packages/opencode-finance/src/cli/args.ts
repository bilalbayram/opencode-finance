import z from "zod"

export class UsageError extends Error {}

export type ParsedArgv = {
  positional: string[]
  flags: Map<string, string[]>
}

export function splitArgv(argv: string[]): ParsedArgv {
  const positional: string[] = []
  const flags = new Map<string, string[]>()
  const push = (key: string, value: string) => flags.set(key, [...(flags.get(key) ?? []), value])

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--") {
      positional.push(...argv.slice(i + 1))
      break
    }
    if (!arg.startsWith("--")) {
      positional.push(arg)
      continue
    }
    const body = arg.slice(2)
    const eq = body.indexOf("=")
    if (eq >= 0) {
      push(body.slice(0, eq), body.slice(eq + 1))
      continue
    }
    if (body.startsWith("no-")) {
      push(body.slice(3), "false")
      continue
    }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith("--")) {
      push(body, "true")
      continue
    }
    push(body, next)
    i++
  }

  return { positional, flags }
}

function normalizeKey(key: string) {
  return key.replace(/[-_]/g, "").toLowerCase()
}

function unwrap(schema: z.ZodType): z.ZodType {
  const def = (schema as any).def
  if (def?.type === "optional" || def?.type === "default" || def?.type === "nullable") return unwrap(def.innerType)
  return schema
}

function coerceScalar(schema: z.ZodType, raw: string, key: string): unknown {
  const type = (unwrap(schema) as any).def?.type
  if (type === "number") {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new UsageError(`--${key} expects a number, got "${raw}"`)
    return value
  }
  if (type === "boolean") {
    if (raw === "true" || raw === "1" || raw === "yes") return true
    if (raw === "false" || raw === "0" || raw === "no") return false
    throw new UsageError(`--${key} expects true or false, got "${raw}"`)
  }
  return raw
}

function coerce(schema: z.ZodType, values: string[], key: string): unknown {
  const inner = unwrap(schema) as any
  if (inner.def?.type === "array") {
    return values
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => coerceScalar(inner.def.element, value, key))
  }
  if (values.length > 1) throw new UsageError(`--${key} was given more than once`)
  return coerceScalar(schema, values[0]!, key)
}

export function buildToolArgs(input: {
  shape: Record<string, z.ZodType>
  positional: string[]
  positionalKeys: string[]
  flags: Map<string, string[]>
  defaults?: Record<string, unknown>
}) {
  const keys = new Map(Object.keys(input.shape).map((key) => [normalizeKey(key), key]))
  const args: Record<string, unknown> = { ...input.defaults }

  const raw = input.flags.get("args")
  if (raw) {
    for (const value of raw) {
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch {
        throw new UsageError(`--args must be a JSON object, got: ${value}`)
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new UsageError(`--args must be a JSON object, got: ${value}`)
      }
      Object.assign(args, parsed)
    }
  }

  if (input.positional.length > input.positionalKeys.length) {
    const extra = input.positional.slice(input.positionalKeys.length).join(" ")
    throw new UsageError(`unexpected argument: ${extra}`)
  }
  input.positional.forEach((value, index) => {
    const key = input.positionalKeys[index]!
    args[key] = coerce(input.shape[key]!, [value], key)
  })

  for (const [flag, values] of input.flags) {
    if (flag === "args") continue
    const key = keys.get(normalizeKey(flag))
    if (!key) {
      const known = Object.keys(input.shape).map((item) => `--${item.replace(/_/g, "-")}`)
      throw new UsageError(`unknown option --${flag}. Known options: ${known.join(", ")}`)
    }
    args[key] = coerce(input.shape[key]!, values, flag)
  }

  return args
}
