import { randomUUID } from "node:crypto";

import {
  compactWhitespace,
  extractDomain,
  firstNonEmpty,
  isLikelyCompanyName,
  isLikelyPersonName,
  normalizeText
} from "./normalize.mjs";
import { matchEntity } from "./match.mjs";
import { collectExecutableActions, collectProposedActions } from "./shelfcycle-action-router.mjs";
import {
  CUSTOMER_CONTACT_DOCUMENT_TYPES,
  SUPPLIER_CONTACT_DOCUMENT_TYPES
} from "./shelfcycle-contact-document-types.mjs";

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

function normalizeUrl(value = "") {
  const text = compactWhitespace(value);

  if (!text) {
    return "";
  }

  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function businessCardSchema() {
  const fieldProperties = {
    personName: { type: "string" },
    title: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    mobilePhone: { type: "string" },
    faxPhone: { type: "string" },
    companyName: { type: "string" },
    website: { type: "string" },
    streetAddress: { type: "string" },
    streetAddress2: { type: "string" },
    city: { type: "string" },
    stateRegion: { type: "string" },
    zip: { type: "string" },
    country: { type: "string" },
    relationshipSuggestion: {
      type: "string",
      enum: ["customer_prospect", "supplier", "unknown"]
    },
    confidence: { type: "number" }
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
    required: ["fields", "citations", "sourceNotes", "warnings"]
  };
}

export function resolveBusinessCardConfig(config = {}) {
  const apiKey = firstNonEmpty(config.apiKey, process.env.OPENAI_API_KEY);
  const enabled = config.enabled ?? Boolean(apiKey);
  const timeoutMs = Number.parseInt(String(firstNonEmpty(config.timeoutMs, process.env.OPENAI_BUSINESS_CARD_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)), 10) || DEFAULT_TIMEOUT_MS;

  return {
    enabled: Boolean(enabled && apiKey),
    apiKey,
    endpoint: firstNonEmpty(config.endpoint, process.env.OPENAI_RESPONSES_ENDPOINT, "https://api.openai.com/v1/responses"),
    model: firstNonEmpty(config.model, process.env.OPENAI_BUSINESS_CARD_MODEL, process.env.OPENAI_MODEL, DEFAULT_MODEL),
    timeoutMs
  };
}

export function businessCardVisionStatus(config = {}) {
  const resolved = resolveBusinessCardConfig(config);

  return {
    ok: true,
    visionConfigured: resolved.enabled,
    model: resolved.enabled ? resolved.model : "",
    endpointConfigured: Boolean(resolved.endpoint),
    message: resolved.enabled
      ? "OpenAI vision is configured for image-only business-card scans."
      : "OpenAI vision is not configured. Image-only business-card scans need OPENAI_API_KEY."
  };
}

function cleanLines(text = "") {
  return String(text)
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line.replace(/[|]+/g, " ")))
    .filter(Boolean);
}

function extractEmail(text = "") {
  return compactWhitespace((String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) ?? [])[0] ?? "");
}

function extractWebsite(text = "") {
  const match = String(text).match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s]*)?\b/i);

  if (!match) {
    return "";
  }

  const value = match[0];

  if (value.includes("@")) {
    return "";
  }

  return normalizeUrl(value);
}

function extractPhones(text = "") {
  const phonePatterns = [
    /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s./-]?)\d{3}[\s./-]?\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?/gi,
    /\+\d{1,3}[\s.-]?(?:\(?\d{1,4}\)?[\s./-]?){2,6}\d{2,4}(?:\s*(?:x|ext\.?)\s*\d+)?/gi
  ];
  const phones = [];

  for (const pattern of phonePatterns) {
    for (const match of String(text).matchAll(pattern)) {
      const value = compactWhitespace(match[0]);

      if (value && !phones.includes(value)) {
        phones.push(value);
      }
    }
  }

  return phones;
}

function parseAddressFromLines(lines = []) {
  const stateZip = /\b([A-Z]{2})\b\s+(\d{5}(?:-\d{4})?)\b/i;
  const stateIndex = lines.findIndex((line) => stateZip.test(line));

  if (stateIndex < 0) {
    return {};
  }

  const stateLine = lines[stateIndex];
  const match = stateZip.exec(stateLine);
  const beforeState = compactWhitespace(stateLine.slice(0, match.index).replace(/,$/, ""));
  const country = /united states|usa|\bus\b/i.test(lines[stateIndex + 1] || "") ? "United States" : "";
  const previousLine = compactWhitespace(lines[stateIndex - 1] ?? "");
  const streetAddress = previousLine && !previousLine.includes("@") && !extractWebsite(previousLine) && !extractPhones(previousLine).length
    ? previousLine
    : "";

  return {
    streetAddress,
    city: compactWhitespace(beforeState.replace(/,$/, "")),
    stateRegion: match[1].toUpperCase(),
    zip: match[2],
    country
  };
}

