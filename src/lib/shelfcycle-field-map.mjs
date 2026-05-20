function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  for (const nested of Object.values(value)) {
    freezeDeep(nested);
  }

  return Object.freeze(value);
}

export const SHELFCYCLE_PRODUCT_CODE_FIELDS = freezeDeep({
  code: {
    label: "Code",
    labelPattern: /^code\b/i,
    placeholder: "product-drum-120-lb",
    controlType: "text"
  },
  productFamily: {
    label: "Product Family",
    labelPattern: /^product family\b/i,
    placeholder: "Select a Product Family",
    controlType: "single-select"
  },
  packagingType: {
    label: "Packaging Type",
    labelPattern: /^packaging type\b/i,
    placeholder: "Packaging Type",
    controlType: "single-select",
    options: ["Fixed", "Variable"]
  },
  packaging: {
    label: "Packaging",
    labelPattern: /^packaging\b(?!\s*type)/i,
    placeholder: "Select Packaging",
    controlType: "single-select",
    options: [
      "Bag (kg)",
      "Bags (lb)",
      "Box (lb)",
      "Box (kg)",
      "Drum (lb)",
      "Drum (kg)",
      "Drums (ea)",
      "ISO Container (kg)",
      "ISO Container (lb)",
      "Packaging (ea)",
      "Pail (kg)",
      "Pail (lb)",
      "Production Pounds (lb)",
      "Super Sac (kg)",
      "Totes (ea)",
      "Totes (lb)",
      "Totes (kg)"
    ]
  },
  quantityPerPackage: {
    label: "Quantity",
    labelPattern: /^quantity\b|quantity per package/i,
    placeholder: "123.45",
    controlType: "text"
  },
  unitOfMeasure: {
    label: "Unit Of Measure",
    labelPattern: /^unit of measure\b/i,
    placeholder: "Unit Of Measure",
    controlType: "single-select",
    options: ["kg", "lb", "ea", "gal", "L"]
  },
  supplierType: {
    label: "Supplier Type",
    labelPattern: /^supplier type\b/i,
    placeholder: "Select a Supplier Type",
    controlType: "single-select",
    options: ["Fixed", "Variable"]
  },
  supplier: {
    label: "Supplier",
    labelPattern: /^supplier\b(?!\s*type)/i,
    placeholder: "Supplier",
    controlType: "single-select"
  },
  casNumber: {
    label: "CAS Number",
    labelPattern: /^cas number\b/i,
    placeholder: "474919-59-0",
    controlType: "text"
  },
  nmfcCode: {
    label: "NMFC Code",
    labelPattern: /^nmfc code\b|nmfc/i,
    placeholder: "e.g., 123456-78",
    controlType: "text"
  },
  freightClass: {
    label: "Freight Class",
    labelPattern: /^freight class\b/i,
    placeholder: "5",
    controlType: "text"
  },
  pallet: {
    label: "Pallet",
    labelPattern: /^pallet\b/i,
    placeholder: "Select a Pallet",
    controlType: "single-select"
  },
  packagesPerPallet: {
    label: "Packages per Pallet",
    labelPattern: /^packages per pallet\b/i,
    placeholder: "",
    controlType: "text"
  },
  unNumber: {
    label: "UN/NA Number",
    labelPattern: /^un\/na number\b/i,
    placeholder: "e.g., UN1993, NA1993, or NON-HAZ",
    controlType: "single-select"
  },
  packingGroup: {
    label: "Packing Group",
    labelPattern: /^packing group\b/i,
    placeholder: "Select packing group",
    controlType: "single-select",
    options: ["NOT REGULATED", "I - High danger", "II - Medium danger", "III - Low danger"]
  },
  hazardClass: {
    label: "Hazard Class",
    labelPattern: /^hazard class\b/i,
    placeholder: "Select one or more hazard classes",
    controlType: "multi-select"
  },
  specialDesignation: {
    label: "Special Designation",
    labelPattern: /^special designation\b/i,
    placeholder: "ie: Marine Pollutant, Inhalation Hazard",
    controlType: "multi-select"
  },
  properShippingName: {
    label: "Proper Shipping Name",
    labelPattern: /^proper shipping name\b/i,
    placeholder: "ie: Flammable Liquid, n.o.s.",
    controlType: "text"
  },
  signalWord: {
    label: "GHS Signal Word",
    labelPattern: /^ghs signal word\b/i,
    placeholder: "WARNING, DANGER, etc",
    controlType: "single-select",
    options: ["Danger", "Warning"]
  },
  hazardSymbols: {
    label: "Hazard Symbols",
    labelPattern: /^hazard symbols\b/i,
    placeholder: "Select Hazard Symbols",
    controlType: "multi-select"
  }
});

