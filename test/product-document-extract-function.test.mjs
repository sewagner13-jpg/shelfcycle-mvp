import test from "node:test";
import assert from "node:assert/strict";

import productDocumentExtract from "../netlify/functions/product-document-extract.mjs";

function dataUrlFromTextPdf(text = "") {
  const pdf = Buffer.from(`
%PDF-1.4
1 0 obj
<< /Length 90 >>
stream
BT
(${text}) Tj
ET
endstream
endobj
%%EOF
`, "latin1");

  return `data:application/pdf;base64,${pdf.toString("base64")}`;
}

test("hosted product document extract function returns JSON for text PDFs", async () => {
  const response = await productDocumentExtract(new Request("https://example.test/api/product-document/extract", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      fileName: "sample-tds.pdf",
      mimeType: "application/pdf",
      dataUrl: dataUrlFromTextPdf("Product Name: ONGRONAT XP 1127")
    })
  }));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.source, "netlify");
  assert.match(payload.text, /ONGRONAT XP 1127/);
});
