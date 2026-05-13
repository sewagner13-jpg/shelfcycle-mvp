import { compactWhitespace } from "./normalize.mjs";
import {
  collectCustomerCreateFields,
  customerRequirementsForFields
} from "./shelfcycle-customer-requirements.mjs";
import {
  collectSupplierCreateFields,
  supplierRequirementsForFields
} from "./shelfcycle-supplier-requirements.mjs";
import { buildNoteFields } from "./shelfcycle-submit.mjs";
import { collectNoteMentionCandidates } from "./shelfcycle-mentions.mjs";
import { normalizeShelfCycleNoteText } from "./shelfcycle-ready-note.mjs";
import { normalizeContactDocumentTypes } from "./shelfcycle-contact-document-types.mjs";
import { resolveCustomerTargets, resolveSupplierTargets } from "./shelfcycle-target-resolver.mjs";
import {
  preferredExternalParticipant,
  preferredSuggestedContact
} from "./business-email-identity.mjs";

export const SHELFCYCLE_ACTION_TYPES = Object.freeze({
  CUSTOMER_NOTE: "customer_note",
  CUSTOMER_CREATE: "customer_create",
  SUPPLIER_CREATE: "supplier_create",
  SUPPLIER_UPDATE: "supplier_update",
  SUPPLIER_NOTE: "supplier_note",
  CONTACT_CREATE: "contact_create",
  CONTACT_UPDATE: "contact_update",
  PRODUCT_CREATE_OR_UPDATE: "product_create_or_update",
  PRODUCT_DOCUMENT_FOLLOWUP: "product_document_followup",
  PRICING_RECORD: "pricing_record",
  ORDER_OR_LOGISTICS_NOTE: "order_or_logistics_note",
  REVIEW_ONLY: "review_only"
});

export const SHELFCYCLE_ERROR_CODES = Object.freeze({
  INVALID_REVIEW_ACTION: "INVALID_REVIEW_ACTION",
  INVALID_TOKEN: "INVALID_TOKEN",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  UNSUPPORTED_ACTION_TYPE: "UNSUPPORTED_ACTION_TYPE",
  MISSING_TARGET: "MISSING_TARGET",
  MISSING_REQUIRED_FIELDS: "MISSING_REQUIRED_FIELDS",
  LOW_CONFIDENCE_TARGET: "LOW_CONFIDENCE_TARGET",
  NOT_EXECUTABLE: "NOT_EXECUTABLE",
  SHELFCYCLE_SUBMIT_FAILED: "SHELFCYCLE_SUBMIT_FAILED"
});

const SUBMIT_ENDPOINT = "/api/shelfcycle/submit-action";

function stableBaseId(reviewAction = {}) {
  return compactWhitespace(reviewAction.id || reviewAction.threadId || reviewAction.subject || "review-packet")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "review-packet";
}

function evidenceFromReviewAction(reviewAction = {}) {
  return [
    reviewAction.subject ? `Subject: ${reviewAction.subject}` : "",
    reviewAction.summary ? `Summary: ${reviewAction.summary}` : "",
    reviewAction.briefAi?.action ? `Recommended action: ${reviewAction.briefAi.action}` : "",
    reviewAction.briefAi?.why ? `Why it matters: ${reviewAction.briefAi.why}` : "",
    ...((reviewAction.briefAi?.keyDetails ?? []).map((detail) => `Key detail: ${detail}`)),
    reviewAction.draftNote?.summary ? `Draft note: ${reviewAction.draftNote.summary}` : ""
  ].map((item) => compactWhitespace(item)).filter(Boolean);
}

function makeBaseAction(reviewAction = {}, actionType, displayLabel) {
  return {
    id: `${stableBaseId(reviewAction)}-${actionType}`,
    reviewActionId: reviewAction.id || "",
    actionType,
    displayLabel,
    confidence: 0,
    sourceEvidence: evidenceFromReviewAction(reviewAction),
    targetCandidates: [],
    selectedTarget: null,
    requiredFields: [],
    fieldValues: {},
    warnings: [],
    executable: false,
    submitEndpoint: SUBMIT_ENDPOINT
  };
}

function unsupportedAction(reviewAction = {}, actionType, displayLabel, warning) {
  return {
    ...makeBaseAction(reviewAction, actionType, displayLabel),
    actionType,
    displayLabel,
    warnings: [warning],
    executable: false
  };
}

function blockingAction(reviewAction = {}, actionType, displayLabel, fieldValues = {}, warnings = []) {
  return {
    ...makeBaseAction(reviewAction, actionType, displayLabel),
    fieldValues,
    warnings,
    executable: false
  };
}

function hasActionKey(reviewAction = {}, key = "") {
  return (reviewAction.availableActions ?? []).some((action) => action.key === key);
}

function hasSuggestedContact(reviewAction = {}) {
  return Boolean(firstSuggestedContact(reviewAction));
}

function hasSuggestedCustomer(reviewAction = {}) {
  return (reviewAction.suggestedCreates ?? []).some((item) => item.type === "customer");
}

function hasSuggestedSupplier(reviewAction = {}) {
  return (reviewAction.suggestedCreates ?? []).some((item) => item.type === "supplier");
}

function firstSuggestedContact(reviewAction = {}) {
  return preferredSuggestedContact(reviewAction);
}

function isCustomerCreateCandidate(reviewAction = {}) {
  if (reviewAction.workflow === "business_card") {
    return hasSuggestedCustomer(reviewAction);
  }

  const candidate = reviewAction.briefAi?.shelfCycleCandidate ?? null;
  const text = [
    reviewAction.workflow,
    reviewAction.writePlan?.destination,
    reviewAction.writePlan?.recordType,
    candidate?.recordType,
    candidate?.title,
    candidate?.summary
  ].filter(Boolean).join(" ");

  return (
    reviewAction.workflow === "new_customer" ||
    hasSuggestedCustomer(reviewAction) ||
    (candidate?.shouldConsider && /\bcustomer\b/i.test(candidate.recordType || "") && !/\bnote\b/i.test(candidate.recordType || "")) ||
    /\bnew customer\b|\bcustomer create\b|\bcustomers\s*>\s*new customer\b/i.test(text)
  );
}

