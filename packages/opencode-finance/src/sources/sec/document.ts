import { type SecContext, TTL, secText } from "./client"

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: "-", ndash: "-", bull: "*", hellip: "..." }

function decode(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const value = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1))
      if (value === 160) return " "
      return Number.isFinite(value) ? String.fromCodePoint(value) : match
    }
    return ENTITIES[code.toLowerCase()] ?? match
  })
}

// Filing HTML (including inline XBRL) to readable text; table cells become " | " separated rows.
export function htmlToText(html: string) {
  const text = html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/(td|th)\s*>/gi, " | ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
  return decode(text)
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t ]+/g, " ")
        .replace(/(\s*\|\s*)+$/, "")
        .replace(/^(\s*\|\s*)+/, "")
        .replace(/(\s*\|\s*){2,}/g, " | ")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export async function document(
  ctx: SecContext,
  url: string,
  options: { offset: number; length: number; find?: string },
) {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" || !/(^|\.)sec\.gov$/.test(parsed.hostname)) {
    throw new Error("fin sec document only reads https://www.sec.gov documents; fetch other sites with your own tools")
  }
  const raw = await secText(ctx, url, TTL.archive, "Filing document")
  const text = /\.html?$/i.test(parsed.pathname) || /^\s*<(!doctype html|html)/i.test(raw) ? htmlToText(raw) : raw

  if (options.find) {
    const needle = options.find.toLowerCase()
    const haystack = text.toLowerCase()
    const matches = []
    for (let at = haystack.indexOf(needle); at >= 0 && matches.length < 50; at = haystack.indexOf(needle, at + needle.length)) {
      matches.push({ offset: at, context: text.slice(Math.max(0, at - 150), at + needle.length + 150).replace(/\s+/g, " ") })
    }
    return { url, total_length: text.length, find: options.find, matches }
  }

  const end = Math.min(text.length, options.offset + options.length)
  return {
    url,
    total_length: text.length,
    offset: options.offset,
    next_offset: end < text.length ? end : null,
    text: text.slice(options.offset, end),
  }
}
