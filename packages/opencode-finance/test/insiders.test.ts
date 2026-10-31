import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { parseForm4, rawXmlDocument } from "../src/sources/sec/insiders"

const fixture = (name: string) => fs.readFile(path.join(import.meta.dir, "fixtures", name), "utf8")

describe("parseForm4", () => {
  test("parses a real Form 4 with owner, 10b5-1 flag, transaction and footnote", async () => {
    const form = parseForm4(await fixture("form4-aapl.xml"))
    expect(form).toMatchObject({ form: "4", period_of_report: "2026-10-27", rule_10b5_1: true })
    expect(form.owners).toEqual([
      { name: "Newstead Jennifer", cik: "0001780525", roles: ["officer"], officer_title: "SVP, GC and Government Affairs" },
    ])
    expect(form.transactions).toEqual([
      {
        security: "Common Stock",
        derivative: false,
        date: "2026-10-27",
        code: "S",
        code_meaning: "open market or private sale",
        acquired_or_disposed: "D",
        shares: 2399,
        price_per_share: 343.36,
        shares_owned_after: 32396,
        ownership: "direct",
        ownership_nature: null,
        footnotes: ["This transaction was made pursuant to a Rule 10b5-1 trading plan adopted by the reporting person on May 5, 2026."],
      },
    ])
  })

  test("handles joint filers, derivative rows, indirect ownership and missing prices", () => {
    const xml = `<?xml version="1.0"?>
<ownershipDocument>
  <documentType>4</documentType>
  <periodOfReport>2025-03-01</periodOfReport>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>1</rptOwnerCik><rptOwnerName>Fund LP</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isTenPercentOwner>1</isTenPercentOwner></reportingOwnerRelationship>
  </reportingOwner>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>2</rptOwnerCik><rptOwnerName>Jane Director</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>true</isDirector><isOther>1</isOther><otherText>Fund manager</otherText></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2025-03-01-05:00</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1,000</value></transactionShares>
        <transactionPricePerShare><footnoteId id="F1"/></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>5000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
      <ownershipNature>
        <directOrIndirectOwnership><value>I</value></directOrIndirectOwnership>
        <natureOfOwnership><value>By trust</value></natureOfOwnership>
      </ownershipNature>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <derivativeTable>
    <derivativeTransaction>
      <securityTitle><value>Stock Option</value></securityTitle>
      <transactionDate><value>2025-03-01</value></transactionDate>
      <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>200</value></transactionShares>
        <transactionPricePerShare><value>0</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </derivativeTransaction>
  </derivativeTable>
  <footnotes><footnote id="F1">Weighted average price.</footnote></footnotes>
</ownershipDocument>`
    const form = parseForm4(xml)
    expect(form.rule_10b5_1).toBeNull()
    expect(form.owners.map((owner) => owner.roles)).toEqual([["10% owner"], ["director", "Fund manager"]])
    expect(form.transactions[0]).toMatchObject({
      date: "2025-03-01",
      shares: 1000,
      price_per_share: null,
      ownership: "indirect",
      ownership_nature: "By trust",
      footnotes: ["Weighted average price."],
    })
    expect(form.transactions[1]).toMatchObject({ derivative: true, code: "M", shares: 200, price_per_share: 0, shares_owned_after: null })
  })

  test("rejects documents that are not ownership filings", () => {
    expect(() => parseForm4("<html></html>")).toThrow(/ownershipDocument/)
  })
})

test("rawXmlDocument strips the XSL rendering directory", () => {
  expect(rawXmlDocument("xslF345X06/form4.xml")).toBe("form4.xml")
  expect(rawXmlDocument("wk-form4_123.xml")).toBe("wk-form4_123.xml")
})
