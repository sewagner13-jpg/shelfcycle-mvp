import test from "node:test";
import assert from "node:assert/strict";

import { extractPdfText } from "../src/lib/pdf-text-extractor.mjs";

test("extractPdfText reads simple literal text from a PDF stream", () => {
  const pdf = Buffer.from(`
%PDF-1.4
1 0 obj
<< /Length 92 >>
stream
BT
(Product Name: TEST-123) Tj
(Supplier: ClearEdge Test Supplier) Tj
ET
endstream
endobj
%%EOF
`, "latin1");
  const text = extractPdfText(pdf);

  assert.match(text, /Product Name: TEST-123/);
  assert.match(text, /Supplier: ClearEdge Test Supplier/);
});
