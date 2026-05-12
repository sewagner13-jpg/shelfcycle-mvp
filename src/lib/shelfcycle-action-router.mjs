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
  SUPPLIER_NOTE: "supplier_note",
  CONTACT_CREATE: "contact_create",
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

  if (selected?.kind === "product" && selected.id) {
    return selected;
  }

  const product = firstProductMatch(reviewAction);

  if (!product?.id) {
    return null;
  }

  return {
    kind: "product",
    id: product.id,
    label: product.code || product.name || product.id,
    confidence: 0.95,
    matchReasons: ["known ShelfCycle product id available"]
  };
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
    }

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
    }

    supplierAction.warnings = supplierWarnings;
    supplierAction.executable = Boolean(supplierAction.fieldValues.name && !supplierWarnings.length);
    proposed.push(supplierAction);
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

    contactAction.warnings = contactWarnings;
    contactAction.executable = Boolean(target?.label && (contactAction.fieldValues.name || contactAction.fieldValues.email) && !contactWarnings.length);
    proposed.push(contactAction);
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

  if (hasAiCandidateType(reviewAction, /\b(product|catalog)\b/i)) {
    const fieldMap = candidateFieldMap(reviewAction);
    const productAction = makeBaseAction(reviewAction, SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE, "Create product code in ShelfCycle");
    const productWarnings = [];

    productAction.requiredFields = ["fields.code", "fields.productFamily", "fields.packaging", "fields.quantityPerPackage"];
    productAction.fieldValues = {
      code: compactWhitespace(context.fields?.code ?? fieldMap.code ?? fieldMap.product_code ?? ""),
      productFamily: compactWhitespace(context.fields?.productFamily ?? fieldMap.product_family ?? fieldMap.product ?? ""),
      packagingType: compactWhitespace(context.fields?.packagingType ?? fieldMap.packaging_type ?? "Fixed"),
      packaging: compactWhitespace(context.fields?.packaging ?? fieldMap.packaging ?? ""),
      quantityPerPackage: compactWhitespace(context.fields?.quantityPerPackage ?? fieldMap.quantity_per_package ?? fieldMap.package_qty ?? ""),
      supplierType: compactWhitespace(context.fields?.supplierType ?? fieldMap.supplier_type ?? "Variable"),
      supplier: compactWhitespace(context.fields?.supplier ?? fieldMap.supplier ?? ""),
      casNumber: compactWhitespace(context.fields?.casNumber ?? fieldMap.cas ?? fieldMap.cas_number ?? ""),
      sdsPath: compactWhitespace(context.fields?.sdsPath ?? ""),
      nmfcCode: compactWhitespace(context.fields?.nmfcCode ?? fieldMap.nmfc ?? ""),
      freightClass: compactWhitespace(context.fields?.freightClass ?? fieldMap.freight_class ?? ""),
      pallet: compactWhitespace(context.fields?.pallet ?? fieldMap.pallet ?? ""),
      packagesPerPallet: compactWhitespace(context.fields?.packagesPerPallet ?? fieldMap.packages_per_pallet ?? ""),
      unNumber: compactWhitespace(context.fields?.unNumber ?? fieldMap.un_number ?? fieldMap.un_na_number ?? ""),
      packingGroup: compactWhitespace(context.fields?.packingGroup ?? fieldMap.packing_group ?? ""),
      properShippingName: compactWhitespace(context.fields?.properShippingName ?? fieldMap.proper_shipping_name ?? "")
    };

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

    productAction.warnings = productWarnings;
    productAction.executable = Boolean(!productWarnings.length);
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
