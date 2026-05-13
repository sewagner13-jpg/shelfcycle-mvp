import { firstNonEmpty, compactWhitespace } from "./normalize.mjs";

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
    productName: { type: "string" },
    code: { type: "string" },
    productFamily: { type: "string" },
    supplier: { type: "string" },
    casNumber: { type: "string" },
    packagingType: { type: "string" },
    packaging: { type: "string" },
    quantityPerPackage: { type: "string" },
    supplierType: { type: "string" },
    unNumber: { type: "string" },
    packingGroup: { type: "string" },
    properShippingName: { type: "string" },
    hazardClass: { type: "string" },
    signalWord: { type: "string" },
    nmfcCode: { type: "string" },
    freightClass: { type: "string" },
    pallet: { type: "string" },
    packagesPerPallet: { type: "string" }
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
      }
    },
    required: ["fields", "aiDerivedFields", "warnings"]
  };
}

export function resolveProductDocumentAiConfig(config = {}) {
  const apiKey = firstNonEmpty(config.apiKey, process.env.OPENAI_API_KEY);
  const enabled = config.enabled ?? Boolean(apiKey);
  const timeoutMs = Number.parseInt(String(firstNonEmpty(config.timeoutMs, process.env.OPENAI_PRODUCT_DOCUMENT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)), 10) || DEFAULT_TIMEOUT_MS;

  return {
    enabled: Boolean(enabled && apiKey),
    apiKey,
    endpoint: firstNonEmpty(config.endpoint, process.env.OPENAI_RESPONSES_ENDPOINT, "https://api.openai.com/v1/responses"),
    model: firstNonEmpty(config.productDocumentModel, config.model, process.env.OPENAI_PRODUCT_DOCUMENT_MODEL, process.env.OPENAI_MODEL, DEFAULT_MODEL),
    timeoutMs
  };
}

export function mergeProductAiFields(result = {}, ai = {}) {
  const currentFields = result.fields ?? {};
  const aiFields = ai.fields ?? {};
  const mergedFields = { ...currentFields };
  const appliedAiDerivedFields = [];

  for (const item of ai.aiDerivedFields ?? []) {
    const key = compactWhitespace(item.field);
    const value = compactWhitespace(item.value);

    if (!key || key === "extractedText" || key === "documentType" || !value || compactWhitespace(mergedFields[key])) {
      continue;
    }

    mergedFields[key] = value;
    appliedAiDerivedFields.push({
      field: key,
      value,
      reason: compactWhitespace(item.reason) || "AI derived from SDS/TDS text."
    });
  }

  for (const [key, value] of Object.entries(aiFields)) {
    const cleanValue = compactWhitespace(value);

    if (key === "extractedText" || key === "documentType" || !cleanValue || compactWhitespace(mergedFields[key])) {
      continue;
    }

    mergedFields[key] = cleanValue;
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
    "Extract ShelfCycle product-code fields from this SDS/TDS/product document.",
    "Use only the supplied document text. Do not invent missing values.",
    "If you infer a value from nearby document text, include it in aiDerivedFields with a short reason.",
    "For existing blank values, fill only when the document supports the value.",
    "Useful fields include code, productFamily, supplier, CAS number, packaging, quantity per package, UN number, packing group, hazard class, proper shipping name, freight class, and SDS/TDS document type.",
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
    return mergeProductAiFields(result, parsed);
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
                text: "Extract readable text and ShelfCycle product-code fields from this SDS/TDS PDF. Use only the document. Mark every field you infer as AI-derived."
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
        warnings: [`AI PDF extraction failed: ${payload.error?.message || response.statusText || response.status}`]
      };
    }

    const parsed = JSON.parse(responseText(payload) || "{}");
    return {
      ok: true,
      text: compactWhitespace(parsed.fields?.extractedText || ""),
      fields: parsed.fields ?? {},
      aiDerivedFields: parsed.aiDerivedFields ?? [],
      warnings: parsed.warnings ?? []
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
