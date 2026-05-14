import { firstNonEmpty, compactWhitespace } from "./normalize.mjs";
import { productRequirementsPromptBlock } from "./shelfcycle-product-requirements.mjs";

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_TIMEOUT_MS = 90000;

function responseText(response = {}) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  for (const output of response.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return "";
}

function productDocumentSchema() {
  const fieldProperties = {
    documentType: { type: "string", enum: ["SDS", "TDS", "COA", "SPEC", "OTHER"] },
    extractedText: { type: "string" },
    shelfCycleReadySummary: { type: "string" },
    productName: { type: "string" },
    code: { type: "string" },
    productFamily: { type: "string" },
    productFamilyDescription: { type: "string" },
    chemicalName: { type: "string" },
    aliases: { type: "string" },
    supplier: { type: "string" },
    casNumber: { type: "string" },
    packagingType: { type: "string" },
    packaging: { type: "string" },
    quantityPerPackage: { type: "string" },
    unitOfMeasure: { type: "string" },
    supplierType: { type: "string" },
    unNumber: { type: "string" },
    packingGroup: { type: "string" },
    hazardClass: { type: "string" },
    specialDesignation: { type: "string" },
    properShippingName: { type: "string" },
    signalWord: { type: "string" },
    hazardSymbols: { type: "string" },
    nmfcCode: { type: "string" },
    freightClass: { type: "string" },
    pallet: { type: "string" },
    packagesPerPallet: { type: "string" },
    physicalState: { type: "string" },
    appearance: { type: "string" },
    density: { type: "string" },
    specificGravity: { type: "string" },
    viscosity: { type: "string" },
    flashPoint: { type: "string" },
    boilingPoint: { type: "string" },
    storage: { type: "string" },
    shelfLife: { type: "string" },
    recommendedUse: { type: "string" },
    documentDate: { type: "string" }
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      fields: {
        type: "object",
        additionalProperties: false,
        properties: fieldProperties,
        required: Object.keys(fieldProperties)
      },
      aiDerivedFields: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string" },
            value: { type: "string" },
            reason: { type: "string" }
          },
          required: ["field", "value", "reason"]
        }
      },
      warnings: {
        type: "array",
        items: { type: "string" }
      },
      missingShelfCycleFields: {
        type: "array",
        items: { type: "string" }
      },
      shelfCycleNotes: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["fields", "aiDerivedFields", "warnings", "missingShelfCycleFields", "shelfCycleNotes"]
  };
}

export function resolveProductDocumentAiConfig(config = {}) {
  const apiKey = firstNonEmpty(config.apiKey, process.env.OPENAI_API_KEY);
  const enabled = config.enabled ?? Boolean(apiKey);
  const timeoutMs = Number.parseInt(String(firstNonEmpty(config.timeoutMs, process.env.OPENAI_PRODUCT_DOCUMENT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)), 10) || DEFAULT_TIMEOUT_MS;
  const explicitProductDocumentModel = firstNonEmpty(
    config.productDocumentModel,
    process.env.OPENAI_PRODUCT_DOCUMENT_MODEL
  );

  return {
    enabled: Boolean(enabled && apiKey),
    apiKey,
    endpoint: firstNonEmpty(config.endpoint, process.env.OPENAI_RESPONSES_ENDPOINT, "https://api.openai.com/v1/responses"),
    // Product-document parsing uses PDF/file inputs and structured extraction.
    // Do not inherit the daily-brief model unless a product model is explicitly configured.
    model: firstNonEmpty(explicitProductDocumentModel, DEFAULT_MODEL, config.model, process.env.OPENAI_MODEL),
    timeoutMs
  };
}

function userFacingProductDocumentWarnings(warnings = [], { extractionSucceeded = false } = {}) {
  const output = [];

  for (const warning of warnings) {
    const clean = compactWhitespace(warning);

    if (!clean) {
      continue;
    }

    if (/^AI PDF extraction failed:\s*Forbidden\b/i.test(clean)) {
      if (!extractionSucceeded) {
        output.push("OpenAI rejected PDF extraction. Check the product-document model/API key, then retry.");
      }
      continue;
    }

    output.push(clean);
  }

  return [...new Set(output)];
}

export function mergeProductAiFields(result = {}, ai = {}, { preferAiFields = false } = {}) {
  const currentFields = result.fields ?? {};
  const aiFields = ai.fields ?? {};
  const mergedFields = { ...currentFields };
  const appliedAiDerivedFields = [];
  const appliedKeys = new Set();

  for (const item of ai.aiDerivedFields ?? []) {
    const key = compactWhitespace(item.field);
    const value = compactWhitespace(item.value);

    if (!key || key === "extractedText" || key === "documentType" || !value) {
      continue;
    }

    if (!preferAiFields && compactWhitespace(mergedFields[key])) {
      continue;
    }

    mergedFields[key] = value;
    appliedKeys.add(key);
    appliedAiDerivedFields.push({
      field: key,
      value,
      reason: compactWhitespace(item.reason) || "AI derived from SDS/TDS text."
    });
  }

  for (const [key, value] of Object.entries(aiFields)) {
    const cleanValue = compactWhitespace(value);

    if (key === "extractedText" || key === "documentType" || !cleanValue) {
      continue;
    }

    if (appliedKeys.has(key) || (!preferAiFields && compactWhitespace(mergedFields[key]))) {
      continue;
    }

    mergedFields[key] = cleanValue;
    appliedKeys.add(key);
    appliedAiDerivedFields.push({
      field: key,
      value: cleanValue,
      reason: "AI derived from SDS/TDS text."
    });
  }

  return {
    ...result,
    documentType: result.documentType || aiFields.documentType || "SDS",
    fields: mergedFields,
    aiDerivedFields: [
      ...(result.aiDerivedFields ?? []),
      ...appliedAiDerivedFields
    ],
    warnings: [
      ...(result.warnings ?? []),
      ...((ai.warnings ?? []).map((warning) => compactWhitespace(warning)).filter(Boolean))
    ]
  };
}

