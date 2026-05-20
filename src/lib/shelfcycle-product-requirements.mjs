import { compactWhitespace } from "./normalize.mjs";

export const SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS = Object.freeze({
  learnedAt: "2026-05-13",
  source: "ShelfCycle product code create/edit dialog",
  entityModel: {
    productFamily:
      "ShelfCycle Product Family is the chemical/material identity selected from the Product Family dropdown inside Create Product Code. Automation may type/select this value, use supplier text to disambiguate when possible, and must stop instead of choosing an ambiguous dropdown match.",
    productCode:
      "ShelfCycle Product Code is the package/SKU/inventory record tied to one Product Family, packaging, quantity per package, and supplier mode.",
    familyReuseRule:
      "When a Product Family already exists and a new package size/code is needed, reuse family-level chemical, safety, GHS, and shipping identity. Only vary package-specific Product Code fields such as code, packaging, quantity per package, supplier mode/supplier, pallet/package logistics, and attached document references when the new package actually differs."
  },
  productFamilyFields: [
    "productFamily",
    "chemicalName",
    "productFamilyDescription",
    "aliases",
    "casNumber",
    "unNumber",
    "packingGroup",
    "hazardClass",
    "specialDesignation",
    "properShippingName",
    "signalWord",
    "hazardSymbols"
  ],
  productCodeVariantFields: [
    "code",
    "productName",
    "packagingType",
    "packaging",
    "quantityPerPackage",
    "unitOfMeasure",
    "supplierType",
    "supplier",
    "sdsPath",
    "nmfcCode",
    "freightClass",
    "pallet",
    "packagesPerPallet",
    "documentType"
  ],
  requiredFields: [
    {
      key: "code",
      label: "Code",
      entity: "productCode",
      message: "ShelfCycle requires a product code/SKU."
    },
    {
      key: "productFamily",
      label: "Product Family",
      entity: "productFamily",
      message: "ShelfCycle requires an existing product family selection."
    },
    {
      key: "packagingType",
      label: "Packaging Type",
      entity: "productCode",
      message: "ShelfCycle requires Packaging Type: Fixed or Variable."
    },
    {
      key: "packaging",
      label: "Packaging",
      entity: "productCode",
      message: "ShelfCycle requires a packaging dropdown value."
    },
    {
      key: "quantityPerPackage",
      label: "Quantity per Package",
      entity: "productCode",
      message: "ShelfCycle requires the quantity in the selected package unit."
    },
    {
      key: "supplierType",
      label: "Supplier Type",
      entity: "productCode",
      message: "ShelfCycle requires Supplier Type: Fixed or Variable."
    }
  ],
  conditionalRequiredFields: [
    {
      key: "supplier",
      label: "Supplier",
      when: { key: "supplierType", equals: "Fixed" },
      entity: "productCode",
      message: "ShelfCycle requires a supplier when Supplier Type is Fixed."
    }
  ],
  importantOptionalFields: [
    { key: "casNumber", label: "CAS Number", entity: "productFamily" },
    { key: "sdsPath", label: "SDS", entity: "productCode" },
    { key: "nmfcCode", label: "NMFC Code", entity: "productCode" },
    { key: "freightClass", label: "Freight Class", entity: "productCode" },
    { key: "pallet", label: "Pallet", entity: "productCode" },
    { key: "packagesPerPallet", label: "Packages per Pallet", entity: "productCode" },
    { key: "unNumber", label: "UN/NA Number", entity: "productFamily" },
    { key: "packingGroup", label: "Packing Group", entity: "productFamily" },
    { key: "hazardClass", label: "Hazard Class", entity: "productFamily" },
    { key: "specialDesignation", label: "Special Designation", entity: "productFamily" },
    { key: "properShippingName", label: "Proper Shipping Name", entity: "productFamily" },
    { key: "signalWord", label: "GHS Signal Word", entity: "productFamily" },
    { key: "hazardSymbols", label: "Hazard Symbols", entity: "productFamily" }
  ],
  shippingReviewFields: [
    {
      key: "casNumber",
      label: "CAS Number",
      entity: "productFamily",
      message: "Review CAS from the SDS/TDS before relying on chemical identity."
    },
    {
      key: "unNumber",
      label: "UN/NA Number",
      entity: "productFamily",
      message: "Review UN/NA number from the SDS; leave blank only if not listed or not regulated."
    },
    {
      key: "packingGroup",
      label: "Packing Group",
      entity: "productFamily",
      message: "Review DOT/transport packing group from the SDS."
    },
    {
      key: "hazardClass",
      label: "Hazard Class",
      entity: "productFamily",
      message: "Review transport hazard class from the SDS."
    },
    {
      key: "specialDesignation",
      label: "Special Designation",
      entity: "productFamily",
      message: "Review special transport designations such as marine pollutant, RQ, limited quantity, or PFF."
    },
    {
      key: "properShippingName",
      label: "Proper Shipping Name",
      entity: "productFamily",
      message: "Review the proper shipping name from the SDS transport section."
    },
    {
      key: "signalWord",
      label: "GHS Signal Word",
      entity: "productFamily",
      message: "Review GHS signal word from the SDS hazard section."
    },
    {
      key: "hazardSymbols",
      label: "Hazard Symbols",
      entity: "productFamily",
      message: "Review GHS pictograms/hazard symbols from the SDS."
    },
    {
      key: "nmfcCode",
      label: "NMFC Code",
      entity: "productCode",
      message: "Review NMFC if available from freight/classification data."
    },
    {
      key: "freightClass",
      label: "Freight Class",
      entity: "productCode",
      message: "Review freight class if available from freight/classification data."
    },
    {
      key: "pallet",
      label: "Pallet",
      entity: "productCode",
      message: "Review pallet type if packaging or logistics data provides it."
    },
    {
      key: "packagesPerPallet",
      label: "Packages per Pallet",
      entity: "productCode",
      message: "Review packages per pallet if packaging or logistics data provides it."
    }
  ],
  packagingTypeOptions: ["Fixed", "Variable"],
  supplierTypeOptions: ["Fixed", "Variable"],
  packagingOptions: [
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
  ],
  palletOptions: [
    "Standard softwood",
    "Standard hardwood",
    "Heavy-duty wood",
    "Plastic (nestable)",
    "Plastic (rackable)",
    "Metal (steel)",
    "Corrugated",
    "Presswood",
    "IBC Pallet"
  ],
  packingGroupOptions: [
    "NOT REGULATED",
    "I - High danger",
    "II - Medium danger",
    "III - Low danger"
  ],
  ghsSignalWordOptions: ["Danger", "Warning"],
  hazardClassOptions: [
    "1 - Explosives",
    "2.1 - Flammable Gases",
    "2.2 - Non-Flammable, Non-Toxic Gases",
    "2.3 - Toxic Gases",
    "3 - Flammable Liquids",
    "4.1 - Flammable Solids",
    "4.2 - Spontaneously Combustible",
    "4.3 - Dangerous When Wet",
    "5.1 - Oxidizers",
    "5.2 - Organic Peroxides",
    "6.1 - Toxic Substances",
    "6.2 - Infectious Substances",
    "7 - Radioactive Material",
    "8 - Corrosives",
    "9 - Miscellaneous Dangerous Goods"
  ],
  specialDesignationOptions: [
    "Marine Pollutant",
    "Inhalation Hazard",
    "Reportable Quantity (RQ)",
    "Elevated Temperature",
    "PIH (Poison Inhalation Hazard)",
    "Limited Quantity",
    "ORM-D (Consumer Commodity)",
    "Not Otherwise Specified (n.o.s.)",
    "Protect From Freeze (PFF)"
  ],
  hazardSymbolOptions: [
    "Corrosion",
    "Environment",
    "Exclamation Mark",
    "Exploding Bomb",
    "Flame",
    "Flame Over Circle",
    "Gas Cylinder",
    "Health Hazard",
    "Skull and Bones"
  ]
});

