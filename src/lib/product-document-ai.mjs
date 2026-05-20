import { firstNonEmpty, compactWhitespace } from "./normalize.mjs";
import { productRequirementsPromptBlock } from "./shelfcycle-product-requirements.mjs";

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_TIMEOUT_MS = 180000;
const PRODUCT_LOOKUP_FIELDS = Object.freeze([
  "unNumber",
  "hazardClass",
  "packingGroup",
  "properShippingName",
  "signalWord",
  "hazardSymbols",
  "nmfcCode",
  "freightClass",
  "pallet",
  "packagesPerPallet"
]);
const LOOKUP_FIELD_LABELS = Object.freeze({
  unNumber: "UN/NA Number",
  hazardClass: "Hazard Class",
  packingGroup: "Packing Group",
  properShippingName: "Proper Shipping Name",
  signalWord: "GHS Signal Word",
  hazardSymbols: "Hazard Symbols",
  nmfcCode: "NMFC Code",
  freightClass: "Freight Class",
  pallet: "Pallet",
  packagesPerPallet: "Packages per Pallet"
});

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
  const webLookupValue = Object.hasOwn(config, "webLookupEnabled")
    ? config.webLookupEnabled
    : firstNonEmpty(process.env.OPENAI_PRODUCT_DOCUMENT_WEB_LOOKUP, "1");

  return {
    enabled: Boolean(enabled && apiKey),
    apiKey,
    endpoint: firstNonEmpty(config.endpoint, process.env.OPENAI_RESPONSES_ENDPOINT, "https://api.openai.com/v1/responses"),
    // Product-document parsing uses PDF/file inputs and structured extraction.
    // Do not inherit the daily-brief model unless a product model is explicitly configured.
    model: firstNonEmpty(explicitProductDocumentModel, DEFAULT_MODEL, config.model, process.env.OPENAI_MODEL),
    timeoutMs,
    webLookupEnabled: !["0", "false", "no", "off"].includes(String(webLookupValue).toLowerCase())
  };
}

function isUnsupportedProductLookupValue(value = "") {
  const normalized = compactWhitespace(String(value ?? ""))
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .trim();

  return /^(?:n\/?a|none|unknown|select|not available|not provided|not specified|not listed|not found|not known|unavailable|no data)$/i.test(normalized);
}

function productLookupFieldMissing(fields = {}, key = "") {
  const value = compactWhitespace(fields[key]);
  return !value || isUnsupportedProductLookupValue(value);
}

function needsFreightOrHazmatLookup(fields = {}) {
  return PRODUCT_LOOKUP_FIELDS.some((key) => productLookupFieldMissing(fields, key));
}

function productLookupInstruction(fields = {}) {
  const missing = PRODUCT_LOOKUP_FIELDS
    .filter((key) => productLookupFieldMissing(fields, key))
    .map((key) => LOOKUP_FIELD_LABELS[key])
    .filter(Boolean);

  if (!missing.length) {
    return "";
  }

  return [
    `Missing lookup targets: ${missing.join(", ")}.`,
    "If these fields are not present in the SDS/TDS, use web lookup from authoritative or practical business sources when available: supplier SDS/TDS pages, DOT/transport references, product safety sheets, carrier/freight classification references, or reliable chemical shipping references.",
    "For UN/NA Number: if transport evidence says the product is not regulated, use 'Not regulated' rather than leaving it blank. If the identity is still ambiguous, leave blank.",
    "For Hazard Class, Packing Group, Proper Shipping Name, Signal Word, and Hazard Symbols: prefer direct SDS transport/GHS evidence. Use web lookup only when the product identity/CAS is specific enough to support it.",
    "For NMFC Code and Freight Class: use a specific code/class only when the product identity and packaging make it supportable. If only a broad commodity class is available, mark it AI-derived and explain the uncertainty.",
    "For Pallet and Packages per Pallet: infer only from packaging dimensions, package size, supplier packaging guidance, common palletization standards, or prior source evidence. If palletization depends on supplier/customer preference, leave blank and explain what must be confirmed.",
    "Every lookup-derived value must appear in aiDerivedFields with a reason that says it came from AI web lookup and briefly names the evidence/source type. Do not guess unsupported freight, hazmat, or pallet values."
  ].join("\n");
}

