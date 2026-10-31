import { expect, test } from "bun:test"
import { htmlToText } from "../src/sources/sec/document"

test("htmlToText drops hidden XBRL headers and scripts, keeps tables as rows, decodes entities", () => {
  const html = `<html><head><title>x</title><style>p{}</style></head><body>
    <div style="display:none"><ix:header><ix:hidden>secret dei facts</ix:hidden></ix:header></div>
    <p>Item&#160;1A.&nbsp;Risk&nbsp;Factors</p><script>alert(1)</script>
    <table><tr><td>Revenue</td><td></td><td>$</td><td>416,161</td></tr><tr><td>Net&nbsp;income</td><td>112,010</td></tr></table>
    <p>Apple&#8217;s &amp; Co &lt;b&gt;</p><!-- comment -->
  </body></html>`
  expect(htmlToText(html)).toBe("Item 1A. Risk Factors\n\nRevenue | $ | 416,161\nNet income | 112,010\n\nApple’s & Co <b>")
})