function normalized(value = "") {
  return compactWhitespace(value).toLowerCase();
}

export function productRequirementLabel(key = "") {
  const allFields = [
    ...SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.requiredFields,
    ...SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.conditionalRequiredFields,
    ...SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.importantOptionalFields
  ];
  return allFields.find((field) => field.key === key)?.label || key;
}

export function missingShelfCycleProductFields(fields = {}) {
  const missing = [];

  for (const requirement of SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.requiredFields) {
    if (!compactWhitespace(fields[requirement.key])) {
      missing.push({ ...requirement, blocking: true });
    }
  }

  for (const requirement of SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.conditionalRequiredFields) {
    const current = normalized(fields[requirement.when?.key]);
    const expected = normalized(requirement.when?.equals);

    if (current === expected && !compactWhitespace(fields[requirement.key])) {
      missing.push({ ...requirement, blocking: true });
    }
  }

  return missing;
}

export function missingShelfCycleProductReviewFields(fields = {}) {
  return SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.shippingReviewFields
    .filter((field) => !compactWhitespace(fields[field.key]))
    .map((field) => ({
      ...field,
      blocking: false,
      reviewOnly: true
    }));
}

export function shelfCycleProductRequirementsForFields(fields = {}) {
  const missingRequiredFields = missingShelfCycleProductFields(fields);
  const missingReviewFields = missingShelfCycleProductReviewFields(fields);
  const presentImportantFields = [
    ...SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.requiredFields,
    ...SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.conditionalRequiredFields,
    ...SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.importantOptionalFields
  ]
    .filter((field) => compactWhitespace(fields[field.key]))
    .map((field) => ({
      key: field.key,
      label: field.label,
      entity: field.entity,
      value: compactWhitespace(fields[field.key])
    }));

  return {
    source: SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.source,
    learnedAt: SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.learnedAt,
    entityModel: SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.entityModel,
    requiredFields: SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.requiredFields,
    conditionalRequiredFields: SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.conditionalRequiredFields,
    missingRequiredFields,
    missingReviewFields,
    presentImportantFields,
    shippingReviewFields: SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS.shippingReviewFields,
    readyForProductCodeCreate: missingRequiredFields.length === 0
  };
}