function productDocumentTools(resolved = {}, fields = {}) {
  if (!resolved.webLookupEnabled || !needsFreightOrHazmatLookup(fields)) {
    return [];
  }

  return [{ type: "web_search_preview" }];
}

function productRegulatoryLookupSchema() {
  const fieldProperties = Object.fromEntries(
    PRODUCT_LOOKUP_FIELDS.map((key) => [key, { type: "string" }])
  );

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
      shelfCycleNotes: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["fields", "aiDerivedFields", "warnings", "shelfCycleNotes"]
  };
}

function productLookupIdentity(fields = {}) {
  return {
    productName: cleanProductFieldValue(fields.productName),
    productFamily: cleanProductFieldValue(fields.productFamily),
    chemicalName: cleanProductFieldValue(fields.chemicalName),
    aliases: cleanProductFieldValue(fields.aliases),
    casNumber: cleanProductFieldValue(fields.casNumber),
    supplier: cleanProductFieldValue(fields.supplier),
    code: cleanProductFieldValue(fields.code),
    packaging: cleanProductFieldValue(fields.packaging),
    quantityPerPackage: cleanProductFieldValue(fields.quantityPerPackage),
    unitOfMeasure: cleanProductFieldValue(fields.unitOfMeasure),
    pallet: cleanProductFieldValue(fields.pallet),
    packagesPerPallet: cleanProductFieldValue(fields.packagesPerPallet)
  };
}

function productLookupEvidenceText(text = "") {
  const clean = cleanProductFieldValue(text);

  if (!clean) {
    return "";
  }

  const snippets = [];
  const patterns = [
    /\bsection\s*14\b.{0,5000}/gi,
    /\btransport(?:ation)?\s+information\b.{0,5000}/gi,
    /\b(?:UN|NA)\s?\d{4}\b.{0,1200}/gi,
    /\bsection\s*2\b.{0,3000}/gi,
    /\bhazard(?:s|ous)?\b.{0,2500}/gi,
    /\bcomposition\b.{0,2500}/gi,
    /\bCAS\s*(?:No\.?|number)?\b.{0,1600}/gi,
    /\bfreight\s+class\b.{0,1200}/gi,
    /\bNMFC\b.{0,1200}/gi
  ];

  for (const pattern of patterns) {
    for (const match of clean.matchAll(pattern)) {
      const value = cleanProductFieldValue(match[0]);

      if (value && !snippets.some((item) => item === value)) {
        snippets.push(value);
      }

      if (snippets.join("\n\n").length > 9000) {
        return snippets.join("\n\n").slice(0, 10000);
      }
    }
  }

  return snippets.length ? snippets.join("\n\n").slice(0, 10000) : clean.slice(0, 6000);
}

function isAbortError(error) {
  return error?.name === "AbortError" || /\babort|aborted|timeout|timed out/i.test(error instanceof Error ? error.message : String(error));
}