export async function refineProductDocumentWithAi({
  text = "",
  result = {},
  config = {},
  fetchImpl = globalThis.fetch
} = {}) {
  const resolved = resolveProductDocumentAiConfig(config);

  if (!resolved.enabled || !fetchImpl || !String(text || "").trim()) {
    return result;
  }

  const existing = JSON.stringify(result.fields ?? {}, null, 2);
  const prompt = [
    "Parse this SDS/TDS/product document into ShelfCycle product-intake fields.",
    productRequirementsPromptBlock(),
    "Use the document as the primary source. Do not invent missing values.",
    "When the document supports a field directly or by a practical business inference, include it in fields and also include an aiDerivedFields entry with a short evidence reason.",
    "If a ShelfCycle required field cannot be found, leave it blank and list it in missingShelfCycleFields.",
    "Keep shelfCycleReadySummary short, practical, and suitable for Sean to approve before creating or updating ShelfCycle records.",
    `Existing parsed fields:\n${existing}`,
    `Document text:\n${String(text).slice(0, 50000)}`
  ].join("\n\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolved.timeoutMs);

  try {
    const response = await fetchImpl(resolved.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${resolved.apiKey}`
      },
      body: JSON.stringify({
        model: resolved.model,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: prompt
              }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "clearedge_product_document_fields",
            strict: true,
            schema: productDocumentSchema()
          }
        }
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        ...result,
        warnings: [
          ...(result.warnings ?? []),
          `AI product-field refinement failed: ${payload.error?.message || response.statusText || response.status}`
        ]
      };
    }

    const parsed = JSON.parse(responseText(payload) || "{}");
    const merged = mergeProductAiFields(result, parsed, { preferAiFields: true });

    return {
      ...merged,
      missingShelfCycleFields: parsed.missingShelfCycleFields ?? merged.missingShelfCycleFields ?? [],
      shelfCycleNotes: parsed.shelfCycleNotes ?? merged.shelfCycleNotes ?? []
    };
  } catch (error) {
    return {
      ...result,
      warnings: [
        ...(result.warnings ?? []),
        `AI product-field refinement failed: ${error instanceof Error ? error.message : String(error)}`
      ]
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractProductDocumentPdfWithAi({
  fileName = "document.pdf",
  mimeType = "application/pdf",
  base64 = "",
  config = {},
  fetchImpl = globalThis.fetch
} = {}) {
  const resolved = resolveProductDocumentAiConfig(config);

  if (!resolved.enabled || !fetchImpl || !base64) {
    return {
      ok: false,
      text: "",
      fields: {},
      aiDerivedFields: [],
      warnings: ["OpenAI is not configured for image/scanned PDF SDS/TDS extraction."]
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolved.timeoutMs);

  try {
    const response = await fetchImpl(resolved.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${resolved.apiKey}`
      },
      body: JSON.stringify({
        model: resolved.model,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  "Extract readable text and ShelfCycle product-intake fields from this SDS/TDS PDF.",
                  productRequirementsPromptBlock(),
                  "Use only the document. Mark every extracted or inferred ShelfCycle field as AI-derived with a short reason.",
                  "Return a concise shelfCycleReadySummary and list missing ShelfCycle required fields."
                ].join("\n\n")
              },
              {
                type: "input_file",
                filename: fileName,
                file_data: `data:${mimeType || "application/pdf"};base64,${base64}`
              }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "clearedge_product_document_pdf_extract",
            strict: true,
            schema: productDocumentSchema()
          }
        }
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        ok: false,
        text: "",
        fields: {},
        aiDerivedFields: [],
        warnings: userFacingProductDocumentWarnings([
          `AI PDF extraction failed: ${payload.error?.message || response.statusText || response.status}`
        ])
      };
    }

    const parsed = JSON.parse(responseText(payload) || "{}");
    return {
      ok: true,
      text: compactWhitespace(parsed.fields?.extractedText || ""),
      fields: parsed.fields ?? {},
      aiDerivedFields: parsed.aiDerivedFields ?? [],
      warnings: userFacingProductDocumentWarnings(parsed.warnings ?? [], {
        extractionSucceeded: Boolean(parsed.fields?.extractedText || Object.values(parsed.fields ?? {}).some(Boolean))
      }),
      missingShelfCycleFields: parsed.missingShelfCycleFields ?? [],
      shelfCycleNotes: parsed.shelfCycleNotes ?? []
    };
  } catch (error) {
    return {
      ok: false,
      text: "",
      fields: {},
      aiDerivedFields: [],
      warnings: [`AI PDF extraction failed: ${error instanceof Error ? error.message : String(error)}`]
    };
  } finally {
    clearTimeout(timeout);
  }
}