function likelyTitle(line = "") {
  return /\b(president|owner|director|manager|sales|procurement|purchasing|buyer|account|technical|chemist|engineer|operations|logistics|sourcing|rep|representative|vp|ceo|cfo|coo)\b/i.test(line);
}

export function parseBusinessCardTextFallback(text = "") {
  const lines = cleanLines(text);
  const joined = lines.join("\n");
  const email = extractEmail(joined);
  const website = lines
    .filter((line) => !line.includes("@"))
    .map((line) => extractWebsite(line))
    .find(Boolean) || (email ? `https://${email.split("@")[1]}` : "");
  const phones = extractPhones(joined);
  const personLine = lines.find((line) => isLikelyPersonName(line)) || "";
  const titleLine = lines.find((line) => line !== personLine && likelyTitle(line)) || "";
  const address = parseAddressFromLines(lines);
  const companyLine = lines.find((line) => {
    if (line === personLine || line === titleLine || line.includes("@") || extractPhones(line).length) {
      return false;
    }

    return isLikelyCompanyName(line);
  }) || lines.find((line) => {
    if (line === personLine || line === titleLine || line.includes("@") || extractPhones(line).length || extractWebsite(line)) {
      return false;
    }

    return line.length > 2 && line.length <= 80 && !/\d{5}/.test(line);
  }) || "";

  return normalizeBusinessCardFields({
    personName: personLine,
    title: titleLine,
    email,
    phone: phones[0] ?? "",
    mobilePhone: phones[1] ?? "",
    faxPhone: "",
    companyName: companyLine,
    website,
    ...address,
    relationshipSuggestion: "unknown",
    confidence: email || personLine || companyLine ? 0.45 : 0
  });
}

export function normalizeBusinessCardFields(input = {}) {
  return {
    personName: compactWhitespace(firstNonEmpty(input.personName, input.name, input.fullName)),
    title: compactWhitespace(firstNonEmpty(input.title, input.role)),
    email: compactWhitespace(input.email),
    phone: compactWhitespace(firstNonEmpty(input.phone, input.officePhone, input.phoneNumber)),
    mobilePhone: compactWhitespace(firstNonEmpty(input.mobilePhone, input.mobile)),
    faxPhone: compactWhitespace(firstNonEmpty(input.faxPhone, input.fax)),
    companyName: compactWhitespace(firstNonEmpty(input.companyName, input.company, input.organization, input.supplierName, input.customerName)),
    website: compactWhitespace(firstNonEmpty(input.website, input.url, input.domain)),
    streetAddress: compactWhitespace(firstNonEmpty(input.streetAddress, input.street1, input.address1)),
    streetAddress2: compactWhitespace(firstNonEmpty(input.streetAddress2, input.street2, input.address2)),
    city: compactWhitespace(input.city),
    stateRegion: compactWhitespace(firstNonEmpty(input.stateRegion, input.state, input.region)),
    zip: compactWhitespace(firstNonEmpty(input.zip, input.postalCode, input.postal)),
    country: compactWhitespace(input.country),
    relationshipSuggestion: ["customer_prospect", "supplier", "unknown"].includes(input.relationshipSuggestion)
      ? input.relationshipSuggestion
      : "unknown",
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0))
  };
}

export function classifyBusinessCardRelationship(fields = {}, relationshipHint = "auto") {
  if (relationshipHint === "supplier") {
    return "supplier";
  }

  if (relationshipHint === "customer_prospect" || relationshipHint === "prospect" || relationshipHint === "customer") {
    return "customer_prospect";
  }

  if (fields.relationshipSuggestion && fields.relationshipSuggestion !== "unknown") {
    return fields.relationshipSuggestion;
  }

  const text = normalizeText(`${fields.title || ""} ${fields.companyName || ""}`);

  if (/\b(supplier|manufacturer|distributor|producer|raw material|chemicals|logistics|freight|carrier)\b/.test(text)) {
    return "supplier";
  }

  return "customer_prospect";
}

function normalizeBusinessCardEntryMode(value = "auto") {
  return [
    "auto",
    "existing_customer_contact",
    "existing_supplier_contact"
  ].includes(value) ? value : "auto";
}

