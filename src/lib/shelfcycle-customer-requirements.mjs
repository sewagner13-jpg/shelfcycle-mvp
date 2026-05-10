import { asTitle, compactWhitespace, firstNonEmpty, isLikelyCompanyName } from "./normalize.mjs";

export const SHELFCYCLE_CUSTOMER_FIELDS = Object.freeze([
  {
    key: "name",
    label: "Name",
    shelfCycleLabel: "Name",
    level: "required",
    source: "ShelfCycle New Customer form"
  },
  {
    key: "email",
    label: "Email",
    shelfCycleLabel: "Email",
    level: "recommended",
    source: "public/company/contact info"
  },
  {
    key: "website",
    label: "Website",
    shelfCycleLabel: "Website",
    level: "recommended",
    source: "public company website"
  },
  {
    key: "phoneNumber",
    label: "Phone Number",
    shelfCycleLabel: "Phone Number",
    level: "recommended",
    source: "public company/contact info"
  },
  {
    key: "streetAddress",
    label: "Street Address",
    shelfCycleLabel: "Street Address",
    level: "recommended",
    source: "public company/contact info"
  },
  {
    key: "streetAddress2",
    label: "Street Address 2",
    shelfCycleLabel: "Street Address 2",
    level: "optional",
    source: "public company/contact info"
  },
  {
    key: "city",
    label: "City",
    shelfCycleLabel: "City",
    level: "recommended",
    source: "public company/contact info"
  },
  {
    key: "stateRegion",
    label: "State / Region",
    shelfCycleLabel: "State / Region",
    level: "recommended",
    source: "public company/contact info"
  },
  {
    key: "zip",
    label: "Zip",
    shelfCycleLabel: "Zip",
    level: "recommended",
    source: "public company/contact info"
  },
  {
    key: "country",
    label: "Country",
    shelfCycleLabel: "Country",
    level: "recommended",
    source: "public company/contact info"
  },
  {
    key: "creditLimit",
    label: "Credit Limit",
    shelfCycleLabel: "Credit Limit",
    level: "internal",
    source: "ClearEdge decision, not public web"
  },
  {
    key: "paymentTerm",
    label: "Payment Term",
    shelfCycleLabel: "Payment Term",
    level: "internal",
    source: "ClearEdge decision, not public web"
  },
  {
    key: "defaultSalesPerson",
    label: "Default Sales Person",
    shelfCycleLabel: "Default Sales Person",
    level: "internal",
    source: "ClearEdge assignment"
  },
  {
    key: "defaultCsr",
    label: "Default CSR",
    shelfCycleLabel: "Default CSR",
    level: "internal",
    source: "ClearEdge assignment"
  },
  {
    key: "prospect",
    label: "Create as Prospect",
    shelfCycleLabel: "Create as Prospect",
    level: "optional",
    source: "Sean approval"
  }
]);

function splitAddress(address = "") {
  const parts = compactWhitespace(address)
    .split(",")
    .map((part) => compactWhitespace(part))
    .filter(Boolean);

  if (!parts.length) {
    return {};
  }

  const output = {
    streetAddress: parts[0] ?? "",
    city: parts[1] ?? "",
    stateRegion: "",
    zip: "",
    country: ""
  };
  const stateZip = parts[2] ?? "";
  const stateZipMatch = /\b([A-Z]{2})\b\s*(\d{5}(?:-\d{4})?)?/i.exec(stateZip);

  if (stateZipMatch) {
    output.stateRegion = stateZipMatch[1].toUpperCase();
    output.zip = stateZipMatch[2] ?? "";
  } else if (stateZip) {
    output.stateRegion = stateZip;
  }

  if (parts[3]) {
    output.country = /^(us|usa|united states)$/i.test(parts[3]) ? "United States" : parts[3];
  }

  return output;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  return /\b(true|yes|y|prospect)\b/i.test(String(value || ""));
}

export function normalizeCustomerCreateFields(input = {}) {
  const addressParts = splitAddress(firstNonEmpty(input.address, input.primaryBillingAddress, input.primary_billing_address));

  return {
    name: compactWhitespace(firstNonEmpty(input.name, input.companyName, input.customerName, input.accountName, input.company)),
    email: compactWhitespace(firstNonEmpty(input.email, input.companyEmail, input.contactEmail)),
    website: compactWhitespace(firstNonEmpty(input.website, input.url, input.domain)),
    phoneNumber: compactWhitespace(firstNonEmpty(input.phoneNumber, input.phone, input.officePhone, input.mainPhone)),
    streetAddress: compactWhitespace(firstNonEmpty(input.streetAddress, input.street1, input.address1, addressParts.streetAddress)),
    streetAddress2: compactWhitespace(firstNonEmpty(input.streetAddress2, input.street2, input.address2)),
    city: compactWhitespace(firstNonEmpty(input.city, addressParts.city)),
    stateRegion: compactWhitespace(firstNonEmpty(input.stateRegion, input.state, input.region, addressParts.stateRegion)),
    zip: compactWhitespace(firstNonEmpty(input.zip, input.postalCode, input.postal, addressParts.zip)),
    country: compactWhitespace(firstNonEmpty(input.country, addressParts.country)),
    creditLimit: compactWhitespace(firstNonEmpty(input.creditLimit, input.credit_limit)),
    paymentTerm: compactWhitespace(firstNonEmpty(input.paymentTerm, input.paymentTerms, input.terms)),
    defaultSalesPerson: compactWhitespace(firstNonEmpty(input.defaultSalesPerson, input.salesPerson, input.owner)),
    defaultCsr: compactWhitespace(firstNonEmpty(input.defaultCsr, input.customerServiceRepresentative, input.csr)),
    prospect: normalizeBoolean(input.prospect ?? input.createAsProspect)
  };
}