export function productRequirementsPromptBlock() {
  const req = SHELFCYCLE_PRODUCT_CODE_REQUIREMENTS;

  return [
    "ShelfCycle product intake requirements:",
    `- Product Family: ${req.entityModel.productFamily}`,
    `- Product Code: ${req.entityModel.productCode}`,
    `- Existing-family reuse rule: ${req.entityModel.familyReuseRule}`,
    `- Required product-code fields: ${req.requiredFields.map((field) => field.label).join(", ")}.`,
    `- Family-level fields: ${req.productFamilyFields.map(productRequirementLabel).join(", ")}.`,
    `- Package/product-code variant fields: ${req.productCodeVariantFields.map(productRequirementLabel).join(", ")}.`,
    `- Shipping/regulatory/logistics review fields to extract when available: ${req.shippingReviewFields.map((field) => field.label).join(", ")}.`,
    "- If Supplier Type is Fixed, Supplier is also required.",
    "- Product Family should be the clean chemical/material family name, not the package size.",
    "- Product Code should be the package/SKU code used for inventory, orders, and quoting.",
    `- Packaging Type options: ${req.packagingTypeOptions.join(", ")}.`,
    `- Supplier Type options: ${req.supplierTypeOptions.join(", ")}.`,
    `- Packaging dropdown options: ${req.packagingOptions.join(", ")}.`,
    `- Packing Group options: ${req.packingGroupOptions.join(", ")}.`,
    `- GHS Signal Word options: ${req.ghsSignalWordOptions.join(", ")}.`,
    `- Hazard Class options: ${req.hazardClassOptions.join(", ")}.`,
    `- Hazard Symbols options: ${req.hazardSymbolOptions.join(", ")}.`,
    "- SDS transport and hazard sections are the preferred source for UN/NA Number, Packing Group, Hazard Class, Proper Shipping Name, Signal Word, and Hazard Symbols.",
    "- Freight Class, NMFC, Pallet, and Packages per Pallet may come from freight/classification data or packaging logistics, not usually from a TDS.",
    "- If the document directly supports a field, extract it.",
    "- If the document does not directly state a field, make a best-supported AI determination only when the product identity, CAS, or regulatory text makes the answer high-confidence; mark it as AI-derived and explain the reasoning.",
    "- If a TDS lacks SDS-only transport or GHS details and there is no high-confidence basis, leave those fields blank and call out that the SDS is needed rather than guessing.",
    "Do not fabricate values. If you make a practical ShelfCycle suggestion from context, mark it as AI-derived and explain why."
  ].join("\n");
}