function contactOnlyKindFromEntryMode(entryMode = "auto") {
  if (entryMode === "existing_customer_contact") {
    return "customer";
  }

  if (entryMode === "existing_supplier_contact") {
    return "supplier";
  }

  return "";
}

function relationshipHintForEntryMode(entryMode = "auto", relationshipHint = "auto") {
  const contactOnlyKind = contactOnlyKindFromEntryMode(entryMode);

  if (contactOnlyKind === "supplier") {
    return "supplier";
  }

  if (contactOnlyKind === "customer") {
    return "customer_prospect";
  }

  return relationshipHint;
}

function buildBusinessCardPrompt({ text = "", relationshipHint = "auto", useWebResearch = true } = {}) {
  return [
    "Extract business-card data for ClearEdge Solutions and prepare it for ShelfCycle record review.",
    "Only return values visible on the card or verified from public web sources. Never guess. Leave unknown fields blank.",
    "If web research is allowed, prefer the official company website or authoritative public directories.",
    "Do not fill private/internal fields such as credit limit, payment terms, ACH, default reps, or cost accounts.",
    "Classify the company as customer_prospect, supplier, or unknown. Use the user hint when it is explicit.",
    `User relationship hint: ${relationshipHint}`,
    `Web research allowed: ${useWebResearch ? "yes" : "no"}`,
    text ? `OCR/pasted card text:\n${text}` : "No OCR text was provided; use the image if present."
  ].join("\n");
}