export const SHELFCYCLE_PRODUCT_FAMILY_FIELDS = freezeDeep({
  supplier: {
    label: "Supplier",
    labelPattern: /^supplier\b/i,
    placeholder: "Supplier",
    controlType: "single-select"
  },
  unNumber: {
    label: "UN/NA Number",
    labelPattern: /^un\/na numbers?\b/i,
    placeholder: "Select UN/NA numbers",
    alternatePlaceholder: "e.g., UN1993, NA1993, or NON-HAZ",
    controlType: "multi-select"
  },
  packingGroup: {
    label: "Packing Group",
    labelPattern: /^packing group\b/i,
    placeholder: "Select packing group",
    controlType: "single-select",
    options: ["NOT REGULATED", "I - High danger", "II - Medium danger", "III - Low danger"]
  },
  hazardClass: {
    label: "Hazard Class",
    labelPattern: /^hazard class\b/i,
    placeholder: "Select one or more hazard classes",
    controlType: "multi-select"
  },
  specialDesignation: {
    label: "Special Designation",
    labelPattern: /^special designation\b/i,
    placeholder: "ie: Marine Pollutant, Inhalation Hazard",
    controlType: "multi-select"
  },
  signalWord: {
    label: "GHS Signal Word",
    labelPattern: /^ghs signal word\b/i,
    placeholder: "GHS Signal Word",
    alternatePlaceholder: "WARNING, DANGER, etc",
    controlType: "single-select",
    options: ["Danger", "Warning"]
  },
  hazardSymbols: {
    label: "Hazard Symbols",
    labelPattern: /^hazard symbols\b/i,
    placeholder: "Select Hazard Symbols",
    controlType: "multi-select"
  },
  superfundTaxType: {
    label: "Superfund Rate Type",
    labelPattern: /^superfund tax type\b|superfund rate type/i,
    placeholder: "Superfund Rate Type",
    controlType: "single-select"
  }
});

export const SHELFCYCLE_COMPANY_DROPDOWN_FIELDS = freezeDeep({
  country: {
    label: "Country",
    labelPattern: /^country$/i,
    placeholder: "Select country",
    controlType: "single-select"
  },
  customerPaymentTerm: {
    label: "Payment Term",
    labelPattern: /^payment term\b|payment terms/i,
    placeholder: "Select a payment term",
    controlType: "single-select"
  },
  supplierPaymentTerms: {
    label: "Payment Terms",
    labelPattern: /^payment terms\b/i,
    placeholder: "Select Payment Terms",
    controlType: "single-select"
  },
  defaultSalesPerson: {
    label: "Default Sales Person",
    labelPattern: /^default sales person\b/i,
    placeholder: "Sales Person",
    controlType: "single-select"
  },
  defaultCsr: {
    label: "Default CSR",
    labelPattern: /^default csr\b|customer service representative/i,
    placeholder: "Customer Service Representative",
    controlType: "single-select"
  },
  costAccount: {
    label: "Cost Account",
    labelPattern: /^cost account\b/i,
    placeholder: "Select Cost Account",
    controlType: "single-select"
  },
  preferredUnitOfMeasure: {
    label: "Preferred Unit of Measure",
    labelPattern: /^preferred unit of measure\b/i,
    placeholder: "Select Unit",
    controlType: "single-select"
  },
  defaultSupplierRep: {
    label: "Default Supplier Rep",
    labelPattern: /^default supplier rep\b/i,
    placeholder: "Supplier Rep",
    controlType: "single-select"
  }
});

function dropdownEntries(fields) {
  return Object.fromEntries(Object.entries(fields)
    .filter(([, config]) => /select/i.test(config.controlType))
    .map(([key, config]) => [key, {
      label: config.label,
      labelPattern: config.labelPattern,
      placeholder: config.placeholder,
      alternatePlaceholder: config.alternatePlaceholder,
      options: config.options
    }]));
}

export const SHELFCYCLE_PRODUCT_CODE_DROPDOWNS = freezeDeep(dropdownEntries(SHELFCYCLE_PRODUCT_CODE_FIELDS));
export const SHELFCYCLE_PRODUCT_FAMILY_DROPDOWNS = freezeDeep(dropdownEntries(SHELFCYCLE_PRODUCT_FAMILY_FIELDS));
export const SHELFCYCLE_COMPANY_DROPDOWNS = freezeDeep(dropdownEntries(SHELFCYCLE_COMPANY_DROPDOWN_FIELDS));

export function shelfCycleField(fields, key) {
  const field = fields?.[key];

  if (!field) {
    throw new Error(`Unknown ShelfCycle field map key: ${key}`);
  }

  return field;
}

export function shelfCycleDropdownArgs(fields, key, overrides = {}) {
  const field = shelfCycleField(fields, key);

  if (!/select/i.test(field.controlType)) {
    throw new Error(`ShelfCycle field "${key}" is not a dropdown.`);
  }

  return {
    label: field.labelPattern,
    placeholder: field.placeholder,
    ...overrides
  };
}

export function shelfCycleTextPlaceholder(fields, key) {
  return shelfCycleField(fields, key).placeholder;
}
