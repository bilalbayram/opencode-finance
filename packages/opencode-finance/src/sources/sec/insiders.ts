import { XMLParser } from "fast-xml-parser"
import { type SecContext, TTL, filingDocumentUrl, secText } from "./client"
import { resolveCompany } from "./company"
import { listFilings } from "./filings"

// SEC Form 4 transaction codes (General Instructions, item 8).
export const TRANSACTION_CODES: Record<string, string> = {
  P: "open market or private purchase",
  S: "open market or private sale",
  V: "voluntarily reported early",
  A: "grant or award from the company",
  D: "disposition to the company",
  F: "shares withheld for exercise price or tax",
  I: "discretionary transaction",
  M: "exercise or conversion of exempt derivative",
  C: "conversion of derivative security",
  E: "expiration of short derivative position",
  H: "expiration or cancellation of long derivative position",
  O: "exercise of out-of-the-money derivative",
  X: "exercise of in-the-money or at-the-money derivative",
  G: "gift",
  L: "small acquisition",
  W: "acquisition or disposition by will or laws of descent",
  Z: "deposit into or withdrawal from voting trust",
  J: "other acquisition or disposition",
  K: "equity swap or similar instrument",
  U: "disposition due to tender of shares in change of control",
}

export type InsiderOwner = { name: string; cik: string; roles: string[]; officer_title: string | null }

export type InsiderTransaction = {
  security: string
  derivative: boolean
  date: string | null
  code: string | null
  code_meaning: string | null
  acquired_or_disposed: "A" | "D" | null
  shares: number | null
  price_per_share: number | null
  shares_owned_after: number | null
  ownership: "direct" | "indirect" | null
  ownership_nature: string | null
  footnotes: string[]
}

export type Form4 = {
  form: string
  period_of_report: string | null
  rule_10b5_1: boolean | null
  owners: InsiderOwner[]
  transactions: InsiderTransaction[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  isArray: (name) =>
    ["reportingOwner", "nonDerivativeTransaction", "derivativeTransaction", "footnote", "footnoteId"].includes(name),
})

function text(node: unknown): string | null {
  if (node === undefined || node === null) return null
  if (typeof node === "object") return text((node as Record<string, unknown>).value ?? (node as Record<string, unknown>)["#text"])
  const value = String(node).trim()
  return value || null
}

function num(node: unknown) {
  const value = text(node)
  if (value === null) return null
  const parsed = Number(value.replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function flag(node: unknown) {
  const value = text(node)?.toLowerCase()
  return value === "1" || value === "true"
}

function footnoteIds(node: unknown): string[] {
  if (!node || typeof node !== "object") return []
  const out: string[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === "footnoteId") out.push(...(value as { "@id": string }[]).map((item) => item["@id"]))
    else if (value && typeof value === "object") out.push(...footnoteIds(value))
  }
  return [...new Set(out)]
}

export function parseForm4(xml: string): Form4 {
  const doc = parser.parse(xml).ownershipDocument
  if (!doc) throw new Error("not an ownershipDocument")
  const notes = new Map<string, string>(
    ((doc.footnotes?.footnote ?? []) as Record<string, unknown>[]).map((item) => [
      String(item["@id"]),
      String(item["#text"] ?? "").replace(/\s+/g, " ").trim(),
    ]),
  )
  const owners: InsiderOwner[] = ((doc.reportingOwner ?? []) as Record<string, any>[]).map((owner) => {
    const rel = owner.reportingOwnerRelationship ?? {}
    const roles = [
      flag(rel.isDirector) && "director",
      flag(rel.isOfficer) && "officer",
      flag(rel.isTenPercentOwner) && "10% owner",
      flag(rel.isOther) && (text(rel.otherText) ?? "other"),
    ].filter(Boolean) as string[]
    return {
      name: text(owner.reportingOwnerId?.rptOwnerName) ?? "",
      cik: text(owner.reportingOwnerId?.rptOwnerCik) ?? "",
      roles,
      officer_title: text(rel.officerTitle),
    }
  })

  const rows = (items: Record<string, any>[] | undefined, derivative: boolean): InsiderTransaction[] =>
    (items ?? []).map((row) => {
      const code = text(row.transactionCoding?.transactionCode)
      const direct = text(row.ownershipNature?.directOrIndirectOwnership)
      const ad = text(row.transactionAmounts?.transactionAcquiredDisposedCode)
      return {
        security: text(row.securityTitle) ?? "",
        derivative,
        date: text(row.transactionDate)?.slice(0, 10) ?? null,
        code,
        code_meaning: code ? (TRANSACTION_CODES[code] ?? null) : null,
        acquired_or_disposed: ad === "A" || ad === "D" ? ad : null,
        shares: num(row.transactionAmounts?.transactionShares),
        price_per_share: num(row.transactionAmounts?.transactionPricePerShare),
        shares_owned_after: num(row.postTransactionAmounts?.sharesOwnedFollowingTransaction),
        ownership: direct === "D" ? "direct" : direct === "I" ? "indirect" : null,
        ownership_nature: text(row.ownershipNature?.natureOfOwnership),
        footnotes: footnoteIds(row).map((id) => notes.get(id) ?? id),
      }
    })

  return {
    form: text(doc.documentType) ?? "4",
    period_of_report: text(doc.periodOfReport),
    rule_10b5_1: doc.aff10b5One === undefined ? null : flag(doc.aff10b5One),
    owners,
    transactions: [
      ...rows(doc.nonDerivativeTable?.nonDerivativeTransaction, false),
      ...rows(doc.derivativeTable?.derivativeTransaction, true),
    ],
  }
}

// The submissions feed points at the XSL-rendered view (xslF345X06/form4.xml); the raw XML has the same name one level up.
export function rawXmlDocument(primaryDocument: string) {
  return primaryDocument.replace(/^xsl[^/]+\//, "")
}

export async function insiders(
  ctx: SecContext,
  input: string,
  options: { since?: string; until?: string; limit: number; includeAmendments: boolean },
) {
  const ref = await resolveCompany(ctx, input)
  const forms = options.includeAmendments ? ["4", "4/A"] : ["4"]
  const { name, filings } = await listFilings(ctx, ref.cik, { forms, since: options.since, until: options.until, limit: options.limit })

  const out = []
  for (const filing of filings) {
    if (!filing.primary_document) continue
    const url = filingDocumentUrl(ref.cik, filing.accession, rawXmlDocument(filing.primary_document))
    try {
      const parsed = parseForm4(await secText(ctx, url, TTL.archive, `Form ${filing.form} ${filing.accession}`))
      out.push({
        form: filing.form,
        accession: filing.accession,
        filed: filing.filed,
        period_of_report: parsed.period_of_report,
        rule_10b5_1: parsed.rule_10b5_1,
        owners: parsed.owners,
        transactions: parsed.transactions,
        filing_url: filing.index_url,
        document_url: url,
      })
    } catch (error) {
      ctx.collector.warn(`Could not parse ${filing.accession} (${url}): ${(error as Error).message}`)
    }
  }

  return { company: { ...ref, name }, filings: out.length, results: out }
}
