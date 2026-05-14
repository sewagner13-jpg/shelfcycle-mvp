import test from "node:test";
import assert from "node:assert/strict";

import {
  filterResolvedProductDocumentWarnings,
  hasUsefulProductDocumentFields,
  mergeProductDocumentExtractionIntoResult,
  productDocumentTextQuality,
  sanitizeProductDocumentResultForSource,
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

test("product document sanitize blocks inferred code copied from product name", () => {
  const result = sanitizeProductDocumentResultForSource(
    {
      workflow: "new_product",
      fields: {
        productName: "ONGRONAT XP 1127",
        productFamily: "MDI mixed isomers with polymeric MDI",
        code: "ONGRONAT XP 1127"
      },
      warnings: []
    },
    "Technical Data Sheet ONGRONAT XP 1127 Product Description: specialty isocyanate"
  );

  assert.equal(result.fields.code, "");
  assert.ok(result.warnings.some((warning) => /No explicit product SKU\/code/.test(warning)));
});

test("product document sanitize blocks garbage product code text", () => {
  const result = sanitizeProductDocumentResultForSource(
    {
      workflow: "new_product",
      fields: {
        productName: "ONGRONAT XP 1127",
        code: "Not given FreightClass: Not given Pallet: Not given DocumentDate: 05.04.2022 DocumentType: SDS"
      },
      warnings: []
    },
    "Safety Data Sheet ONGRONAT XP 1127"
  );

  assert.equal(result.fields.code, "");
  assert.ok(result.warnings.some((warning) => /No explicit product SKU\/code/.test(warning)));
});

test("product document sanitize keeps explicitly sourced product code", () => {
  const result = sanitizeProductDocumentResultForSource(
    {
      workflow: "new_product",
      fields: {
        productName: "ONGRONAT XP 1127",
        code: "XP1127-D"
      },
      warnings: []
    },
    "Product Code: XP1127-D"
  );

  assert.equal(result.fields.code, "XP1127-D");
});

test("resolved product warnings are removed after combined SDS/TDS fields are present", () => {
  const warnings = filterResolvedProductDocumentWarnings(
    [
      "Missing required Product Code field: Code (SKU/package code)",
      "Missing required Product Code field: Quantity per Package",
      "Missing family-level identifiers: CAS Number, UN/NA Number, Packing Group, Hazard Class, Special Designation, Proper Shipping Name, GHS Signal Word, Hazard Symbols"
    ],
    {
      code: "XP1127-D",
      quantityPerPackage: "225 kg",
      casNumber: "26447-40-5",
      unNumber: "Not regulated",
      packingGroup: "Not regulated",
      hazardClass: "6.1",
      properShippingName: "Not regulated",
      signalWord: "Danger",
      hazardSymbols: "Health Hazard"
    }
  );

  assert.deepEqual(warnings, ["Missing family-level identifiers: Special Designation"]);
});
