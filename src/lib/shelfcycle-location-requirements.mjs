import { compactWhitespace, firstNonEmpty } from "./normalize.mjs";

export const SHELFCYCLE_LOCATION_FIELDS = Object.freeze([
  {
    key: "name",
    label: "Name",
    shelfCycleLabel: "Name",
    level: "required",
    source: "ShelfCycle New Location/New Shipping Address form"
  },
  {
    key: "email",
    label: "Email",
    shelfCycleLabel: "Email",
    level: "optional",
    source: "business card or public company info"
  },
  {
    key: "phoneNumber",
    label: "Phone Number",
    shelfCycleLabel: "Phone Number",
    level: "optional",
    source: "business card or public company info"
  },
  {
    key: "streetAddress",
    label: "Street Address",
    shelfCycleLabel: "Street Address",
    level: "recommended",
    source: "business card or public company info"
  },
  {
    key: "streetAddress2",
    label: "Street Address 2",
    shelfCycleLabel: "Street Address 2",
    level: "optional",
    source: "business card or public company info"
  },
  {
    key: "city",
    label: "City",
    shelfCycleLabel: "City",
    level: "recommended",
    source: "business card or public company info"
  },
  {
    key: "stateRegion",
    label: "State / Region",
    shelfCycleLabel: "State / Region",
    level: "recommended",
    source: "business card or public company info"
  },
  {
    key: "zip",
    label: "Zip",
    shelfCycleLabel: "Zip",
    level: "recommended",
    source: "business card or public company info"
  },
  {
    key: "country",
    label: "Country",
    shelfCycleLabel: "Country",
    level: "recommended",
    source: "business card or public company info"
  },
  {
    key: "defaultShippingInstructions",
    label: "Default Shipping Instructions for Orders",
    shelfCycleLabel: "Default Shipping Instructions for Orders",
    level: "optional",
    source: "customer shipping instructions"
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

export function normalizeLocationCreateFields(input = {}) {
  const addressParts = splitAddress(firstNonEmpty(input.address, input.fullAddress, input.primaryAddress, input.primary_address));
  const companyName = firstNonEmpty(input.companyName, input.customerName, input.supplierName, input.company, input.accountName);

  return {
    name: compactWhitespace(firstNonEmpty(input.locationName, input.addressName, input.shipToName, input.name, companyName)),
    email: compactWhitespace(firstNonEmpty(input.locationEmail, input.companyEmail, input.email)),
    phoneNumber: compactWhitespace(firstNonEmpty(input.locationPhone, input.phoneNumber, input.phone, input.officePhone, input.mainPhone)),
    streetAddress: compactWhitespace(firstNonEmpty(input.streetAddress, input.street1, input.address1, addressParts.streetAddress)),
    streetAddress2: compactWhitespace(firstNonEmpty(input.streetAddress2, input.street2, input.address2)),
    city: compactWhitespace(firstNonEmpty(input.city, addressParts.city)),
    stateRegion: compactWhitespace(firstNonEmpty(input.stateRegion, input.state, input.region, addressParts.stateRegion)),
    zip: compactWhitespace(firstNonEmpty(input.zip, input.postalCode, input.postal, addressParts.zip)),
    country: compactWhitespace(firstNonEmpty(input.country, addressParts.country)),
    defaultShippingInstructions: compactWhitespace(firstNonEmpty(input.defaultShippingInstructions, input.shippingInstructions, input.instructions)),
    companyType: compactWhitespace(firstNonEmpty(input.companyType, input.relationshipType))
  };
}

export function locationRequirementsForFields(fields = {}) {
  const normalized = normalizeLocationCreateFields(fields);
  const requirements = SHELFCYCLE_LOCATION_FIELDS.map((field) => ({
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
      .map((field) => field.key)
  };
}

export function hasLocationAddressFields(fields = {}) {
  const normalized = normalizeLocationCreateFields(fields);

  return [
    "streetAddress",
    "streetAddress2",
    "city",
    "stateRegion",
    "zip",
    "country"
  ].some((key) => Boolean(compactWhitespace(normalized[key])));
}
