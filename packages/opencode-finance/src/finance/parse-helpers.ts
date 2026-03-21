/**
 * Shared parsing utilities used across finance providers.
 *
 * Each function converts loosely-typed API payloads into the strict types
 * expected by the normalised finance-data layer.
 */

/** Convert an unknown value to a string, returning `""` for null/undefined. */
export function asText(input: unknown): string {
  if (input === null || input === undefined) return ""
  return String(input)
}

/**
 * Parse a number from an unknown value.
 * Returns `null` (not `0`) when the value cannot be interpreted as a finite number.
 */
export function toNumber(input: unknown): number | null {
  const text = asText(input).replace(/,/g, "").trim()
  if (!text) return null
  const value = Number(text.replace(/[^0-9.-]/g, ""))
  if (!Number.isFinite(value)) return null
  return value
}

/**
 * Parse a percentage value.
 * Values with absolute value <= 1 are assumed to be ratios and are
 * multiplied by 100.
 */
export function toPercent(input: unknown): number | null {
  const value = toNumber(input)
  if (value === null) return null
  if (Math.abs(value) <= 1) return Number((value * 100).toFixed(6))
  return value
}

/**
 * Parse an ISO-8601 date string from an unknown value.
 * Handles both string dates and numeric timestamps (seconds or milliseconds).
 * Falls back to `new Date().toISOString()` when parsing fails.
 */
export function toIsoDate(input: unknown): string {
  const raw = asText(input).trim()
  if (!raw) return new Date().toISOString()
  const numeric = Number(raw)
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric > 9_999_999_999 ? numeric : numeric * 1000
    return new Date(ms).toISOString()
  }
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return new Date().toISOString()
  return date.toISOString()
}

/**
 * Parse a date-only string (YYYY-MM-DD) from an unknown value.
 * Falls back to today's date on empty input, and preserves raw text on parse failure.
 */
export function toDateOnly(input: unknown): string {
  const text = asText(input)
  if (!text) return new Date().toISOString().slice(0, 10)
  const date = new Date(text)
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10)
  return text
}

/** Build a headquarters string from city/state/country fields. */
export function headquarters(profile: Record<string, unknown>): string | null {
  const city = asText(profile.city).trim()
  const state = asText(profile.state).trim()
  const country = asText(profile.country).trim()
  const parts = [city, state, country].filter((item) => item.length > 0)
  if (!parts.length) return null
  return parts.join(", ")
}

/**
 * Extract an array of record objects from an unknown payload.
 * Non-array inputs yield an empty array; non-object items are filtered out.
 */
export function rows(input: unknown): Record<string, unknown>[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => (item && typeof item === "object" ? [item as Record<string, unknown>] : []))
}
