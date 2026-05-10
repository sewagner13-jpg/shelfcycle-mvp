import { compactWhitespace, firstNonEmpty } from "./normalize.mjs";
import {
  customerResearchSeed,
  normalizeCustomerCreateFields
} from "./shelfcycle-customer-requirements.mjs";
import { normalizeSupplierCreateFields } from "./shelfcycle-supplier-requirements.mjs";

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_TIMEOUT_MS = 60000;

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

function fieldPropertiesForRecordType(recordType = "customer") {
  if (recordType === "supplier") {
    return {
      name: { type: "string" },
      email: { type: "string" },
      website: { type: "string" },
      phone: { type: "string" },
      street1: { type: "string" },
      street2: { type: "string" },
      city: { type: "string" },
      country: { type: "string" },
      stateRegion: { type: "string" },
      zip: { type: "string" }
    };
  }

  return {
    name: { type: "string" },
    email: { type: "string" },
    website: { type: "string" },
    phoneNumber: { type: "string" },
    streetAddress: { type: "string" },
    streetAddress2: { type: "string" },
    city: { type: "string" },
    stateRegion: { type: "string" },
    zip: { type: "string" },
    country: { type: "string" }
  };
}

function outputSchema(recordType = "customer") {
  const fieldProperties = fieldPropertiesForRecordType(recordType);

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
      confidence: { type: "number" },
      citations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            url: { type: "string" }
          },
          required: ["title", "url"]
        }
      },
      sourceNotes: {
        type: "array",
        items: { type: "string" }
      },
      warnings: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["fields", "confidence", "citations", "sourceNotes", "warnings"]
  };
}

export function resolveCustomerWebEnrichmentConfig(config = {}) {
  const apiKey = firstNonEmpty(config.apiKey, process.env.OPENAI_API_KEY);
  const enabled = config.enabled ?? Boolean(apiKey);
  const timeoutMs = Number.parseInt(String(firstNonEmpty(config.timeoutMs, process.env.OPENAI_CUSTOMER_RESEARCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)), 10) || DEFAULT_TIMEOUT_MS;

  return {
    enabled: Boolean(enabled && apiKey),
    apiKey,
    endpoint: firstNonEmpty(config.endpoint, process.env.OPENAI_RESPONSES_ENDPOINT, "https://api.openai.com/v1/responses"),
    model: firstNonEmpty(config.model, process.env.OPENAI_CUSTOMER_RESEARCH_MODEL, process.env.OPENAI_MODEL, DEFAULT_MODEL),
    timeoutMs
  };
}

function normalizeCreateFields(recordType = "customer", fields = {}) {
  return recordType === "supplier"
    ? normalizeSupplierCreateFields(fields)
    : normalizeCustomerCreateFields(fields);
}

function buildPrompt(seed = {}, fields = {}, recordType = "customer") {
  const currentFields = normalizeCreateFields(recordType, fields);
  const supplier = recordType === "supplier";

  return [
    `Research public web information for a possible new ClearEdge Solutions ShelfCycle ${supplier ? "supplier" : "customer"} record.`,
    "Only use public company/contact information. Do not guess. Leave unknown fields blank.",
    supplier
      ? "Do not fill Payment Terms, Credit Limit, ACH, Cost Account, Preferred Unit of Measure, or Default Supplier Rep because those are ClearEdge internal decisions."
      : "Do not fill Credit Limit, Payment Term, Default Sales Person, or Default CSR because those are ClearEdge internal decisions.",
    supplier
      ? "Return the best public values for ShelfCycle's New Supplier form: Name, Email, Website, Phone, Street 1, Street 2, City, Country, State / Region, Zip."
      : "Return the best public values for ShelfCycle's New Customer form: Name, Email, Website, Phone Number, Street Address, Street Address 2, City, State / Region, Zip, Country.",
    `Company name: ${seed.companyName || currentFields.name || ""}`,
    `Known website: ${seed.website || currentFields.website || ""}`,
    `Known email/domain: ${seed.email || seed.senderDomain || currentFields.email || ""}`,
    seed.sourceSubject ? `Source subject: ${seed.sourceSubject}` : "",
    seed.sourceSummary ? `Source summary: ${seed.sourceSummary}` : "",
    `Existing extracted fields: ${JSON.stringify(currentFields)}`
  ].filter(Boolean).join("\n");
}

function mergeVerifiedFields(existing = {}, researched = {}) {
  const output = { ...existing };

  for (const [key, value] of Object.entries(researched)) {
    if (compactWhitespace(value)) {
      output[key] = value;
    }
  }

  return output;
}

export async function researchCustomerPublicInfo({
  reviewAction = {},
  fields = {},
  config = {},
  fetchImpl = fetch
} = {}) {
  return researchCompanyPublicInfo({
    reviewAction,
    fields,
    recordType: "customer",
    config,
    fetchImpl
  });
}

export async function researchCompanyPublicInfo({
  reviewAction = {},
  fields = {},
  recordType = "customer",
  config = {},
  fetchImpl = fetch
} = {}) {
  const resolved = resolveCustomerWebEnrichmentConfig(config);
  const normalizedRecordType = recordType === "supplier" ? "supplier" : "customer";

  if (!resolved.enabled) {
    return {
      ok: false,
      code: "OPENAI_NOT_CONFIGURED",
      message: `OpenAI ${normalizedRecordType} web research is not configured on this backend.`
    };
  }

  const controller = typeof AbortController === "function" && resolved.timeoutMs > 0
    ? new AbortController()
    : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), resolved.timeoutMs)
    : null;

  try {
    const seed = customerResearchSeed(reviewAction, fields);
    const response = await fetchImpl(resolved.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${resolved.apiKey}`,
        "content-type": "application/json"
      },
      signal: controller?.signal,
      body: JSON.stringify({
        model: resolved.model,
        store: false,
        tools: [
          {
            type: "web_search",
            user_location: {
              type: "approximate",
              country: "US",
              region: "Indiana",
              city: "Indianapolis",
              timezone: "America/Indiana/Indianapolis"
            }
          }
        ],
        tool_choice: "auto",
        include: ["web_search_call.action.sources"],
        instructions: [
          `You are a careful ${normalizedRecordType}-data research assistant for a specialty chemicals distributor.`,
          "Use web search only when it helps verify public business information.",
          "Prefer official company websites or authoritative directories.",
          "Never invent address, phone, or email values. Return blank strings when not verified.",
          "Return only JSON matching the schema."
        ].join("\n"),
        input: buildPrompt(seed, fields, normalizedRecordType),
        text: {
          format: {
            type: "json_schema",
            name: `clearedge_${normalizedRecordType}_public_research`,
            strict: true,
            schema: outputSchema(normalizedRecordType)
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI customer research failed (${response.status}): ${compactWhitespace(errorText).slice(0, 500)}`);
    }

    const data = await response.json();
    const text = responseText(data);
    const parsed = text ? JSON.parse(text) : null;

    if (!parsed) {
      return {
        ok: false,
        code: "NO_RESEARCH_RESULT",
        message: "OpenAI did not return customer research data."
      };
    }

    return {
      ok: true,
      fields: normalizeCreateFields(normalizedRecordType, mergeVerifiedFields(fields, parsed.fields)),
      confidence: parsed.confidence ?? 0,
      citations: parsed.citations ?? [],
      sourceNotes: parsed.sourceNotes ?? [],
      warnings: parsed.warnings ?? []
    };
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(`OpenAI customer research timed out after ${resolved.timeoutMs}ms.`);
    }

    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