function isDailyBriefCustomerCreateCandidate(reviewAction = {}, customerTargets = {}) {
  if (reviewAction.workflow === "business_card") {
    return false;
  }

  if (reviewAction.relationship?.relationship !== "customer") {
    return false;
  }

  const hasStrongExistingCustomer = (customerTargets.targetCandidates ?? []).some(
    (candidate) => candidate.id && (candidate.confidence ?? 0) >= 0.75
  );

  if (hasStrongExistingCustomer) {
    return false;
  }

  const participant = preferredExternalParticipant(reviewAction);
  const contact = firstSuggestedContact(reviewAction) ?? {};

  return Boolean(
    participant.email ||
    participant.domain ||
    participant.name ||
    contact.companyName ||
    contact.email
  );
}

function isSupplierCreateCandidate(reviewAction = {}) {
  if (reviewAction.workflow === "business_card") {
    return hasSuggestedSupplier(reviewAction);
  }

  const candidate = reviewAction.briefAi?.shelfCycleCandidate ?? null;
  const text = [
    reviewAction.workflow,
    reviewAction.writePlan?.destination,
    reviewAction.writePlan?.recordType,
    reviewAction.relationship?.relationship,
    candidate?.recordType,
    candidate?.title,
    candidate?.summary
  ].filter(Boolean).join(" ");

  return (
    reviewAction.workflow === "new_supplier" ||
    hasSuggestedSupplier(reviewAction) ||
    (candidate?.shouldConsider && /\bsupplier\b/i.test(candidate.recordType || "") && !/\bnote\b/i.test(candidate.recordType || "")) ||
    /\bnew supplier\b|\bsupplier create\b|\bsuppliers\s*>\s*new supplier\b/i.test(text)
  );
}

function isDailyBriefSupplierCreateCandidate(reviewAction = {}, supplierTargets = {}) {
  if (reviewAction.workflow === "business_card") {
    return false;
  }

  if (reviewAction.relationship?.relationship !== "supplier" || reviewAction.relationship?.subtype === "ops_vendor") {
    return false;
  }

  const hasStrongExistingSupplier = (supplierTargets.targetCandidates ?? []).some(
    (candidate) => candidate.id && (candidate.confidence ?? 0) >= 0.75
  );

  if (hasStrongExistingSupplier) {
    return false;
  }

  const participant = preferredExternalParticipant(reviewAction);
  const contact = firstSuggestedContact(reviewAction) ?? {};

  return Boolean(
    participant.email ||
    participant.domain ||
    participant.name ||
    contact.companyName ||
    contact.email
  );
}

function contactCompanyType(reviewAction = {}, contact = {}) {
  const raw = compactWhitespace(
    contact.companyType ||
    contact.relationshipType ||
    reviewAction.fields?.relationshipType ||
    reviewAction.relationship?.relationship ||
    ""
  ).toLowerCase();

  return raw.includes("supplier") ? "supplier" : "customer";
}

function firstProductMatch(reviewAction = {}) {
  return reviewAction.matches?.products?.[0]?.candidate ?? reviewAction.matches?.product?.[0]?.candidate ?? null;
}

function productTargetFromMatch(product = {}) {
  if (!product) {
    return null;
  }

  const id = compactWhitespace(product.id ?? product.productId ?? "");
  const label = compactWhitespace(product.code ?? product.sku ?? product.name ?? product.productName ?? id);

  if (!id && !label) {
    return null;
  }

  return {
    kind: "product",
    id,
    label: label || id,
    confidence: id ? 0.95 : 0.78,
    matchReasons: [id ? "known ShelfCycle product id available" : "product label can be searched in ShelfCycle"]
  };
}

function firstSupplierTarget(reviewAction = {}) {
  const supplier = reviewAction.matches?.supplier?.[0]?.candidate ?? null;

  if (!supplier?.id) {
    return null;
  }

  return {
    kind: "supplier",
    id: supplier.id,
    label: supplier.name || supplier.companyName || supplier.id,
    confidence: 0.95,
    matchReasons: ["known ShelfCycle supplier id available"]
  };
}

function selectedProductTarget(reviewAction = {}, context = {}, productActionId = "") {
  const selected = context.selectedTarget ?? reviewAction.selectedTargets?.[productActionId] ?? null;

  if (selected?.kind === "product" && (selected.id || selected.label)) {
    return {
      kind: "product",
      id: compactWhitespace(selected.id),
      label: compactWhitespace(selected.label || selected.id),
      confidence: Number(selected.confidence) || 1,
      matchReasons: selected.matchReasons ?? [selected.id ? "user selected product target" : "user selected searchable product label"]
    };
  }

  return productTargetFromMatch(firstProductMatch(reviewAction));
}

