import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeProductAiFields,
  prepareShelfCycleProductDocumentParse,
  researchProductDocumentFieldWithAi,
  refineProductDocumentWithAi,
  resolveProductDocumentAiConfig
} from "../src/lib/product-document-ai.mjs";

test("product document parser uses dedicated model default instead of the shared brief model", () => {
  const config = resolveProductDocumentAiConfig({
    apiKey: "test-key",
    model: "gpt-5-mini"
  });

  assert.equal(config.model, "gpt-4.1-mini");
});

test("product document parser honors an explicit product-document model", () => {
  const config = resolveProductDocumentAiConfig({
    apiKey: "test-key",
    model: "gpt-5-mini",
    productDocumentModel: "gpt-4.1-mini-custom"
  });

  assert.equal(config.model, "gpt-4.1-mini-custom");
});

test("product document parser uses targeted web lookup after the main SDS/TDS parse", async () => {
  const requestBodies = [];
  const fetchImpl = async (_url, options) => {
    const requestBody = JSON.parse(options.body);
    requestBodies.push(requestBody);

    if (requestBodies.length === 1) {
      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            fields: {
              productName: "Phenol 90%",
              productFamily: "Phenol 90%",
              chemicalName: "Phenol",
              casNumber: "108-95-2",
              code: "PH90-475"
            },
            aiDerivedFields: [],
            warnings: [],
            missingShelfCycleFields: [],
            shelfCycleNotes: []
          })
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          fields: {
            unNumber: "UN2821",
            nmfcCode: "4620",
            freightClass: "70"
          },
          aiDerivedFields: [
            {
              field: "freightClass",
              value: "70",
              reason: "AI web lookup from freight classification evidence."
            }
          ],
          warnings: [],
          missingShelfCycleFields: [],
          shelfCycleNotes: []
        })
      })
    };
  };

  const result = await refineProductDocumentWithAi({
    text: "Phenol 90% SDS. CAS 108-95-2.",
    result: {
      fields: {
        productName: "Phenol 90%",
        productFamily: "Phenol 90%",
        code: "PH90-475"
      },
      warnings: []
    },
    config: {
      apiKey: "test-key",
      webLookupEnabled: true
    },
    fetchImpl
  });

  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].tools, undefined);
  assert.deepEqual(requestBodies[1].tools, [{ type: "web_search_preview" }]);
  assert.equal(requestBodies[1].tool_choice, "auto");
  assert.equal(result.fields.unNumber, "UN2821");
  assert.equal(result.fields.freightClass, "70");
  assert.ok(result.aiDerivedFields.some((item) => item.reason.includes("web lookup")));
});

test("product document parser treats Not available as unresolved for targeted lookup", async () => {
  const requestBodies = [];
  const fetchImpl = async (_url, options) => {
    const requestBody = JSON.parse(options.body);
    requestBodies.push(requestBody);

    if (requestBodies.length === 1) {
      return {
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            fields: {
              productName: "Phenol 90%",
              productFamily: "Phenol 90%",
              chemicalName: "Phenol",
              casNumber: "108-95-2",
              code: "PH90-475",
              nmfcCode: "Not available",
              freightClass: "Not available"
            },
            aiDerivedFields: [
              {
                field: "nmfcCode",
                value: "Not available",
                reason: "AI derived from SDS/TDS text."
              }
            ],
            warnings: [],
            missingShelfCycleFields: [],
            shelfCycleNotes: []
          })
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          fields: {
            nmfcCode: "131200",
            freightClass: "60"
          },
          aiDerivedFields: [
            {
              field: "nmfcCode",
              value: "131200",
              reason: "AI web lookup from practical freight classification evidence."
            },
            {
              field: "freightClass",
              value: "60",
              reason: "AI web lookup from practical freight classification evidence."
            }
          ],
          warnings: [],
          missingShelfCycleFields: [],
          shelfCycleNotes: []
        })
      })
    };
  };

  const result = await refineProductDocumentWithAi({
    text: "Phenol 90% SDS. CAS 108-95-2.",
    result: {
      fields: {
        productName: "Phenol 90%",
        productFamily: "Phenol 90%",
        code: "PH90-475"
      },
      warnings: []
    },
    config: {
      apiKey: "test-key",
      webLookupEnabled: true
    },
    fetchImpl
  });

  assert.equal(requestBodies.length, 2);
  assert.equal(result.fields.nmfcCode, "131200");
  assert.equal(result.fields.freightClass, "60");
  assert.ok(!result.aiDerivedFields.some((item) => item.value === "Not available"));
});

test("product document field research returns a sourced AI-derived field", async () => {
  let requestBody = null;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          field: "freightClass",
          value: "60",
          confidence: "medium",
          sourceType: "AI web lookup; freight classification reference",
          reason: "Phenol packaging commonly supports freight class 60; verify with carrier/NMFC if material density or packaging differs.",
          warning: ""
        })
      })
    };
  };

  const result = await researchProductDocumentFieldWithAi({
    field: "freightClass",
    fields: {
      productName: "Phenol 90%",
      chemicalName: "Phenol",
      casNumber: "108-95-2",
      packaging: "Drum (lb)",
      quantityPerPackage: "475"
    },
    text: "Phenol 90% SDS. CAS 108-95-2.",
    config: {
      apiKey: "test-key",
      webLookupEnabled: true
    },
    fetchImpl
  });

  assert.deepEqual(requestBody.tools, [{ type: "web_search_preview" }]);
  assert.equal(result.ok, true);
  assert.equal(result.value, "60");
  assert.equal(result.aiDerivedFields[0].field, "freightClass");
  assert.match(result.aiDerivedFields[0].reason, /AI web lookup/i);
});

