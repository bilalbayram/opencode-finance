import { expect, test } from "bun:test"
import { filingRows, matchesFiling } from "../src/sources/sec/filings"

const columns = {
  accessionNumber: ["0000320193-26-000018", "0001140361-26-041201"],
  filingDate: ["2026-07-30", "2026-10-29"],
  reportDate: ["2026-07-30", ""],
  acceptanceDateTime: ["2026-07-30T16:30:31.000Z", "2026-10-29T18:30:00.000Z"],
  form: ["8-K", "4"],
  items: ["2.02,9.01", ""],
  primaryDocument: ["aapl-20260730.htm", "xslF345X06/form4.xml"],
  primaryDocDescription: ["8-K", "PRIMARY DOCUMENT"],
}

test("filingRows builds document and index links from the column arrays", () => {
  const [eightK, form4] = filingRows("0000320193", columns)
  expect(eightK).toEqual({
    form: "8-K",
    accession: "0000320193-26-000018",
    filed: "2026-07-30",
    report_date: "2026-07-30",
    accepted_at: "2026-07-30T16:30:31.000Z",
    items: ["2.02", "9.01"],
    description: "8-K",
    primary_document: "aapl-20260730.htm",
    document_url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000018/aapl-20260730.htm",
    index_url: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000018/0000320193-26-000018-index.htm",
  })
  expect(form4!.report_date).toBeNull()
  expect(form4!.items).toEqual([])
})

test("matchesFiling filters by form (case and space insensitive) and filing date", () => {
  const [eightK] = filingRows("320193", columns)
  expect(matchesFiling(eightK!, { forms: ["8-k"] })).toBe(true)
  expect(matchesFiling(eightK!, { forms: ["10-K"] })).toBe(false)
  expect(matchesFiling(eightK!, { since: "2026-07-30", until: "2026-07-30" })).toBe(true)
  expect(matchesFiling(eightK!, { since: "2026-07-31" })).toBe(false)
  expect(matchesFiling(eightK!, { until: "2026-07-29" })).toBe(false)
})