function productFieldValues(reviewAction = {}, context = {}) {
  const fieldMap = candidateFieldMap(reviewAction);
  const fields = reviewAction.fields ?? {};
  const writeFields = reviewAction.writePlan?.fields ?? {};

  return {
    mode: compactWhitespace(context.fields?.mode ?? ""),
    code: compactWhitespace(context.fields?.code ?? fields.code ?? writeFields.code ?? fieldMap.code ?? fieldMap.product_code ?? ""),
    productName: compactWhitespace(context.fields?.productName ?? fields.productName ?? writeFields.productName ?? fieldMap.product_name ?? ""),
    productFamily: compactWhitespace(context.fields?.productFamily ?? fields.productFamily ?? writeFields.productFamily ?? fieldMap.product_family ?? fieldMap.product ?? fields.productName ?? ""),
    packagingType: compactWhitespace(context.fields?.packagingType ?? fields.packagingType ?? fieldMap.packaging_type ?? "Fixed"),
    packaging: compactWhitespace(context.fields?.packaging ?? fields.packaging ?? writeFields.packaging ?? fieldMap.packaging ?? ""),
    quantityPerPackage: compactWhitespace(context.fields?.quantityPerPackage ?? fields.quantityPerPackage ?? writeFields.quantityPerPackage ?? fieldMap.quantity_per_package ?? fieldMap.package_qty ?? ""),
    supplierType: compactWhitespace(context.fields?.supplierType ?? fields.supplierType ?? fieldMap.supplier_type ?? "Variable"),
    supplier: compactWhitespace(context.fields?.supplier ?? fields.supplier ?? writeFields.supplier ?? fieldMap.supplier ?? ""),
    casNumber: compactWhitespace(context.fields?.casNumber ?? fields.casNumber ?? writeFields.casNumber ?? fieldMap.cas ?? fieldMap.cas_number ?? ""),
    sdsPath: compactWhitespace(context.fields?.sdsPath ?? fields.sdsPath ?? ""),
    nmfcCode: compactWhitespace(context.fields?.nmfcCode ?? fields.nmfcCode ?? fieldMap.nmfc ?? ""),
    freightClass: compactWhitespace(context.fields?.freightClass ?? fields.freightClass ?? fieldMap.freight_class ?? ""),
    pallet: compactWhitespace(context.fields?.pallet ?? fields.pallet ?? fieldMap.pallet ?? ""),
    packagesPerPallet: compactWhitespace(context.fields?.packagesPerPallet ?? fields.packagesPerPallet ?? fieldMap.packages_per_pallet ?? ""),
    unNumber: compactWhitespace(context.fields?.unNumber ?? fields.unNumber ?? fieldMap.un_number ?? fieldMap.un_na_number ?? ""),
    packingGroup: compactWhitespace(context.fields?.packingGroup ?? fields.packingGroup ?? fieldMap.packing_group ?? ""),
    properShippingName: compactWhitespace(context.fields?.properShippingName ?? fields.properShippingName ?? fieldMap.proper_shipping_name ?? ""),
    documentType: compactWhitespace(context.fields?.documentType ?? reviewAction.documentType ?? fields.documentType ?? fieldMap.document_type ?? ""),
    aiDerivedFields: context.fields?.aiDerivedFields ?? reviewAction.aiDerivedFields ?? []
  };
}

function hasProductUpdateFields(fields = {}) {
  return [
    "code",
    "productName",
    "productFamily",
    "packaging",
    "quantityPerPackage",
    "supplier",
    "casNumber",
    "nmfcCode",
    "freightClass",
    "pallet",
    "packagesPerPallet",
    "unNumber",
    "packingGroup",
    "properShippingName"
  ].some((key) => Boolean(compactWhitespace(fields[key])));
}

function candidateFieldMap(reviewAction = {}) {
  const fields = {};

  for (const item of reviewAction.briefAi?.shelfCycleCandidate?.fields ?? []) {
    const [rawKey, ...rest] = String(item).split(":");

    if (rawKey && rest.length) {
      fields[rawKey.trim().toLowerCase().replace(/\s+/g, "_")] = compactWhitespace(rest.join(":"));
    }
  }

  return fields;
}

function firstMoney(...values) {
  const text = values.map((value) => Array.isArray(value) ? value.join(" ") : value).join(" ");
  return compactWhitespace((text.match(/\$\s*\d+(?:,\d{3})*(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:\/|per)\s*(?:lb|kg|drum|tote|pail|pkg|package)\b/i) ?? [])[0] ?? "");
}

function firstText(...values) {
  return values.map((value) => compactWhitespace(value)).find(Boolean) ?? "";
}

function normalizedLookup(value = "") {
  return compactWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9@.+-]+/g, " ")
    .trim();
}

function phoneDigits(value = "") {
  return compactWhitespace(value).replace(/\D/g, "");
}

function contactKind(candidate = {}) {
  const raw = normalizedLookup(candidate.companyType || candidate.relationshipType || "");

  if (raw.includes("supplier")) {
    return "supplier";
  }

  if (raw.includes("customer") || raw.includes("prospect")) {
    return "customer";
  }

  return "";
}

function normalizedContactCandidate(entry = {}) {
  const candidate = entry.candidate ?? entry;
  const name = compactWhitespace(candidate.name ?? candidate.label ?? "");
  const email = normalizedLookup(candidate.email ?? "");
  const officePhone = phoneDigits(candidate.officePhone ?? candidate.phone ?? "");
  const mobilePhone = phoneDigits(candidate.mobilePhone ?? "");
  const companyName = compactWhitespace(candidate.companyName ?? candidate.company ?? candidate.accountName ?? "");
  const confidence = Math.max(0, Math.min(1, Number(entry.confidence ?? entry.score ?? candidate.confidence ?? candidate.score ?? 0)));

  if (!name && !email && !officePhone && !mobilePhone) {
    return null;
  }

  return {
    id: compactWhitespace(candidate.id ?? candidate.contactId ?? ""),
    name,
    email,
    officePhone,
    mobilePhone,
    companyName,
    kind: contactKind(candidate),
    confidence
  };
}

function contactCompanyMatches(existing = {}, target = null, companyType = "") {
  const existingCompany = normalizedLookup(existing.companyName);
  const targetLabel = normalizedLookup(target?.label ?? "");

  if (existing.kind && companyType && existing.kind !== companyType) {
    return false;
  }

  if (!existingCompany || !targetLabel) {
    return true;
  }

  return existingCompany === targetLabel || existingCompany.includes(targetLabel) || targetLabel.includes(existingCompany);
}