test("product document field recheck uses web research and includes the current value", async () => {
  let requestBody = null;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          field: "freightClass",
          value: "55",
          confidence: "medium",
          sourceType: "AI web lookup; freight classification reference",
          reason: "The current freight class is supportable for this packaged liquid based on product identity and density; verify with carrier/NMFC if needed.",
          warning: ""
        })
      })
    };
  };

  const result = await researchProductDocumentFieldWithAi({
    field: "freightClass",
    currentValue: "55",
    mode: "recheck",
    fields: {
      productName: "Neopentyl glycol diglycidyl ether",
      chemicalName: "Neopentyl glycol diglycidyl ether",
      casNumber: "17557-23-2",
      packaging: "Drum / IBC / ISO Tank",
      quantityPerPackage: "200",
      unitOfMeasure: "kg",
      freightClass: "55"
    },
    text: "SDS/TDS snippets do not list freight class.",
    config: {
      apiKey: "test-key",
      webLookupEnabled: true
    },
    fetchImpl
  });

  const prompt = requestBody.input[0].content[0].text;

  assert.deepEqual(requestBody.tools, [{ type: "web_search_preview" }]);
  assert.match(prompt, /Current Freight Class value to verify: 55/i);
  assert.match(prompt, /not a document-only check/i);
  assert.match(prompt, /same web-enabled research used for blank fields/i);
  assert.equal(result.ok, true);
  assert.equal(result.value, "55");
});

test("product document parser falls back to targeted lookup when the main parse aborts", async () => {
  const requestBodies = [];
  const fetchImpl = async (_url, options) => {
    const requestBody = JSON.parse(options.body);
    requestBodies.push(requestBody);

    if (requestBodies.length === 1) {
      const error = new Error("This operation was aborted");
      error.name = "AbortError";
      throw error;
    }

    return {
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          fields: {
            unNumber: "Not regulated",
            hazardClass: "",
            packingGroup: "",
            properShippingName: "",
            signalWord: "Danger",
            hazardSymbols: "Corrosion",
            nmfcCode: "",
            freightClass: "70"
          },
          aiDerivedFields: [
            {
              field: "freightClass",
              value: "70",
              reason: "AI web lookup from practical freight classification evidence."
            }
          ],
          warnings: [],
          shelfCycleNotes: []
        })
      })
    };
  };

  const result = await refineProductDocumentWithAi({
    text: "Phenol 90% SDS. CAS 108-95-2. Section 14 transport information not listed.",
    result: {
      fields: {
        productName: "Phenol 90%",
        productFamily: "Phenol 90%",
        chemicalName: "Phenol",
        casNumber: "108-95-2",
        code: "PH90-475"
      },
      warnings: []
    },
    config: {
      apiKey: "test-key",
      webLookupEnabled: true
    },
    fetchImpl
  });

  assert.equal(requestBodies.length, 2);
  assert.deepEqual(requestBodies[1].tools, [{ type: "web_search_preview" }]);
  assert.equal(result.fields.unNumber, "Not regulated");
  assert.equal(result.fields.freightClass, "70");
  assert.ok(!result.warnings.some((warning) => /AI product-field refinement failed/i.test(warning)));
});

test("product document parser can disable web lookup", async () => {
  let requestBody = null;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          fields: {},
          aiDerivedFields: [],
          warnings: [],
          missingShelfCycleFields: [],
          shelfCycleNotes: []
        })
      })
    };
  };

  await refineProductDocumentWithAi({
    text: "Product SDS text",
    result: {
      fields: {
        productName: "Product"
      },
      warnings: []
    },
    config: {
      apiKey: "test-key",
      webLookupEnabled: false
    },
    fetchImpl
  });

  assert.equal(requestBody.tools, undefined);
});

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

test("prepareShelfCycleProductDocumentParse makes package variants import-ready", () => {
  const result = prepareShelfCycleProductDocumentParse({
    fields: {
      documentType: "TDS",
      extractedText: "ONGRONAT XP 1127 can be packaged and transported in road tankers, 1000 l containers (IBCs), 225 kg non-returnable metal drums, or in metal cans under nitrogen blanket.",
      productName: "ONGRONAT XP 1127",
      productFamily: "MDI Mixtures",
      chemicalName: "",
      productFamilyDescription: "",
      code: "",
      packagingType: "",
      packaging: "",
      quantityPerPackage: "",
      unitOfMeasure: "",
      supplier: "BorsodChem Zrt.",
      supplierType: ""
    },
    aiDerivedFields: [],
    missingShelfCycleFields: ["code", "packagingType", "packaging", "quantityPerPackage", "unitOfMeasure", "supplierType"],
    shelfCycleNotes: [],
    warnings: []
  });

  assert.equal(result.fields.productFamily, "ONGRONAT XP 1127");
  assert.equal(result.fields.chemicalName, "MDI Mixtures");
  assert.equal(result.fields.code, "ONGRONAT-XP-1127-225KG-DRUM, ONGRONAT-XP-1127-1000L-IBC");
  assert.equal(result.fields.packaging, "Drum (kg), Totes (ea)");
  assert.equal(result.fields.quantityPerPackage, "225, 1");
  assert.equal(result.fields.unitOfMeasure, "kg, ea");
  assert.equal(result.fields.packagingType, "Fixed");
  assert.equal(result.fields.supplierType, "Fixed");
  assert.deepEqual(result.missingShelfCycleFields, []);
  assert.ok(result.aiDerivedFields.some((item) => item.field === "code"));
});
