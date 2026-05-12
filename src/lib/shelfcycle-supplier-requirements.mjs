import { asTitle, compactWhitespace, firstNonEmpty, isLikelyCompanyName } from "./normalize.mjs";
import {
  inferredCompanyName,
  preferredExternalParticipant,
  preferredSuggestedContact
} from "./business-email-identity.mjs";

export const SHELFCYCLE_SUPPLIER_FIELDS = Object.freeze([
  {
    key: "name",
    label: "Name",
    shelfCycleLabel: "Name",
    level: "required",
    source: "ShelfCycle New Supplier form"
  },
  {
    key: "phone",
    label: "Phone",
    shelfCycleLabel: "Phone",
    level: "recommended",
    source: "public company/contact info"
  },
  {
    key: "email",
    label: "Email",
    shelfCycleLabel: "Email",
    level: "recommended",
    source: "public company/contact info"
  },
  {
    key: "website",
    label: "Website",
    shelfCycleLabel: "Website",
    level: "recommended",
    source: "public company website"
  },
  {
    key: "street1",
    label: "Street 1",
    shelfCycleLabel: "Street 1",
    level: "recommended",
    source: "public company/contact info"
  },
  {
    key: "street2",
    label: "Street 2",
    shelfCycleLabel: "Street 2",
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
    key: "country",
    label: "Country",
    shelfCycleLabel: "Country",
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
    key: "paymentTerms",
    label: "Payment Terms",
    shelfCycleLabel: "Payment Terms",
    level: "internal",
    source: "ClearEdge decision, not public web"
  },
  {
    key: "creditLimit",
    label: "Credit Limit",
    shelfCycleLabel: "Credit Limit",
    level: "internal",
    source: "ClearEdge decision, not public web"
  },
  {
    key: "achRoutingNumber",
    label: "ACH Routing No.",
    shelfCycleLabel: "ACH Routing No.",
    level: "internal",
    source: "ClearEdge/vendor banking decision, not public web"
  },
  {
    key: "achAccountNumber",
    label: "ACH Account No.",
    shelfCycleLabel: "ACH Account No.",
    level: "internal",
    source: "ClearEdge/vendor banking decision, not public web"
  },
  {
    key: "costAccount",
    label: "Cost Account",
    shelfCycleLabel: "Cost Account",
    level: "internal",
    source: "ClearEdge accounting decision"
  },
  {
    key: "preferredUnitOfMeasure",
    label: "Preferred Unit of Measure",
    shelfCycleLabel: "Preferred Unit of Measure",
    level: "internal",
    source: "ClearEdge procurement decision"
  },
  {
    key: "defaultSupplierRep",
    label: "Default Supplier Rep",
    shelfCycleLabel: "Default Supplier Rep",
    level: "internal",
    source: "ClearEdge assignment"
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
    street1: parts[0] ?? "",
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

export function normalizeSupplierCreateFields(input = {}) {
  const addressParts = splitAddress(firstNonEmpty(input.address, input.primaryAddress, input.primary_address));

  return {
    name: compactWhitespace(firstNonEmpty(input.name, input.companyName, input.supplierName, input.accountName, input.company)),
    phone: compactWhitespace(firstNonEmpty(input.phone, input.phoneNumber, input.officePhone, input.mainPhone)),
    email: compactWhitespace(firstNonEmpty(input.email, input.companyEmail, input.contactEmail)),
    website: compactWhitespace(firstNonEmpty(input.website, input.url, input.domain)),
    street1: compactWhitespace(firstNonEmpty(input.street1, input.streetAddress, input.address1, addressParts.street1)),
    street2: compactWhitespace(firstNonEmpty(input.street2, input.streetAddress2, input.address2)),
    city: compactWhitespace(firstNonEmpty(input.city, addressParts.city)),
    country: compactWhitespace(firstNonEmpty(input.country, addressParts.country)),
    stateRegion: compactWhitespace(firstNonEmpty(input.stateRegion, input.state, input.region, addressParts.stateRegion)),
    zip: compactWhitespace(firstNonEmpty(input.zip, input.postalCode, input.postal, addressParts.zip)),
    paymentTerms: compactWhitespace(firstNonEmpty(input.paymentTerms, input.paymentTerm, input.terms)),
    creditLimit: compactWhitespace(firstNonEmpty(input.creditLimit, input.credit_limit)),
    achRoutingNumber: compactWhitespace(firstNonEmpty(input.achRoutingNumber, input.achRoutingNo, input.routingNumber)),
    achAccountNumber: compactWhitespace(firstNonEmpty(input.achAccountNumber, input.achAccountNo, input.accountNumber)),
    costAccount: compactWhitespace(firstNonEmpty(input.costAccount, input.cost_account)),
    preferredUnitOfMeasure: compactWhitespace(firstNonEmpty(input.preferredUnitOfMeasure, input.uom, input.unitOfMeasure)),
    defaultSupplierRep: compactWhitespace(firstNonEmpty(input.defaultSupplierRep, input.supplierRep, input.rep))
  };
}

export function supplierRequirementsForFields(fields = {}) {
  const normalized = normalizeSupplierCreateFields(fields);
  const requirements = SHELFCYCLE_SUPPLIER_FIELDS.map((field) => ({
    ...field,
    value: normalized[field.key],
    present: Boolean(compactWhitespace(normalized[field.key]))
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

function firstWebsiteFromText(expectedDomain = "", ...values) {
  const text = values.map((value) => String(value || "")).join(" ");
  const matches = text.match(/\bhttps?:\/\/(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"')]+)?|\bwww\.[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"')]+)?/gi) ?? [];
  const expected = compactWhitespace(expectedDomain).toLowerCase().replace(/^www\./, "");

  for (const raw of matches) {
    const value = compactWhitespace(raw);
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;

    try {
      const url = new URL(withProtocol);
      const domain = url.hostname.toLowerCase().replace(/^www\./, "");

      if (domain === "clear-edge.net") {
        continue;
      }

      if (!expected || domain === expected) {
        return withProtocol;
      }
    } catch {
      continue;
    }
  }

  return "";
}

export function collectSupplierCreateFields(reviewAction = {}, context = {}) {
  const suggestedSupplier = (reviewAction.suggestedCreates ?? []).find((item) => item.type === "supplier") ?? {};
  const suggestedContact = preferredSuggestedContact(reviewAction) ?? {};
  const fieldMap = fieldMapFromAiCandidate(reviewAction);
  const participant = preferredExternalParticipant(reviewAction);
  const identity = inferredCompanyName(reviewAction, { relationship: "supplier" });
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
  const participantDomain = identity.domain || participant.domain || "";
  const domain = participantDomain ? `https://${participantDomain}` : "";
  const participantCompanyName = isLikelyCompanyName(participant.name)
    ? participant.name
    : "";
  const websiteFromText = firstWebsiteFromText(
    participantDomain,
    reviewAction.summary,
    reviewAction.draftNote?.summary,
    reviewAction.writePlan?.fields?.summary,
    reviewAction.briefAi?.why,
    reviewAction.briefAi?.keyDetails
  );

  return normalizeSupplierCreateFields({
    ...reviewAction.writePlan?.fields,
    ...reviewAction.fields,
    ...fieldMap,
    ...suggestedSupplier,
    name: firstNonEmpty(
      context.fields?.name,
      suggestedSupplier.name,
      suggestedSupplier.companyName,
      reviewAction.fields?.name,
      reviewAction.fields?.supplierName,
      reviewAction.fields?.supplier,
      reviewAction.fields?.companyName,
      fieldMap.supplier,
      fieldMap.supplier_name,
      identity.subjectCompanyName,
      participantCompanyName,
      suggestedContact.companyName,
      identity.domainCompanyName || companyNameFromDomain(participant.domain)
    ),
    email: firstNonEmpty(
      contextFields.email,
      suggestedSupplier.email,
      allowPersonFieldsAsCompanyFields ? reviewAction.fields?.email : "",
      fieldMap.email,
      allowPersonFieldsAsCompanyFields ? participant.email : ""
    ),
    website: firstNonEmpty(contextFields.website, suggestedSupplier.website, reviewAction.fields?.website, fieldMap.website, websiteFromText, domain),
    phone: firstNonEmpty(
      contextFields.phone,
      contextFields.phoneNumber,
      suggestedSupplier.phone,
      allowPersonFieldsAsCompanyFields ? reviewAction.fields?.phone : "",
      allowPersonFieldsAsCompanyFields ? reviewAction.fields?.phoneNumber : ""
    ),
    ...contextFields
  });
}