async function completeProductRegulatoryLookupWithAi({
  result = {},
  text = "",
  resolved,
  fetchImpl,
  reason = ""
} = {}) {
  if (!resolved?.enabled || !resolved.webLookupEnabled || !fetchImpl || !needsFreightOrHazmatLookup(result.fields ?? {})) {
    return result;
  }

  const fields = result.fields ?? {};
  const missing = PRODUCT_LOOKUP_FIELDS.filter((key) => productLookupFieldMissing(fields, key));

  if (!missing.length) {
    return result;
  }

  const prompt = [
    "Complete only the missing ShelfCycle shipping, hazmat, GHS, NMFC, and freight-class fields for this product.",
    "This is a targeted lookup pass after the main SDS/TDS parser. Keep it small and deterministic.",
    productLookupInstruction(fields),
    `Missing fields: ${missing.map((key) => LOOKUP_FIELD_LABELS[key] || key).join(", ")}.`,
    "Use the provided identity and SDS/TDS evidence first. Use web lookup only if the provided evidence does not contain the missing value.",
    "Leave unsupported values blank. Do not invent a product code, CAS, UN number, NMFC, or freight class.",
    "For each filled value, add aiDerivedFields with a reason that states whether it came from SDS evidence or AI web lookup.",
    reason ? `Previous parser issue: ${reason}` : "",
    `Known product identity:\n${JSON.stringify(productLookupIdentity(fields), null, 2)}`,
    `Relevant SDS/TDS snippets:\n${productLookupEvidenceText(text)}`
  ].filter(Boolean).join("\n\n");

  const controller = new AbortController();
  const timeoutMs = Math.min(Math.max(Number.parseInt(String(resolved.timeoutMs || DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS, 30000), 90000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestBody = {
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
          name: "clearedge_product_regulatory_lookup",
          strict: true,
          schema: productRegulatoryLookupSchema()
        }
      }
    };
    const tools = productDocumentTools(resolved, fields);

    if (tools.length) {
      requestBody.tools = tools;
      requestBody.tool_choice = "auto";
    }

    const { response, payload, webLookupFallbackReason } = await fetchOpenAiResponse({
      resolved,
      fetchImpl,
      body: requestBody,
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ...result,
        warnings: [
          ...(result.warnings ?? []),
          `Targeted AI regulatory/freight lookup failed: ${payload.error?.message || response.statusText || response.status}`
        ]
      };
    }

    const parsed = JSON.parse(responseText(payload) || "{}");
    const merged = mergeProductAiFields(result, {
      fields: parsed.fields ?? {},
      aiDerivedFields: parsed.aiDerivedFields ?? [],
      warnings: parsed.warnings ?? []
    });

    return {
      ...merged,
      shelfCycleNotes: [
        ...(result.shelfCycleNotes ?? []),
        ...(parsed.shelfCycleNotes ?? []),
        webLookupFallbackReason ? `AI web lookup unavailable for product freight/regulatory fields: ${webLookupFallbackReason}` : ""
      ].filter(Boolean)
    };
  } catch (error) {
    return {
      ...result,
      warnings: [
        ...(result.warnings ?? []),
        `Targeted AI regulatory/freight lookup failed: ${error instanceof Error ? error.message : String(error)}`
      ]
    };
  } finally {
    clearTimeout(timeout);
  }
}

function productSingleFieldLookupSchema(field = "") {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      field: { type: "string", enum: [field] },
      value: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low", "none"] },
      sourceType: { type: "string" },
      reason: { type: "string" },
      warning: { type: "string" }
    },
    required: ["field", "value", "confidence", "sourceType", "reason", "warning"]
  };
}