function existingContactMatches(reviewAction = {}, contactFields = {}, { target = null, companyType = "" } = {}) {
  const requestedEmail = normalizedLookup(contactFields.email);
  const requestedName = normalizedLookup(contactFields.name);
  const requestedPhones = [
    phoneDigits(contactFields.officePhone),
    phoneDigits(contactFields.phone),
    phoneDigits(contactFields.mobilePhone)
  ].filter((value) => value.length >= 7);
  const matches = [];

  for (const entry of reviewAction.matches?.contacts ?? []) {
    const existing = normalizedContactCandidate(entry);

    if (!existing || !contactCompanyMatches(existing, target, companyType)) {
      continue;
    }

    const reasons = [];

    if (requestedEmail && existing.email && requestedEmail === existing.email) {
      reasons.push("email already exists in ShelfCycle contacts");
    }

    if (
      requestedPhones.length &&
      [existing.officePhone, existing.mobilePhone].some((phone) => phone && requestedPhones.includes(phone))
    ) {
      reasons.push("phone already exists in ShelfCycle contacts");
    }

    if (requestedName && normalizedLookup(existing.name) === requestedName && (existing.confidence >= 0.82 || contactCompanyMatches(existing, target, companyType))) {
      reasons.push("name and company match an existing ShelfCycle contact");
    }

    if (!reasons.length) {
      continue;
    }

    matches.push({
      kind: "contact",
      id: existing.id,
      label: existing.name || existing.email,
      name: existing.name,
      email: existing.email,
      companyName: existing.companyName,
      confidence: existing.confidence || 0.85,
      matchReasons: reasons
    });
  }

  return matches.sort((left, right) => right.confidence - left.confidence);
}

function updatableSupplierFieldValues(fields = {}) {
  return {
    name: firstText(fields.name),
    phone: firstText(fields.phone),
    email: firstText(fields.email),
    website: firstText(fields.website),
    street1: firstText(fields.street1),
    street2: firstText(fields.street2),
    city: firstText(fields.city),
    country: firstText(fields.country),
    stateRegion: firstText(fields.stateRegion),
    zip: firstText(fields.zip),
    paymentTerms: firstText(fields.paymentTerms),
    creditLimit: firstText(fields.creditLimit),
    achRoutingNumber: firstText(fields.achRoutingNumber),
    achAccountNumber: firstText(fields.achAccountNumber),
    costAccount: firstText(fields.costAccount),
    preferredUnitOfMeasure: firstText(fields.preferredUnitOfMeasure),
    defaultSupplierRep: firstText(fields.defaultSupplierRep)
  };
}

function hasSupplierUpdateFields(fields = {}) {
  return [
    "phone",
    "email",
    "website",
    "street1",
    "street2",
    "city",
    "country",
    "stateRegion",
    "zip",
    "paymentTerms",
    "creditLimit",
    "achRoutingNumber",
    "achAccountNumber",
    "costAccount",
    "preferredUnitOfMeasure",
    "defaultSupplierRep"
  ].some((key) => Boolean(compactWhitespace(fields[key])));
}

function shouldOfferSupplierUpdate(reviewAction = {}, supplierTargets = {}, supplierFields = {}) {
  const supplierContext = reviewAction.relationship?.relationship === "supplier" ||
    reviewAction.workflow === "business_card" ||
    hasSuggestedSupplier(reviewAction) ||
    isSupplierCreateCandidate(reviewAction) ||
    isDailyBriefSupplierCreateCandidate(reviewAction, supplierTargets);

  if (!supplierContext) {
    return false;
  }

  return Boolean(supplierTargets.targetCandidates?.length || compactWhitespace(supplierFields.name));
}

function searchableSupplierUpdateTarget(supplierTargets = {}, supplierFields = {}) {
  const target = supplierTargets.selectedTarget ?? (supplierTargets.targetCandidates?.length === 1 ? supplierTargets.targetCandidates[0] : null);

  if (target?.label) {
    return target;
  }

  const label = compactWhitespace(supplierFields.name);

  if (!label) {
    return null;
  }

  return {
    kind: "supplier",
    id: "",
    label,
    confidence: 0.7,
    matchReasons: ["Proposed supplier name will be searched in ShelfCycle before updating."]
  };
}

function contactUpdateCandidates(duplicateContacts = []) {
  return duplicateContacts
    .map((candidate) => ({
      kind: "contact",
      id: compactWhitespace(candidate.id ?? ""),
      label: compactWhitespace(candidate.label ?? candidate.name ?? candidate.email ?? ""),
      confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || 0.85)),
      matchReasons: candidate.matchReasons ?? ["existing ShelfCycle contact matched this card or thread"]
    }))
    .filter((candidate) => candidate.label || candidate.id);
}

function hasAiCandidateType(reviewAction = {}, pattern) {
  const candidate = reviewAction.briefAi?.shelfCycleCandidate ?? null;
  return Boolean(candidate?.shouldConsider && pattern.test(`${candidate.recordType || ""} ${candidate.title || ""} ${candidate.summary || ""}`));
}

function businessCardExistingCompanyTarget(reviewAction = {}) {
  if (reviewAction.workflow !== "business_card") {
    return null;
  }

  const entryMode = compactWhitespace(reviewAction.businessCard?.entryMode || "");
  const kind = entryMode === "existing_supplier_contact"
    ? "supplier"
    : entryMode === "existing_customer_contact"
      ? "customer"
      : "";
  const label = compactWhitespace(reviewAction.selectedTarget?.label || reviewAction.fields?.companyName || "");

  if (!kind || !label) {
    return null;
  }

  return {
    kind,
    id: compactWhitespace(reviewAction.selectedTarget?.id || ""),
    label,
    confidence: 0.9,
    matchReasons: ["Business-card contact-only mode selected this existing company target."]
  };
}