export function customerRequirementsForFields(fields = {}) {
  const normalized = normalizeCustomerCreateFields(fields);
  const requirements = SHELFCYCLE_CUSTOMER_FIELDS.map((field) => ({
    ...field,
    value: normalized[field.key],
    present: field.key === "prospect" ? Boolean(normalized[field.key]) : Boolean(compactWhitespace(normalized[field.key]))
  }));

  return {
    fields: normalized,
    requirements,
    missingRequiredFields: requirements
      .filter((field) => field.level === "required" && !field.present)
      .map((field) => field.key),
    missingRecommendedFields: requirements
      .filter((field) => field.level === "recommended" && !field.present)
      .map((field) => field.key),
    internalDecisionFields: requirements
      .filter((field) => field.level === "internal" && !field.present)
      .map((field) => field.key)
  };
}

function fieldMapFromAiCandidate(reviewAction = {}) {
  const fields = {};

  for (const item of reviewAction.briefAi?.shelfCycleCandidate?.fields ?? []) {
    const [rawKey, ...rest] = String(item).split(":");

    if (rawKey && rest.length) {
      fields[rawKey.trim().toLowerCase().replace(/\s+/g, "_")] = compactWhitespace(rest.join(":"));
    }
  }

  return fields;
}

function companyNameFromDomain(domain = "") {
  const clean = compactWhitespace(domain)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(".")[0]
    .replace(/[-_]+/g, " ");

  return clean ? asTitle(clean) : "";
}

export function collectCustomerCreateFields(reviewAction = {}, context = {}) {
  const suggestedCustomer = (reviewAction.suggestedCreates ?? []).find((item) => item.type === "customer") ?? {};
  const suggestedContact = (reviewAction.suggestedCreates ?? []).find((item) => item.type === "contact") ?? {};
  const fieldMap = fieldMapFromAiCandidate(reviewAction);
  const participant = reviewAction.externalParticipants?.[0] ?? {};
  const allowPersonFieldsAsCompanyFields = reviewAction.workflow !== "business_card";
  const contextFields = allowPersonFieldsAsCompanyFields
    ? (context.fields ?? {})
    : {
        ...(context.fields ?? {}),
        email: "",
        phone: "",
        phoneNumber: "",
        officePhone: "",
        mobilePhone: ""
      };
  const domain = participant.domain ? `https://${participant.domain}` : "";
  const participantCompanyName = isLikelyCompanyName(participant.name)
    ? participant.name
    : "";

  return normalizeCustomerCreateFields({
    ...reviewAction.writePlan?.fields,
    ...reviewAction.fields,
    ...fieldMap,
    ...suggestedCustomer,
    name: firstNonEmpty(
      context.fields?.name,
      suggestedCustomer.name,
      suggestedCustomer.companyName,
      reviewAction.fields?.name,
      reviewAction.fields?.customerName,
      reviewAction.fields?.companyName,
      fieldMap.customer,
      fieldMap.customer_name,
      participantCompanyName,
      suggestedContact.companyName,
      companyNameFromDomain(participant.domain)
    ),
    email: firstNonEmpty(
      contextFields.email,
      suggestedCustomer.email,
      allowPersonFieldsAsCompanyFields ? reviewAction.fields?.email : "",
      fieldMap.email,
      allowPersonFieldsAsCompanyFields ? participant.email : ""
    ),
    website: firstNonEmpty(contextFields.website, suggestedCustomer.website, reviewAction.fields?.website, fieldMap.website, domain),
    phoneNumber: firstNonEmpty(
      contextFields.phoneNumber,
      contextFields.phone,
      suggestedCustomer.phone,
      allowPersonFieldsAsCompanyFields ? reviewAction.fields?.phoneNumber : "",
      allowPersonFieldsAsCompanyFields ? reviewAction.fields?.phone : ""
    ),
    ...contextFields
  });
}

export function customerResearchSeed(reviewAction = {}, fields = {}) {
  const normalized = normalizeCustomerCreateFields(fields);
  const participant = reviewAction.externalParticipants?.[0] ?? {};

  return {
    companyName: normalized.name,
    website: normalized.website,
    email: normalized.email || participant.email || "",
    senderDomain: participant.domain || "",
    sourceSubject: reviewAction.subject || "",
    sourceSummary: reviewAction.summary || reviewAction.briefAi?.why || ""
  };
}