export async function extractBusinessCardWithAi({
  imageDataUrl = "",
  text = "",
  relationshipHint = "auto",
  useWebResearch = true,
  config = {},
  fetchImpl = fetch
} = {}) {
  const resolved = resolveBusinessCardConfig(config);

  if (!resolved.enabled) {
    return {
      ok: false,
      code: "OPENAI_NOT_CONFIGURED",
      message: "OpenAI business-card extraction is not configured on this backend."
    };
  }

  const content = [
    {
      type: "input_text",
      text: buildBusinessCardPrompt({ text, relationshipHint, useWebResearch })
    }
  ];

  if (imageDataUrl) {
    content.push({
      type: "input_image",
      image_url: imageDataUrl
    });
  }

  const controller = typeof AbortController === "function" && resolved.timeoutMs > 0
    ? new AbortController()
    : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), resolved.timeoutMs)
    : null;

  try {
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
        tools: useWebResearch
          ? [
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
          ]
          : [],
        tool_choice: useWebResearch ? "auto" : "none",
        include: useWebResearch ? ["web_search_call.action.sources"] : [],
        instructions: [
          "You are a careful CRM data-entry assistant for a specialty chemicals distributor.",
          "Return only JSON matching the schema.",
          "Never invent phone, email, website, address, contact title, or company type.",
          "If the card is ambiguous, use warnings and leave uncertain fields blank."
        ].join("\n"),
        input: [
          {
            role: "user",
            content
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "clearedge_business_card_intake",
            strict: true,
            schema: businessCardSchema()
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI business-card extraction failed (${response.status}): ${compactWhitespace(errorText).slice(0, 500)}`);
    }

    const data = await response.json();
    const parsed = JSON.parse(responseText(data) || "{}");

    return {
      ok: true,
      fields: normalizeBusinessCardFields(parsed.fields ?? {}),
      citations: parsed.citations ?? [],
      sourceNotes: parsed.sourceNotes ?? [],
      warnings: parsed.warnings ?? []
    };
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(`OpenAI business-card extraction timed out after ${resolved.timeoutMs}ms.`);
    }

    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function mergeNonEmpty(existing = {}, incoming = {}) {
  const output = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (compactWhitespace(value)) {
      output[key] = value;
    }
  }

  if (Number(incoming.confidence) > Number(output.confidence || 0)) {
    output.confidence = incoming.confidence;
  }

  return output;
}

function matchBusinessCard(fields = {}, referenceData = {}) {
  const query = [
    fields.companyName,
    fields.email,
    fields.website,
    extractDomain(fields.website),
    fields.phone
  ].filter(Boolean).join(" ");
  const contactQuery = [
    fields.personName,
    fields.email,
    fields.phone,
    fields.companyName
  ].filter(Boolean).join(" ");

  return {
    customer: matchEntity(query, referenceData.customers ?? [], [
      "name",
      "email",
      "website",
      "phone",
      "status",
      (candidate) => candidate.raw?.primary_billing_address
    ], { minScore: 0.55, limit: 5 }),
    supplier: matchEntity(query, referenceData.suppliers ?? [], [
      "name",
      "supplierName",
      "domain",
      "website",
      "email",
      "phone"
    ], { minScore: 0.55, limit: 5 }),
    contacts: matchEntity(contactQuery, referenceData.contacts ?? [], [
      "name",
      "email",
      "officePhone",
      "mobilePhone",
      "companyName",
      "companyType"
    ], { minScore: 0.58, limit: 5 })
  };
}

function highConfidenceMatch(matches = []) {
  return (matches ?? []).find((entry) => (entry.score ?? entry.confidence ?? 0) >= 0.75) ?? null;
}

function existingCompanyTargetFromLabel(kind = "", label = "") {
  const normalizedLabel = compactWhitespace(label);

  if (!kind || !normalizedLabel) {
    return null;
  }

  return {
    kind,
    id: "",
    label: normalizedLabel,
    confidence: 0.95,
    matchReasons: ["User identified this as an existing ShelfCycle company."]
  };
}

function prependExistingCompanyTarget(matches = {}, target = null) {
  if (!target?.label) {
    return matches;
  }

  const matchEntry = {
    score: target.confidence ?? 0.95,
    confidence: target.confidence ?? 0.95,
    candidate: {
      id: target.id || "",
      name: target.label,
      companyName: target.label,
      label: target.label,
      confidence: target.confidence ?? 0.95
    }
  };

  if (target.kind === "supplier") {
    return {
      ...matches,
      supplier: [matchEntry, ...(matches.supplier ?? [])]
    };
  }

  return {
    ...matches,
    customer: [matchEntry, ...(matches.customer ?? [])]
  };
}

function companyFieldsForCreate(fields = {}) {
  return {
    name: fields.companyName,
    email: fields.email,
    website: fields.website,
    phone: firstNonEmpty(fields.phone, fields.mobilePhone),
    phoneNumber: firstNonEmpty(fields.phone, fields.mobilePhone),
    streetAddress: fields.streetAddress,
    street1: fields.streetAddress,
    streetAddress2: fields.streetAddress2,
    street2: fields.streetAddress2,
    city: fields.city,
    stateRegion: fields.stateRegion,
    zip: fields.zip,
    country: fields.country
  };
}

function contactCreate(fields = {}, relationship = "customer_prospect", existingCompany = null) {
  if (!fields.personName && !fields.email) {
    return null;
  }

  return {
    type: "contact",
    name: fields.personName,
    title: fields.title,
    email: fields.email,
    phone: relationship === "supplier" ? firstNonEmpty(fields.phone, fields.mobilePhone) : fields.phone,
    mobilePhone: fields.mobilePhone,
    faxPhone: fields.faxPhone,
    companyName: existingCompany?.candidate?.name || existingCompany?.candidate?.companyName || existingCompany?.candidate?.label || fields.companyName,
    companyType: relationship === "supplier" ? "Supplier" : "Customer",
    documentTypes: relationship === "supplier" ? SUPPLIER_CONTACT_DOCUMENT_TYPES : CUSTOMER_CONTACT_DOCUMENT_TYPES
  };
}

export async function analyzeBusinessCard({
  imageDataUrl = "",
  text = "",
  relationshipHint = "auto",
  entryMode = "auto",
  existingCompanyLabel = "",
  useWebResearch = true,
  referenceData = {},
  config = {},
  fetchImpl = fetch
} = {}) {
  if (!imageDataUrl && !compactWhitespace(text)) {
    return {
      ok: false,
      code: "NO_CARD_INPUT",
      message: "Upload a business card image or paste OCR/card text."
    };
  }

  const fallbackFields = parseBusinessCardTextFallback(text);
  let aiResult = null;
  const warnings = [];
  const normalizedEntryMode = normalizeBusinessCardEntryMode(entryMode);
  const contactOnlyKind = contactOnlyKindFromEntryMode(normalizedEntryMode);
  const effectiveRelationshipHint = relationshipHintForEntryMode(normalizedEntryMode, relationshipHint);

  if (imageDataUrl || resolveBusinessCardConfig(config).enabled) {
    aiResult = await extractBusinessCardWithAi({
      imageDataUrl,
      text,
      relationshipHint: effectiveRelationshipHint,
      useWebResearch,
      config,
      fetchImpl
    }).catch((error) => {
      warnings.push(error instanceof Error ? error.message : "Business-card AI extraction failed.");
      return null;
    });
  }

  if (imageDataUrl && !aiResult && !compactWhitespace(text)) {
    const authFailed = warnings.some((warning) => /\b(401|authentication|invalid_issuer|invalid api key|unauthorized)\b/i.test(warning));
    const notConfigured = warnings.some((warning) => /\bnot configured\b/i.test(warning));

    return {
      ok: false,
      code: notConfigured ? "IMAGE_REQUIRES_OPENAI" : authFailed ? "OPENAI_AUTH_FAILED" : "OPENAI_VISION_FAILED",
      message: notConfigured
        ? "Image-only business-card scanning requires OpenAI vision to be configured."
        : authFailed
          ? "OpenAI vision is configured, but the backend key was rejected. Update the OpenAI API key used by the business-card scanner."
          : "OpenAI vision could not read this image. Retake the photo with the full card visible and try again.",
      warnings
    };
  }

  const fields = normalizeBusinessCardFields(mergeNonEmpty(fallbackFields, aiResult?.fields ?? {}));
  const relationship = classifyBusinessCardRelationship(fields, effectiveRelationshipHint);
  const existingTargetLabel = contactOnlyKind ? firstNonEmpty(existingCompanyLabel, fields.companyName) : "";
  const manuallySelectedCompanyTarget = existingCompanyTargetFromLabel(contactOnlyKind, existingTargetLabel);
  const matches = prependExistingCompanyTarget(matchBusinessCard(fields, referenceData), manuallySelectedCompanyTarget);
  const existingCustomer = highConfidenceMatch(matches.customer);
  const existingSupplier = highConfidenceMatch(matches.supplier);
  const suggestedCreates = [];

  if (contactOnlyKind === "supplier") {
    const contact = contactCreate(fields, "supplier", manuallySelectedCompanyTarget ? { candidate: manuallySelectedCompanyTarget } : existingSupplier);

    if (contact) {
      suggestedCreates.push(contact);
    }

    if (!manuallySelectedCompanyTarget && !existingSupplier) {
      warnings.push("Choose an existing ShelfCycle supplier target before approving this contact.");
    }
  } else if (contactOnlyKind === "customer") {
    const contact = contactCreate(fields, "customer_prospect", manuallySelectedCompanyTarget ? { candidate: manuallySelectedCompanyTarget } : existingCustomer);

    if (contact) {
      suggestedCreates.push(contact);
    }

    if (!manuallySelectedCompanyTarget && !existingCustomer) {
      warnings.push("Choose an existing ShelfCycle customer target before approving this contact.");
    }
  } else if (relationship === "supplier") {
    if (!existingSupplier && fields.companyName) {
      suggestedCreates.push({
        type: "supplier",
        ...companyFieldsForCreate(fields)
      });
    }

    const contact = contactCreate(fields, relationship, existingSupplier);
    if (contact) {
      suggestedCreates.push(contact);
    }
  } else {
    if (!existingCustomer && fields.companyName) {
      suggestedCreates.push({
        type: "customer",
        prospect: true,
        ...companyFieldsForCreate(fields)
      });
    }

    const contact = contactCreate(fields, "customer_prospect", existingCustomer);
    if (contact) {
      suggestedCreates.push(contact);
    }
  }

  if (!fields.companyName) {
    warnings.push("Company name was not found. Review before creating any company record.");
  }

  if (!fields.personName && !fields.email) {
    warnings.push("No contact name or email was found. Contact creation will stay blocked.");
  }

  if (relationship === "unknown") {
    warnings.push("Relationship type is unknown. Choose prospect or supplier before saving.");
  }

  return {
    ok: true,
    fields: {
      ...fields,
      relationshipType: relationship
    },
    matches,
    suggestedCreates,
    existingCustomer: existingCustomer?.candidate ?? null,
    existingSupplier: existingSupplier?.candidate ?? null,
    existingCompanyTarget: manuallySelectedCompanyTarget,
    entryMode: normalizedEntryMode,
    citations: aiResult?.citations ?? [],
    sourceNotes: [
      ...(aiResult?.sourceNotes ?? []),
      ...(text ? ["Parsed pasted/OCR business-card text."] : [])
    ],
    warnings,
    confidence: Math.max(fields.confidence ?? 0, aiResult?.fields?.confidence ?? 0)
  };
}

export function createBusinessCardReviewAction({
  analysis = {},
  baseUrl = "http://localhost:4318"
} = {}) {
  const id = randomUUID();
  const token = randomUUID();
  const fields = analysis.fields ?? {};
  const relationship = fields.relationshipType === "supplier" ? "supplier" : "customer";
  const companyLabel = fields.companyName || (relationship === "supplier" ? analysis.existingSupplier?.name : analysis.existingCustomer?.name) || "Unknown company";
  const personLabel = fields.personName || fields.email || "Unknown contact";
  const destination = relationship === "supplier"
    ? (analysis.existingSupplier ? "Suppliers > Existing Supplier > New Contact" : "Suppliers > New Supplier")
    : (analysis.existingCustomer ? "Customers > Existing Customer > New Contact" : "Customers > New Customer (Prospect)");
  const actionRecord = {
    id,
    viewToken: token,
    createdAt: new Date().toISOString(),
    threadId: "",
    subject: `Business card - ${personLabel} / ${companyLabel}`,
    workflow: "business_card",
    fields,
    relationship: {
      relationship,
      subtype: relationship === "supplier" ? "supplier" : "prospect"
    },
    silo: {
      name: "relationship",
      priority: "review"
    },
    state: {
      state: "review"
    },
    externalParticipants: fields.email ? [
      {
        name: fields.personName,
        email: fields.email,
        domain: extractDomain(fields.email)
      }
    ] : [],
    summary: [
      `${personLabel} from ${companyLabel}.`,
      relationship === "supplier" ? "Review as supplier/contact intake." : "Review as customer prospect/contact intake.",
      analysis.existingCustomer ? `Existing customer match: ${analysis.existingCustomer.name || analysis.existingCustomer.companyName}.` : "",
      analysis.existingSupplier ? `Existing supplier match: ${analysis.existingSupplier.name || analysis.existingSupplier.companyName}.` : ""
    ].filter(Boolean).join(" "),
    briefAi: {
      action: analysis.existingCustomer || analysis.existingSupplier
        ? "Review and create the contact under the matched ShelfCycle company if correct."
        : relationship === "supplier"
          ? "Review and create a supplier, then add the contact if correct."
          : "Review and create a customer prospect, then add the contact if correct.",
      why: "Business card intake should create clean ShelfCycle records only after human approval.",
      keyDetails: [
        fields.title ? `Title: ${fields.title}` : "",
        fields.email ? `Email: ${fields.email}` : "",
        fields.phone ? `Phone: ${fields.phone}` : "",
        fields.website ? `Website: ${fields.website}` : ""
      ].filter(Boolean),
      shelfCycleCandidate: {
        shouldConsider: true,
        recordType: relationship === "supplier" ? "Supplier / Contact" : "Customer Prospect / Contact",
        title: `${companyLabel} - ${personLabel}`,
        summary: "Business-card scan prepared for approval-first ShelfCycle entry.",
        fields: Object.entries(fields)
          .filter(([, value]) => compactWhitespace(value))
          .map(([key, value]) => `${key}: ${value}`)
      }
    },
    availableActions: [
      { key: "contacts", label: "Review Contact Draft", description: "Review the business-card contact before saving." }
    ],
    chatGptUrl: "",
    draftNote: null,
    writePlan: {
      action: "Create only after explicit approval",
      recordType: relationship === "supplier" ? "supplier/contact" : "customer/contact",
      destination,
      fields,
      warning: "No ShelfCycle write was performed during business-card scanning."
    },
    matches: analysis.matches ?? {},
    selectedTarget: analysis.existingCompanyTarget ?? null,
    intelligenceContext: null,
    suggestedCreates: analysis.suggestedCreates ?? [],
    followUpDraft: null,
    warnings: analysis.warnings ?? [],
    roleWorklists: {},
    workspaceArtifacts: {
      attachments: [],
      driveFileIds: [],
      driveFiles: [],
      driveScopeAvailable: true,
      driveError: ""
    },
    businessCard: {
      citations: analysis.citations ?? [],
      sourceNotes: analysis.sourceNotes ?? [],
      confidence: analysis.confidence ?? 0,
      entryMode: analysis.entryMode ?? "auto"
    }
  };
  const proposedActions = collectProposedActions(actionRecord);

  return {
    ...actionRecord,
    proposedActions,
    executableActions: collectExecutableActions({
      ...actionRecord,
      proposedActions
    }),
    reviewUrl: `${baseUrl.replace(/\/+$/, "")}/review-action.html?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`,
    submitUrl: `${baseUrl.replace(/\/+$/, "")}/review-submit.html?reviewUrl=${encodeURIComponent(`${baseUrl.replace(/\/+$/, "")}/review-action.html?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`)}`
  };
}