export async function researchProductDocumentFieldWithAi({
  field = "",
  fields = {},
  currentValue = "",
  mode = "",
  text = "",
  config = {},
  fetchImpl = globalThis.fetch
} = {}) {
  const key = cleanProductFieldValue(field);
  const resolved = resolveProductDocumentAiConfig(config);

  if (!key || !resolved.enabled || !fetchImpl) {
    return {
      ok: false,
      field: key,
      value: "",
      aiDerivedFields: [],
      warnings: ["OpenAI product-document field research is not configured."]
    };
  }

  const label = LOOKUP_FIELD_LABELS[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  const existingValue = cleanProductFieldValue(currentValue || fields[key]);
  const isRecheck = Boolean(existingValue) || mode === "recheck";
  const prompt = [
    `Research or re-check one ShelfCycle product field: ${label}.`,
    existingValue ? `Current ${label} value to verify: ${existingValue}` : `Current ${label} value is blank.`,
    existingValue
      ? "This is not a document-only check. Perform the same web-enabled research used for blank fields; verify the current value, correct it if a better-supported value is found, or return the current value when it is supported."
      : "Perform web-enabled research when available; do not rely only on SDS/TDS snippets if the value is not present there.",
    "Use the product identity, current field values, SDS/TDS snippets, and web lookup when available.",
    "Return a value only when it is useful enough for Sean to review in the ShelfCycle approval screen.",
    "Do not return placeholder values such as Not available, N/A, unknown, not provided, or not specified.",
    "If the answer cannot be supported, leave value blank and explain exactly what source is needed.",
    "If the answer comes from AI web lookup, sourceType must say 'AI web lookup' plus the practical source type or source name.",
    "If the answer comes from the SDS/TDS text, sourceType must say 'SDS/TDS text'.",
    "For NMFC/Freight Class, use a supportable classification based on product identity and packaging, or leave blank with a warning if classification requires carrier/NMFC confirmation.",
    "For UN/GHS fields, prefer SDS Section 14 and Section 2. If web lookup is used, only fill when product identity/CAS is specific enough.",
    "For pallet/package-per-pallet fields, infer only when packaging size and common palletization guidance support it; otherwise leave blank and explain what to confirm.",
    `Current product fields:\n${JSON.stringify(productLookupIdentity(fields), null, 2)}`,
    `Field being researched:\n${JSON.stringify({ field: key, label, currentValue: existingValue, mode: isRecheck ? "recheck_existing_value" : "research_blank_value" }, null, 2)}`,
    `Relevant SDS/TDS snippets:\n${productLookupEvidenceText(text)}`
  ].join("\n\n");
  const controller = new AbortController();
  const timeoutMs = Math.min(Math.max(Number.parseInt(String(resolved.timeoutMs || DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS, 30000), 90000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestBody = {
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
          name: "clearedge_product_single_field_lookup",
          strict: true,
          schema: productSingleFieldLookupSchema(key)
        }
      }
    };

    if (resolved.webLookupEnabled) {
      requestBody.tools = [{ type: "web_search_preview" }];
      requestBody.tool_choice = "auto";
    }

    const { response, payload, webLookupFallbackReason } = await fetchOpenAiResponse({
      resolved,
      fetchImpl,
      body: requestBody,
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        field: key,
        value: "",
        aiDerivedFields: [],
        warnings: [`AI field research failed: ${payload.error?.message || response.statusText || response.status}`]
      };
    }

    const parsed = JSON.parse(responseText(payload) || "{}");
    const value = cleanProductFieldValue(parsed.value);
    const warnings = [
      parsed.warning,
      webLookupFallbackReason ? `AI web lookup unavailable for ${label}: ${webLookupFallbackReason}` : ""
    ].map((item) => cleanProductFieldValue(item)).filter(Boolean);

    if (!value || isUnsupportedProductLookupValue(value)) {
      return {
        ok: false,
        field: key,
        value: "",
        aiDerivedFields: [],
        warnings: warnings.length ? warnings : [`AI research did not find a supportable ${label} value.`],
        confidence: parsed.confidence || "none",
        sourceType: parsed.sourceType || ""
      };
    }

    return {
      ok: true,
      field: key,
      value,
      confidence: parsed.confidence || "medium",
      sourceType: cleanProductFieldValue(parsed.sourceType) || "AI field research",
      reason: cleanProductFieldValue(parsed.reason) || `AI researched ${label} for ShelfCycle product intake.`,
      aiDerivedFields: [
        {
          field: key,
          value,
          reason: `${cleanProductFieldValue(parsed.reason) || `AI researched ${label}.`} Source: ${cleanProductFieldValue(parsed.sourceType) || "AI field research"}.`
        }
      ],
      warnings
    };
  } catch (error) {
    return {
      ok: false,
      field: key,
      value: "",
      aiDerivedFields: [],
      warnings: [`AI field research failed: ${error instanceof Error ? error.message : String(error)}`]
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenAiResponse({
  resolved,
  fetchImpl,
  body,
  signal
} = {}) {
  const request = async (requestBody) => {
    const response = await fetchImpl(resolved.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${resolved.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  };

  const firstAttempt = await request(body);

  if (
    firstAttempt.response.ok ||
    !body.tools?.length ||
    !/web[_ -]?search|tool|unsupported|not available/i.test(
      [
        firstAttempt.payload.error?.message,
        firstAttempt.payload.error?.code,
        firstAttempt.response.statusText,
        firstAttempt.response.status
      ].filter(Boolean).join(" ")
    )
  ) {
    return firstAttempt;
  }

  const fallbackBody = { ...body };
  delete fallbackBody.tools;
  delete fallbackBody.tool_choice;
  const fallbackAttempt = await request(fallbackBody);
  fallbackAttempt.webLookupFallbackReason = firstAttempt.payload.error?.message || firstAttempt.response.statusText || "OpenAI web lookup unavailable.";
  return fallbackAttempt;
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

function cleanProductFieldValue(value = "") {
  return compactWhitespace(String(value ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .replace(/[®™]/g, ""));
}

function normalizedField(value = "") {
  return cleanProductFieldValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function addAiDerived(aiDerivedFields = [], field = "", value = "", reason = "") {
  const cleanField = cleanProductFieldValue(field);
  const cleanValue = cleanProductFieldValue(value);

  if (!cleanField || !cleanValue) {
    return aiDerivedFields;
  }

  const exists = aiDerivedFields.some((item) =>
    normalizedField(item.field) === normalizedField(cleanField) &&
    normalizedField(item.value) === normalizedField(cleanValue)
  );

  if (exists) {
    return aiDerivedFields;
  }

  return [
    ...aiDerivedFields,
    {
      field: cleanField,
      value: cleanValue,
      reason: cleanProductFieldValue(reason) || "Derived from SDS/TDS document for ShelfCycle product intake."
    }
  ];
}

function packageVariantsFromDocumentText(text = "") {
  const clean = cleanProductFieldValue(text);
  const variants = [];
  const addVariant = (variant) => {
    if (!variant.quantity || !variant.unit || !variant.packaging) {
      return;
    }

    const key = `${variant.packaging}:${variant.quantity}:${variant.unit}`.toLowerCase();

    if (variants.some((item) => `${item.packaging}:${item.quantity}:${item.unit}`.toLowerCase() === key)) {
      return;
    }

    variants.push(variant);
  };

  for (const match of clean.matchAll(/\b(\d+(?:\.\d+)?)\s*(kg|kgs|kilograms?|lb|lbs|pounds?)\s+(?:non[- ]returnable\s+)?(?:metal\s+)?drums?\b/gi)) {
    addVariant({
      packaging: match[2].toLowerCase().startsWith("kg") || /kilogram/i.test(match[2]) ? "Drum (kg)" : "Drum (lb)",
      quantity: match[1],
      unit: match[2].toLowerCase().startsWith("kg") || /kilogram/i.test(match[2]) ? "kg" : "lb",
      codeSuffix: `${match[1]}${match[2].toLowerCase().startsWith("kg") || /kilogram/i.test(match[2]) ? "KG" : "LB"}-DRUM`
    });
  }

  for (const match of clean.matchAll(/\b(\d+(?:\.\d+)?)\s*(l|liter|litre|liters|litres)\s+(?:containers?|ibcs?)\s*(?:\((?:ibcs?|containers?)\))?/gi)) {
    addVariant({
      packaging: "Totes (ea)",
      quantity: "1",
      unit: "ea",
      codeSuffix: `${match[1]}L-IBC`
    });
  }

  for (const match of clean.matchAll(/\b(\d+(?:\.\d+)?)\s*(gal|gallons?)\s+(?:totes?|ibcs?)\b/gi)) {
    addVariant({
      packaging: "Totes (ea)",
      quantity: "1",
      unit: "ea",
      codeSuffix: `${match[1]}GAL-TOTE`
    });
  }

  return variants;
}

function productCodeBase(value = "") {
  return cleanProductFieldValue(value)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
}

export function prepareShelfCycleProductDocumentParse(parsed = {}) {
  const fields = Object.fromEntries(
    Object.entries(parsed.fields ?? {}).map(([key, value]) => [key, cleanProductFieldValue(value)])
  );

  for (const key of PRODUCT_LOOKUP_FIELDS) {
    if (isUnsupportedProductLookupValue(fields[key])) {
      fields[key] = "";
    }
  }

  let aiDerivedFields = (parsed.aiDerivedFields ?? [])
    .map((item) => ({
      field: cleanProductFieldValue(item.field),
      value: cleanProductFieldValue(item.value),
      reason: cleanProductFieldValue(item.reason)
    }))
    .filter((item) => item.field && item.value && !(PRODUCT_LOOKUP_FIELDS.includes(item.field) && isUnsupportedProductLookupValue(item.value)));
  const extractedText = fields.extractedText || "";
  const productName = fields.productName || fields.productFamily || "";
  const oldFamily = fields.productFamily || "";

  if (!fields.productName && productName) {
    fields.productName = productName;
    aiDerivedFields = addAiDerived(aiDerivedFields, "productName", fields.productName, "Commercial product name was normalized from the SDS/TDS product identity.");
  }

  if (productName && (!oldFamily || (
    normalizedField(productName) !== normalizedField(oldFamily) &&
    /[a-z]{2,}.*\d|\d.*[a-z]{2,}/i.test(productName) &&
    /\b(mixture|mixtures|isomers?|polymeric|chemical|resin|alcohol|amine|diisocyanate|mdi|pmdi)\b/i.test(oldFamily)
  ))) {
    if (oldFamily && !fields.chemicalName) {
      fields.chemicalName = oldFamily;
      aiDerivedFields = addAiDerived(aiDerivedFields, "chemicalName", fields.chemicalName, "Moved broad chemistry from Product Family into Chemical Name.");
    }

    if (oldFamily && !fields.productFamilyDescription) {
      fields.productFamilyDescription = oldFamily;
      aiDerivedFields = addAiDerived(aiDerivedFields, "productFamilyDescription", fields.productFamilyDescription, "Broad chemistry retained as family description.");
    }

    fields.productFamily = productName;
    aiDerivedFields = addAiDerived(aiDerivedFields, "productFamily", fields.productFamily, "ShelfCycle Product Family should use the commercial product/trade name from the SDS/TDS.");
  }

  const variants = packageVariantsFromDocumentText(extractedText);

  if (variants.length) {
    fields.packaging = variants.map((item) => item.packaging).join(", ");
    fields.quantityPerPackage = variants.map((item) => item.quantity).join(", ");
    fields.unitOfMeasure = variants.map((item) => item.unit).join(", ");
    fields.packagingType = "Fixed";
    aiDerivedFields = addAiDerived(aiDerivedFields, "packaging", fields.packaging, "Package options were extracted from the SDS/TDS packaging section.");
    aiDerivedFields = addAiDerived(aiDerivedFields, "quantityPerPackage", fields.quantityPerPackage, "Package quantities were extracted from the SDS/TDS packaging section.");
    aiDerivedFields = addAiDerived(aiDerivedFields, "unitOfMeasure", fields.unitOfMeasure, "Units were extracted from package quantities in the SDS/TDS.");
    aiDerivedFields = addAiDerived(aiDerivedFields, "packagingType", fields.packagingType, "Each extracted package size should create/review a fixed Product Code package.");

    const generatedCodes = productName
      ? variants.map((item) => `${productCodeBase(productName)}-${item.codeSuffix}`).join(", ")
      : "";
    const currentCodeLooksGenerated = fields.code && normalizedField(productName) &&
      normalizedField(fields.code).includes(normalizedField(productName));

    if (generatedCodes && (!fields.code || currentCodeLooksGenerated)) {
      fields.code = generatedCodes;
      aiDerivedFields = addAiDerived(aiDerivedFields, "code", fields.code, "Generated from product name plus documented package size; requires approval before ShelfCycle import.");
    }
  }

  if (fields.supplier && !fields.supplierType) {
    fields.supplierType = "Fixed";
    aiDerivedFields = addAiDerived(aiDerivedFields, "supplierType", fields.supplierType, "Supplier was identified in the source document.");
  }

  const missingShelfCycleFields = (parsed.missingShelfCycleFields ?? []).filter((field) => {
    const normalized = normalizedField(field);
    return !(
      (/code|sku/.test(normalized) && fields.code) ||
      (/product\s*name/.test(normalized) && fields.productName) ||
      (/packaging type/.test(normalized) && fields.packagingType) ||
      (/packaging/.test(normalized) && fields.packaging) ||
      (/quantity/.test(normalized) && fields.quantityPerPackage) ||
      (/unit/.test(normalized) && fields.unitOfMeasure) ||
      (/supplier\s*type/.test(normalized) && fields.supplierType)
    );
  });

  return {
    ...parsed,
    fields,
    aiDerivedFields,
    missingShelfCycleFields
  };
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

    if (PRODUCT_LOOKUP_FIELDS.includes(key) && isUnsupportedProductLookupValue(value)) {
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

    if (PRODUCT_LOOKUP_FIELDS.includes(key) && isUnsupportedProductLookupValue(cleanValue)) {
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
    "Use the document as the primary source. Build the most complete ShelfCycle-ready product setup possible, but do not fabricate unsupported values.",
    "For ShelfCycle, Product Family should normally be the commercial product/trade name, while chemicalName and productFamilyDescription should hold the broad chemistry or chemical identity.",
    "If the document lists multiple package sizes, return comma-aligned Product Code fields for each package option: code, packaging, quantityPerPackage, and unitOfMeasure. Generate an approval-required code from product name plus package size only when no exact SKU appears.",
    "Extract all available shipping, regulatory, and freight/logistics fields, not only required fields. Prioritize SDS Section 14 for UN/NA Number, Packing Group, Hazard Class, Special Designation, and Proper Shipping Name; SDS hazard sections for Signal Word and Hazard Symbols; and packaging/freight data for NMFC, Freight Class, Pallet, and Packages per Pallet.",
    "If those shipping/regulatory/freight fields are not directly present, make a best-supported AI determination only when product identity, CAS, or regulatory wording makes it high-confidence. Otherwise leave the field blank and explain the gap in shelfCycleNotes or warnings.",
    "Do not perform broad web research in this main parse. A separate targeted lookup pass will handle missing UN/NA, GHS, NMFC, and Freight Class values.",
    "When the document supports a field directly or by a practical business inference, include it in fields and also include an aiDerivedFields entry with a short evidence/confidence reason.",
    "If a ShelfCycle required field cannot be found, leave it blank and list it in missingShelfCycleFields.",
    "Keep shelfCycleReadySummary short, practical, and suitable for Sean to approve before creating or updating ShelfCycle records.",
    `Existing parsed fields:\n${existing}`,
    `Document text:\n${String(text).slice(0, 50000)}`
  ].join("\n\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolved.timeoutMs);

  try {
    const requestBody = {
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
    };
    const { response, payload } = await fetchOpenAiResponse({
      resolved,
      fetchImpl,
      body: requestBody,
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ...result,
        warnings: [
          ...(result.warnings ?? []),
          `AI product-field refinement failed: ${payload.error?.message || response.statusText || response.status}`
        ]
      };
    }

    const parsed = prepareShelfCycleProductDocumentParse(JSON.parse(responseText(payload) || "{}"));
    const merged = mergeProductAiFields(result, parsed, { preferAiFields: true });

    const output = {
      ...merged,
      missingShelfCycleFields: parsed.missingShelfCycleFields ?? merged.missingShelfCycleFields ?? [],
      shelfCycleNotes: parsed.shelfCycleNotes ?? merged.shelfCycleNotes ?? []
    };

    return await completeProductRegulatoryLookupWithAi({
      result: output,
      text,
      resolved,
      fetchImpl
    });
  } catch (error) {
    if (isAbortError(error)) {
      return await completeProductRegulatoryLookupWithAi({
        result,
        text,
        resolved,
        fetchImpl,
        reason: error instanceof Error ? error.message : String(error)
      });
    }

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
    const requestBody = {
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
                "Use the PDF as the primary source. Build the most complete ShelfCycle-ready product setup possible, but do not fabricate unsupported values. Mark every extracted or inferred ShelfCycle field as AI-derived with a short reason.",
                "For ShelfCycle, Product Family should normally be the commercial product/trade name, while chemicalName and productFamilyDescription should hold the broad chemistry or chemical identity.",
                "If the PDF lists multiple package sizes, return comma-aligned fields for each importable product-code package: code, packaging, quantityPerPackage, and unitOfMeasure. Generate approval-required codes from product name plus package size only when no exact SKU appears.",
                "Extract all available shipping, regulatory, and freight/logistics fields, not only required fields. Prioritize SDS Section 14 for UN/NA Number, Packing Group, Hazard Class, Special Designation, and Proper Shipping Name; SDS hazard sections for Signal Word and Hazard Symbols; and packaging/freight data for NMFC, Freight Class, Pallet, and Packages per Pallet.",
                "Do not perform broad web research in this PDF extraction call. A separate targeted lookup pass will handle missing UN/NA, GHS, NMFC, and Freight Class values.",
                "If transport evidence says the product is not regulated, use 'Not regulated' for UN/NA Number rather than leaving it blank.",
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
    };

    const { response, payload } = await fetchOpenAiResponse({
      resolved,
      fetchImpl,
      body: requestBody,
      signal: controller.signal
    });

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

    const parsed = prepareShelfCycleProductDocumentParse(JSON.parse(responseText(payload) || "{}"));
    const completed = await completeProductRegulatoryLookupWithAi({
      result: {
        fields: parsed.fields ?? {},
        aiDerivedFields: parsed.aiDerivedFields ?? [],
        warnings: parsed.warnings ?? [],
        shelfCycleNotes: parsed.shelfCycleNotes ?? []
      },
      text: parsed.fields?.extractedText || "",
      resolved,
      fetchImpl
    });

    return {
      ok: true,
      text: compactWhitespace(parsed.fields?.extractedText || ""),
      fields: completed.fields ?? parsed.fields ?? {},
      aiDerivedFields: completed.aiDerivedFields ?? parsed.aiDerivedFields ?? [],
      warnings: userFacingProductDocumentWarnings(completed.warnings ?? [], {
        extractionSucceeded: Boolean(parsed.fields?.extractedText || Object.values(parsed.fields ?? {}).some(Boolean))
      }),
      missingShelfCycleFields: parsed.missingShelfCycleFields ?? [],
      shelfCycleNotes: completed.shelfCycleNotes ?? parsed.shelfCycleNotes ?? []
    };
  } catch (error) {
    const aborted = error?.name === "AbortError" || /\babort/i.test(error instanceof Error ? error.message : String(error));
    return {
      ok: false,
      text: "",
      fields: {},
      aiDerivedFields: [],
      warnings: [
        aborted
          ? `AI PDF extraction timed out after ${Math.round(resolved.timeoutMs / 1000)} seconds. Local PDF text extraction will still be used if readable; otherwise retry with a smaller or clearer PDF.`
          : `AI PDF extraction failed: ${error instanceof Error ? error.message : String(error)}`
      ]
    };
  } finally {
    clearTimeout(timeout);
  }
}
