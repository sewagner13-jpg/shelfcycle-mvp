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
