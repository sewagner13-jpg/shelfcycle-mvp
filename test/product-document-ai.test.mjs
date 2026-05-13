import test from "node:test";
import assert from "node:assert/strict";

import { mergeProductAiFields } from "../src/lib/product-document-ai.mjs";

test("mergeProductAiFields only fills blank product fields and records AI derivation", () => {
  const result = mergeProductAiFields(
    {
      fields: {
        code: "KNOWN-CODE",
        packaging: ""
      },
      warnings: []
    },
    {
      fields: {
        code: "AI-CODE",
        packaging: "Drum",
        quantityPerPackage: "500 lb"
      },
      aiDerivedFields: [
        {
          field: "packaging",
          value: "Drum",
          reason: "Packaging listed in SDS transport section."
        }
      ],
      warnings: ["Verify transport classification."]
    }
  );

  assert.equal(result.fields.code, "KNOWN-CODE");
  assert.equal(result.fields.packaging, "Drum");
  assert.equal(result.fields.quantityPerPackage, "500 lb");
  assert.deepEqual(result.aiDerivedFields.map((item) => `${item.field}:${item.value}`), [
    "packaging:Drum",
    "quantityPerPackage:500 lb"
  ]);
  assert.ok(result.warnings.includes("Verify transport classification."));
});

test("mergeProductAiFields can prefer ChatGPT product parsing over weak local parsing", () => {
  const result = mergeProductAiFields(
    {
      fields: {
        productName: "Section 1",
        productFamily: "Wrong local heading",
        packagingType: ""
      },
      warnings: []
    },
    {
      fields: {
        productName: "ONGRONAT XP 1127",
        productFamily: "ONGRONAT XP 1127",
        packagingType: "Fixed",
        supplierType: "Variable",
        shelfCycleReadySummary: "Review ONGRONAT XP 1127 as a product-family match before creating a package code."
      },
      aiDerivedFields: [
        {
          field: "productFamily",
          value: "ONGRONAT XP 1127",
          reason: "Product name appears on the SDS header."
        }
      ],
      warnings: [],
      missingShelfCycleFields: ["Code", "Packaging", "Quantity per Package"],
      shelfCycleNotes: ["Product Family is the material identity; package size still needs review."]
    },
    { preferAiFields: true }
  );

  assert.equal(result.fields.productName, "ONGRONAT XP 1127");
  assert.equal(result.fields.productFamily, "ONGRONAT XP 1127");
  assert.equal(result.fields.packagingType, "Fixed");
  assert.ok(result.aiDerivedFields.some((item) => item.field === "productFamily"));
});