export function collectProposedActions(reviewAction = {}, context = {}) {
  const proposed = [];
  const noteFields = buildNoteFields(reviewAction);
  const note = makeBaseAction(reviewAction, SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE, "Add customer note to ShelfCycle");
  const businessCardDefaultTarget = businessCardExistingCompanyTarget(reviewAction);
  const customerTargets = resolveCustomerTargets(reviewAction, {
    selectedTarget: context.selectedTarget ??
      reviewAction.selectedTargets?.[note.id] ??
      reviewAction.selectedTarget ??
      (businessCardDefaultTarget?.kind === "customer" ? businessCardDefaultTarget : null)
  });
  const supplierTargets = resolveSupplierTargets(reviewAction, {
    selectedTarget: context.selectedTarget ??
      reviewAction.selectedTarget ??
      (businessCardDefaultTarget?.kind === "supplier" ? businessCardDefaultTarget : null)
  });
  const searchableCustomerTarget = customerTargets.selectedTarget ?? (customerTargets.targetCandidates.length === 1 ? customerTargets.targetCandidates[0] : null);
  const warnings = [];

  note.requiredFields = ["selectedTarget.label", "fields.note"];
  note.fieldValues = {
    date: compactWhitespace(context.fields?.date ?? noteFields.date),
    type: compactWhitespace(context.fields?.type ?? noteFields.type),
    title: compactWhitespace(context.fields?.title ?? noteFields.title),
    note: normalizeShelfCycleNoteText(context.fields?.note ?? noteFields.summary),
    mentions: []
  };
  note.targetCandidates = customerTargets.targetCandidates;
  note.selectedTarget = customerTargets.selectedTarget;
  note.fieldValues.mentions = collectNoteMentionCandidates(reviewAction, {
    selectedTarget: note.selectedTarget
  });
  note.confidence = customerTargets.selectedTarget?.confidence ?? customerTargets.targetCandidates[0]?.confidence ?? 0;

  if (!note.selectedTarget && !note.targetCandidates.length) {
    warnings.push("No resolved ShelfCycle customer target.");
  }

  if (!note.selectedTarget && note.targetCandidates.length > 1) {
    warnings.push("Select a ShelfCycle customer before submitting.");
  }

  if (!note.selectedTarget && note.targetCandidates.length === 1) {
    warnings.push("Low-confidence target match.");
  }

  if (!note.fieldValues.note) {
    warnings.push("Missing required note body.");
  }

  if (!note.sourceEvidence.length) {
    warnings.push("Missing source evidence.");
  }

  note.warnings = warnings;
  note.executable = Boolean(
    note.selectedTarget?.label &&
    note.fieldValues.note &&
    note.sourceEvidence.length &&
    !warnings.length
  );

  if (reviewAction.workflow !== "business_card") {
    proposed.push(note);
  }

  if (isCustomerCreateCandidate(reviewAction) || isDailyBriefCustomerCreateCandidate(reviewAction, customerTargets)) {
    const customerAction = makeBaseAction(reviewAction, SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE, "Create customer in ShelfCycle");
    const customerFields = collectCustomerCreateFields(reviewAction, context);
    const requirementResult = customerRequirementsForFields(customerFields);
    const customerWarnings = [];
    const possibleExistingMatches = customerTargets.targetCandidates.filter((candidate) => (candidate.confidence ?? 0) >= 0.75);

    customerAction.requiredFields = ["fields.name"];
    customerAction.fieldValues = {
      ...requirementResult.fields,
      requirements: requirementResult.requirements,
      missingRequiredFields: requirementResult.missingRequiredFields,
      missingRecommendedFields: requirementResult.missingRecommendedFields,
      internalDecisionFields: requirementResult.internalDecisionFields
    };
    customerAction.targetCandidates = customerTargets.targetCandidates;
    customerAction.confidence = customerAction.fieldValues.name
      ? (customerAction.fieldValues.website || customerAction.fieldValues.email || customerAction.fieldValues.phoneNumber ? 0.82 : 0.68)
      : 0;

    if (!customerAction.fieldValues.name) {
      customerWarnings.push("Customer creation requires the ShelfCycle required Name field.");
    }

    if (possibleExistingMatches.length) {
      customerWarnings.push("Possible existing ShelfCycle customer match found; review before creating a duplicate customer.");
      customerAction.displayLabel = "Existing ShelfCycle customer match - review instead of creating";
    }

    customerAction.duplicateCandidates = possibleExistingMatches;
    customerAction.warnings = customerWarnings;
    customerAction.executable = Boolean(customerAction.fieldValues.name && !customerWarnings.length);
    proposed.push(customerAction);
  }

  if (isSupplierCreateCandidate(reviewAction) || isDailyBriefSupplierCreateCandidate(reviewAction, supplierTargets)) {
    const supplierAction = makeBaseAction(reviewAction, SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE, "Create supplier in ShelfCycle");
    const supplierFields = collectSupplierCreateFields(reviewAction, context);
    const requirementResult = supplierRequirementsForFields(supplierFields);
    const supplierWarnings = [];
    const possibleExistingMatches = supplierTargets.targetCandidates.filter((candidate) => (candidate.confidence ?? 0) >= 0.75);

    supplierAction.requiredFields = ["fields.name"];
    supplierAction.fieldValues = {
      ...requirementResult.fields,
      requirements: requirementResult.requirements,
      missingRequiredFields: requirementResult.missingRequiredFields,
      missingRecommendedFields: requirementResult.missingRecommendedFields,
      internalDecisionFields: requirementResult.internalDecisionFields
    };
    supplierAction.targetCandidates = supplierTargets.targetCandidates;
    supplierAction.confidence = supplierAction.fieldValues.name
      ? (supplierAction.fieldValues.website || supplierAction.fieldValues.email || supplierAction.fieldValues.phone ? 0.82 : 0.68)
      : 0;

    if (!supplierAction.fieldValues.name) {
      supplierWarnings.push("Supplier creation requires the ShelfCycle required Name field.");
    }

    if (possibleExistingMatches.length) {
      supplierWarnings.push("Possible existing ShelfCycle supplier match found; review before creating a duplicate supplier.");
      supplierAction.displayLabel = "Existing ShelfCycle supplier match - review instead of creating";
    }

    supplierAction.duplicateCandidates = possibleExistingMatches;
    supplierAction.warnings = supplierWarnings;
    supplierAction.executable = Boolean(supplierAction.fieldValues.name && !supplierWarnings.length);
    proposed.push(supplierAction);
  }

  const supplierUpdateFields = updatableSupplierFieldValues(supplierRequirementsForFields(collectSupplierCreateFields(reviewAction, context)).fields);

  if (shouldOfferSupplierUpdate(reviewAction, supplierTargets, supplierUpdateFields)) {
    const supplierUpdateAction = makeBaseAction(reviewAction, SHELFCYCLE_ACTION_TYPES.SUPPLIER_UPDATE, "Update existing supplier in ShelfCycle");
    const target = searchableSupplierUpdateTarget(supplierTargets, supplierUpdateFields);
    const supplierUpdateWarnings = [];

    supplierUpdateAction.requiredFields = ["selectedTarget.label"];
    supplierUpdateAction.fieldValues = supplierUpdateFields;
    supplierUpdateAction.targetCandidates = supplierTargets.targetCandidates.length ? supplierTargets.targetCandidates : (target ? [target] : []);
    supplierUpdateAction.selectedTarget = target;
    supplierUpdateAction.confidence = target?.confidence ?? supplierTargets.targetCandidates[0]?.confidence ?? 0;

    if (!target?.label) {
      supplierUpdateWarnings.push("Select the existing ShelfCycle supplier before updating.");
    }

    if (!hasSupplierUpdateFields(supplierUpdateFields)) {
      supplierUpdateWarnings.push("No supplier fields were found to update.");
    }

    if (!target?.id) {
      supplierUpdateAction.requiredFields = ["selectedTarget.label"];
    }

    supplierUpdateAction.warnings = supplierUpdateWarnings;
    supplierUpdateAction.executable = Boolean(target?.label && hasSupplierUpdateFields(supplierUpdateFields) && !supplierUpdateWarnings.length);
    proposed.push(supplierUpdateAction);
  }

  if (hasSuggestedContact(reviewAction)) {
    const contact = firstSuggestedContact(reviewAction);
    const contactAction = makeBaseAction(reviewAction, SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE, "Create contact in ShelfCycle");
    const contactWarnings = [];
    const companyType = contactCompanyType(reviewAction, contact);
    const targetSet = companyType === "supplier" ? supplierTargets : customerTargets;
    const target = targetSet.selectedTarget ?? (targetSet.targetCandidates.length === 1 ? targetSet.targetCandidates[0] : null);
    const documentTypes = normalizeContactDocumentTypes(
      companyType,
      Array.isArray(context.fields?.documentTypes)
        ? context.fields.documentTypes
        : contact?.documentTypes
    );

    contactAction.requiredFields = ["selectedTarget.id", "fields.name_or_email"];
    contactAction.selectedTarget = target;
    contactAction.targetCandidates = targetSet.targetCandidates;
    contactAction.confidence = target?.confidence ?? 0;
    contactAction.fieldValues = {
      name: firstText(context.fields?.name, contact?.name),
      title: firstText(context.fields?.title, contact?.title, contact?.role),
      email: firstText(context.fields?.email, contact?.email),
      officePhone: firstText(
        context.fields?.officePhone,
        context.fields?.phone,
        contact?.phone,
        companyType === "supplier" ? context.fields?.mobilePhone : "",
        companyType === "supplier" ? contact?.mobilePhone : ""
      ),
      phone: firstText(
        context.fields?.phone,
        context.fields?.officePhone,
        contact?.phone,
        companyType === "supplier" ? context.fields?.mobilePhone : "",
        companyType === "supplier" ? contact?.mobilePhone : ""
      ),
      mobilePhone: firstText(context.fields?.mobilePhone, contact?.mobilePhone),
      faxPhone: firstText(context.fields?.faxPhone, contact?.faxPhone),
      companyType,
      documentTypes
    };
    const duplicateContacts = existingContactMatches(reviewAction, contactAction.fieldValues, {
      target,
      companyType
    });

    if (!target?.label) {
      contactWarnings.push(`Select a ShelfCycle ${companyType} before creating this contact.`);
    }

    if (!target?.id) {
      contactAction.requiredFields = ["selectedTarget.label", "fields.name_or_email"];
    }

    if (companyType === "supplier" && !contactAction.fieldValues.title) {
      contactWarnings.push("Supplier contact creation requires the ShelfCycle required Title field.");
      contactAction.requiredFields = [...new Set([...contactAction.requiredFields, "fields.title"])];
    }

    if (!contactAction.fieldValues.name && !contactAction.fieldValues.email) {
      contactWarnings.push("Contact creation requires at least a name or email.");
    }

    if (duplicateContacts.length) {
      contactWarnings.push("Existing ShelfCycle contact match found; review before creating a duplicate contact.");
      contactAction.displayLabel = "Existing ShelfCycle contact match - review instead of creating";
    }

    contactAction.duplicateCandidates = duplicateContacts;
    contactAction.warnings = contactWarnings;
    contactAction.executable = Boolean(target?.label && (contactAction.fieldValues.name || contactAction.fieldValues.email) && !contactWarnings.length);
    proposed.push(contactAction);

    if (duplicateContacts.length) {
      const contactUpdateAction = makeBaseAction(reviewAction, SHELFCYCLE_ACTION_TYPES.CONTACT_UPDATE, "Update existing contact in ShelfCycle");
      const updateCandidates = contactUpdateCandidates(duplicateContacts);
      const selectedContactTarget = context.selectedTarget?.kind === "contact"
        ? context.selectedTarget
        : null;
      const updateTarget = selectedContactTarget ?? (updateCandidates.length === 1 ? updateCandidates[0] : null);
      const contactUpdateWarnings = [];

      contactUpdateAction.requiredFields = ["selectedTarget.label", "fields.name_or_email"];
      contactUpdateAction.selectedTarget = updateTarget;
      contactUpdateAction.targetCandidates = updateCandidates;
      contactUpdateAction.confidence = updateTarget?.confidence ?? updateCandidates[0]?.confidence ?? 0;
      contactUpdateAction.fieldValues = {
        ...contactAction.fieldValues,
        companyTarget: target,
        existingCompanyType: companyType
      };

      if (!updateTarget?.label) {
        contactUpdateWarnings.push("Select the existing ShelfCycle contact before updating.");
      }

      if (!contactUpdateAction.fieldValues.name && !contactUpdateAction.fieldValues.email) {
        contactUpdateWarnings.push("Contact update requires at least a name or email.");
      }

      contactUpdateAction.warnings = contactUpdateWarnings;
      contactUpdateAction.executable = Boolean(updateTarget?.label && (contactUpdateAction.fieldValues.name || contactUpdateAction.fieldValues.email) && !contactUpdateWarnings.length);
      proposed.push(contactUpdateAction);
    }
  }

  if (hasActionKey(reviewAction, "documents") || hasAiCandidateType(reviewAction, /\b(document|sds|tds|coa)\b/i)) {
    const documentAction = makeBaseAction(reviewAction, SHELFCYCLE_ACTION_TYPES.PRODUCT_DOCUMENT_FOLLOWUP, "Upload product document to ShelfCycle");
    const productTarget = selectedProductTarget(reviewAction, context, documentAction.id);
    const attachments = reviewAction.workspaceArtifacts?.attachments ?? [];
    const localAttachment = attachments.find((attachment) => attachment.localPath || attachment.path) ?? null;
    const documentWarnings = [];

    documentAction.selectedTarget = productTarget;
    documentAction.requiredFields = ["selectedTarget.id", "fields.filePath"];
    documentAction.fieldValues = {
      filePath: compactWhitespace(context.fields?.filePath ?? localAttachment?.localPath ?? localAttachment?.path ?? ""),
      documentType: compactWhitespace(context.fields?.documentType ?? localAttachment?.documentType ?? "")
    };

    if (!productTarget?.id) {
      documentWarnings.push("Select a ShelfCycle product before uploading documents.");
    }

    if (!documentAction.fieldValues.filePath) {
      documentWarnings.push("Document upload requires a local file path, not just Gmail attachment metadata.");
    }

    documentAction.warnings = documentWarnings;
    documentAction.executable = Boolean(productTarget?.id && documentAction.fieldValues.filePath && !documentWarnings.length);
    proposed.push(documentAction);
  }

  if (hasActionKey(reviewAction, "pricing") || hasAiCandidateType(reviewAction, /\b(pricing|price|quote)\b/i)) {
    const pricingAction = makeBaseAction(reviewAction, SHELFCYCLE_ACTION_TYPES.PRICING_RECORD, "Create price-book record in ShelfCycle");
    const fieldMap = candidateFieldMap(reviewAction);
    const product = firstProductMatch(reviewAction);
    const target = searchableCustomerTarget;
    const price = compactWhitespace(context.fields?.pricePerUnit ?? fieldMap.price ?? firstMoney(reviewAction.summary, reviewAction.briefAi?.keyDetails, reviewAction.briefAi?.shelfCycleCandidate?.summary));
    const pricingWarnings = [];

    pricingAction.selectedTarget = target;
    pricingAction.targetCandidates = customerTargets.targetCandidates;
    pricingAction.requiredFields = ["fields.customerName", "fields.productCode_or_productName", "fields.price"];
    pricingAction.fieldValues = {
      customerName: compactWhitespace(context.fields?.customerName ?? target?.label ?? ""),
      productCode: compactWhitespace(context.fields?.productCode ?? product?.code ?? fieldMap.product_code ?? ""),
      productName: compactWhitespace(context.fields?.productName ?? product?.name ?? fieldMap.product ?? ""),
      pricePerUnit: price,
      pricePerPackage: compactWhitespace(context.fields?.pricePerPackage ?? fieldMap.price_per_package ?? ""),
      dateFrom: compactWhitespace(context.fields?.dateFrom ?? ""),
      dateTo: compactWhitespace(context.fields?.dateTo ?? ""),
      note: normalizeShelfCycleNoteText(context.fields?.note ?? noteFields.summary)
    };

    if (!pricingAction.fieldValues.customerName) {
      pricingWarnings.push("Pricing record requires a ShelfCycle customer.");
    }

    if (!customerTargets.selectedTarget && customerTargets.targetCandidates.length > 1) {
      pricingWarnings.push("Select a ShelfCycle customer before creating this pricing record.");
    }

    if (!pricingAction.fieldValues.productCode && !pricingAction.fieldValues.productName) {
      pricingWarnings.push("Pricing record requires a ShelfCycle product code or product name.");
    }

    if (!pricingAction.fieldValues.pricePerUnit && !pricingAction.fieldValues.pricePerPackage) {
      pricingWarnings.push("Pricing record requires a price.");
    }

    pricingAction.warnings = pricingWarnings;
    pricingAction.executable = Boolean(!pricingWarnings.length);
    proposed.push(pricingAction);
  }

  if (hasActionKey(reviewAction, "logistics")) {
    const logisticsAction = makeBaseAction(reviewAction, SHELFCYCLE_ACTION_TYPES.ORDER_OR_LOGISTICS_NOTE, "Create order or logistics note in ShelfCycle");
    const target = customerTargets.selectedTarget ?? firstSupplierTarget(reviewAction);
    const logisticsWarnings = [];

    logisticsAction.selectedTarget = target;
    logisticsAction.targetCandidates = customerTargets.targetCandidates;
    logisticsAction.requiredFields = ["selectedTarget.id", "fields.note"];
    logisticsAction.fieldValues = {
      date: compactWhitespace(context.fields?.date ?? noteFields.date),
      type: compactWhitespace(context.fields?.type ?? "Email"),
      title: compactWhitespace(context.fields?.title ?? noteFields.title ?? reviewAction.subject ?? "Logistics follow-up"),
      note: normalizeShelfCycleNoteText(context.fields?.note ?? noteFields.summary),
      mentions: collectNoteMentionCandidates(reviewAction, {
        selectedTarget: target?.kind === "customer" ? target : null
      })
    };

    if (!target?.id) {
      logisticsWarnings.push("Logistics note requires a resolved ShelfCycle customer or supplier target.");
    }

    if (!logisticsAction.fieldValues.note) {
      logisticsWarnings.push("Logistics note requires a note body.");
    }

    logisticsAction.warnings = logisticsWarnings;
    logisticsAction.executable = Boolean(target?.id && logisticsAction.fieldValues.note && !logisticsWarnings.length);
    proposed.push(logisticsAction);
  }

  if (reviewAction.workflow === "new_product" || hasAiCandidateType(reviewAction, /\b(product|catalog)\b/i)) {
    const productAction = makeBaseAction(reviewAction, SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE, "Create product code in ShelfCycle");
    const productWarnings = [];
    const existingProduct = firstProductMatch(reviewAction);
    const selectedProduct = selectedProductTarget(reviewAction, context, productAction.id);
    const isUpdate = Boolean(selectedProduct?.label);

    productAction.requiredFields = isUpdate
      ? ["selectedTarget.label"]
      : ["fields.code", "fields.productFamily", "fields.packaging", "fields.quantityPerPackage"];
    productAction.fieldValues = {
      ...productFieldValues(reviewAction, context),
      mode: isUpdate ? "update" : "create"
    };
    productAction.selectedTarget = selectedProduct;
    productAction.targetCandidates = selectedProduct ? [selectedProduct] : [];
    productAction.confidence = selectedProduct?.confidence ?? (productAction.fieldValues.code ? 0.75 : 0.35);

    if (isUpdate) {
      productAction.displayLabel = "Update existing product in ShelfCycle";

      if (!hasProductUpdateFields(productAction.fieldValues)) {
        productWarnings.push("No product fields were found to update.");
      }

      productAction.duplicateCandidates = [{
        id: compactWhitespace(existingProduct?.id ?? existingProduct?.productId ?? selectedProduct?.id ?? ""),
        label: compactWhitespace(existingProduct?.code ?? existingProduct?.sku ?? existingProduct?.name ?? selectedProduct?.label ?? "Matched product"),
        confidence: selectedProduct?.confidence ?? 0.9,
        matchReasons: ["product already appears to exist in ShelfCycle; update instead of creating a duplicate"]
      }];
    } else {
      for (const [key, message] of [
        ["code", "Product creation requires a product code."],
        ["productFamily", "Product creation requires a product family."],
        ["packaging", "Product creation requires packaging."],
        ["quantityPerPackage", "Product creation requires quantity per package."]
      ]) {
        if (!productAction.fieldValues[key]) {
          productWarnings.push(message);
        }
      }
    }

    productAction.warnings = productWarnings;
    productAction.executable = Boolean(
      isUpdate
        ? selectedProduct?.label && hasProductUpdateFields(productAction.fieldValues) && !productWarnings.length
        : !productWarnings.length
    );
    proposed.push(productAction);
  }

  if (!proposed.some((action) => action.actionType !== SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE)) {
    proposed.push(unsupportedAction(
      reviewAction,
      SHELFCYCLE_ACTION_TYPES.REVIEW_ONLY,
      "Review packet manually",
      "No additional validated ShelfCycle action type is available for this packet yet."
    ));
  }

  return proposed;
}

