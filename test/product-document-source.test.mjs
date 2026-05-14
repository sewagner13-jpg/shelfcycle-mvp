import test from "node:test";
import assert from "node:assert/strict";

import {
  hasUsefulProductDocumentFields,
  mergeProductDocumentExtractionIntoResult,
  productDocumentTextQuality,
  shouldRunProductDocumentPdfAi
} from "../src/lib/product-document-source.mjs";

test("product document text quality rejects garbled PDF extraction output", () => {
  const text = "úýyb ¸¥Èä ýú ÿü A'J ÆÚåşÇÙÿ îÜãÇäï ûø ùü þþ ýüN3#F- àèò½Õá£ÇÛÁÖâ";
  const quality = productDocumentTextQuality(text);

  assert.equal(quality.readable, false);
  assert.equal(shouldRunProductDocumentPdfAi({ text }), true);
});

test("product document text quality accepts normal SDS/TDS text", () => {
  const text = [
    "Safety Data Sheet",
    "Product Name: ONGRONAT XP 1127",
    "CAS Number: 101-68-8",
    "Supplier: Wanhua Chemical",
    "Section 14 Transport information. Proper Shipping Name: Environmentally hazardous substance."
  ].join("\n");
  const quality = productDocumentTextQuality(text);

  assert.equal(quality.readable, true);
  assert.equal(shouldRunProductDocumentPdfAi({ text }), false);
});

test("structured product document extraction fields merge into analysis results", () => {
  const result = mergeProductDocumentExtractionIntoResult(
    {
      workflow: "new_product",
      fields: {
        productName: "Bad local parse",
        packaging: ""
      },
      aiDerivedFields: []
    },
    {
      fields: {
        documentType: "SDS",
        extractedText: "raw text should not become a field",
        productName: "ONGRONAT XP 1127",
        productFamily: "ONGRONAT XP 1127",
        packaging: "Drum"
      },
      aiDerivedFields: [
        {
          field: "productFamily",
          value: "ONGRONAT XP 1127",
          reason: "Product identity appears in the SDS header."
        }
      ],
      missingShelfCycleFields: ["Product Code"],
      shelfCycleNotes: ["Verify package size before ShelfCycle approval."],
      warnings: ["AI-derived fields require review."]
    }
  );

  assert.equal(hasUsefulProductDocumentFields(result.fields), true);
  assert.equal(result.fields.productName, "ONGRONAT XP 1127");
  assert.equal(result.fields.productFamily, "ONGRONAT XP 1127");
  assert.equal(result.fields.packaging, "Drum");
  assert.equal(result.fields.extractedText, undefined);
  assert.deepEqual(result.missingShelfCycleFields, ["Product Code"]);
  assert.ok(result.warnings.includes("AI-derived fields require review."));
});
