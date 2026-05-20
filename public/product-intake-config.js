export function productDisplayLabel(field = "") {
  return {
    shelfCycleReadySummary: "ShelfCycle-ready summary",
    productName: "Product Name",
    code: "Product Code",
    productFamily: "Product Family",
    productFamilyDescription: "Product Family Description",
    chemicalName: "Chemical Name",
    aliases: "Aliases",
    supplier: "Supplier",
    casNumber: "CAS Number",
    sdsPath: "SDS Local File Path",
    packagingType: "Packaging Type",
    packaging: "Packaging",
    quantityPerPackage: "Quantity per Package",
    unitOfMeasure: "Unit of Measure",
    supplierType: "Supplier Type",
    unNumber: "UN/NA Number",
    packingGroup: "Packing Group",
    hazardClass: "Hazard Class",
    specialDesignation: "Special Designation",
    properShippingName: "Proper Shipping Name",
    signalWord: "GHS Signal Word",
    hazardSymbols: "Hazard Symbols",
    nmfcCode: "NMFC Code",
    freightClass: "Freight Class",
    pallet: "Pallet",
    packagesPerPallet: "Packages per Pallet",
    documentType: "Document Type",
    physicalState: "Physical State",
    appearance: "Appearance",
    density: "Density",
    specificGravity: "Specific Gravity",
    viscosity: "Viscosity",
    flashPoint: "Flash Point",
    boilingPoint: "Boiling Point",
    storage: "Storage",
    shelfLife: "Shelf Life",
    recommendedUse: "Recommended Use",
    documentDate: "Document Date"
  }[field] || String(field || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}

export const PRODUCT_FIELD_SECTIONS = [
  {
    title: "Make or update Product Family",
    help: "Family-level identity. Reuse this when adding another package size under the same product family.",
    fields: [
      "productFamily",
      "chemicalName",
      "productFamilyDescription",
      "aliases",
      "casNumber",
      "recommendedUse"
    ]
  },
  {
    title: "Make or update Product Codes / Packages",
    help: "Package/SKU-level fields. Each package size needs approval before ShelfCycle is updated.",
    fields: [
      "code",
      "productName",
      "packagingType",
      "packaging",
      "quantityPerPackage",
      "unitOfMeasure",
      "supplierType",
      "supplier",
      "documentType",
      "sdsPath"
    ]
  },
  {
    title: "Shipping / Safety / Freight",
    help: "Review all ShelfCycle transport and freight fields. Leave blank when the SDS/TDS does not support the value.",
    fields: [
      "unNumber",
      "packingGroup",
      "hazardClass",
      "specialDesignation",
      "properShippingName",
      "signalWord",
      "hazardSymbols",
      "nmfcCode",
      "freightClass",
      "pallet",
      "packagesPerPallet"
    ]
  },
  {
    title: "Physical / Storage",
    help: "Technical properties that should be carried into the product record when available.",
    fields: [
      "physicalState",
      "appearance",
      "density",
      "specificGravity",
      "viscosity",
      "flashPoint",
      "boilingPoint",
      "storage",
      "shelfLife",
      "documentDate"
    ]
  }
];

export const PRODUCT_REQUIRED_FIELDS = new Set([
  "productFamily",
  "code",
  "packagingType",
  "packaging",
  "quantityPerPackage",
  "unitOfMeasure",
  "supplierType"
]);

export const PRODUCT_REVIEW_FIELDS = new Set([
  "casNumber",
  "unNumber",
  "packingGroup",
  "hazardClass",
  "specialDesignation",
  "properShippingName",
  "signalWord",
  "hazardSymbols",
  "nmfcCode",
  "freightClass",
  "pallet",
  "packagesPerPallet"
]);

export const PRODUCT_LONG_TEXT_FIELDS = new Set([
  "shelfCycleReadySummary",
  "productFamilyDescription",
  "aliases",
  "recommendedUse",
  "properShippingName",
  "storage"
]);

export const PRODUCT_SELECT_OPTIONS = {
  documentType: ["", "SDS", "TDS", "COA", "SPEC", "OTHER"],
  packagingType: ["", "Fixed", "Variable"],
  supplierType: ["", "Fixed", "Variable"],
  unitOfMeasure: ["", "lb", "kg", "ea", "gal", "L", "drum", "pail", "tote"],
  packingGroup: ["", "NOT REGULATED", "I - High danger", "II - Medium danger", "III - Low danger"],
  signalWord: ["", "Danger", "Warning"],
  pallet: ["", "Standard softwood", "Standard hardwood", "Heavy-duty wood", "Plastic (nestable)", "Plastic (rackable)", "Metal (steel)", "Corrugated", "Presswood", "IBC Pallet"]
};

export const PRODUCT_AI_RESEARCH_FIELDS = new Set([
  ...PRODUCT_REVIEW_FIELDS,
  "physicalState",
  "appearance",
  "density",
  "specificGravity",
  "viscosity",
  "flashPoint",
  "boilingPoint",
  "storage",
  "shelfLife",
  "recommendedUse",
  "supplier"
]);

const LOW_SIGNAL_WARNING_PATTERNS = [
  /Hosted PDF extraction could not complete, so the local ClearEdge backend parsed this file\./i
];

export function isLowSignalProductWarning(value = "") {
  return LOW_SIGNAL_WARNING_PATTERNS.some((pattern) => pattern.test(String(value || "")));
}

export function cleanProductWarnings(warnings = []) {
  return [...new Set(
    (warnings ?? [])
      .map((item) => String(item || "").trim())
      .filter((item) => item && !isLowSignalProductWarning(item))
  )];
}