export function collectExecutableActions(reviewAction = {}, context = {}) {
  return collectProposedActions(reviewAction, context)
    .filter((action) => action.executable)
    .map((action) => ({
      key: action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE ? "create_note" : action.actionType,
      id: action.id,
      actionType: action.actionType,
      label: action.displayLabel,
      description: action.selectedTarget?.label
        ? `Create a new note under ${action.selectedTarget.label} after approval.`
        : action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE
          ? `Create ${action.fieldValues?.name || "a new customer"} after approval.`
          : action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE
            ? `Create ${action.fieldValues?.name || "a new supplier"} after approval.`
            : action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_UPDATE
              ? `Update ${action.selectedTarget?.label || "the existing supplier"} after approval.`
              : action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_UPDATE
                ? `Update ${action.selectedTarget?.label || "the existing contact"} after approval.`
            : "Create a new ShelfCycle action after approval.",
      recordType: action.actionType,
      submitEndpoint: action.submitEndpoint
    }));
}

export function findProposedAction(reviewAction = {}, { actionId = "", actionType = "", selectedTarget = null, fields = {} } = {}) {
  const proposedActions = collectProposedActions(reviewAction, { selectedTarget, fields });
  return proposedActions.find((action) => {
    if (actionId && action.id !== actionId) {
      return false;
    }

    return action.actionType === actionType;
  }) ?? null;
}
