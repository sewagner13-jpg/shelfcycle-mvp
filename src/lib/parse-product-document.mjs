import { compactWhitespace, uniqueStrings } from "./normalize.mjs";

function findField(text = "", patterns = []) {
  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return compactWhitespace(match[1]);
    }
  }

  return "";
}

function findAll(text = "", pattern) {
  return uniqueStrings((text.match(pattern) ?? []).map((value) => compactWhitespace(value)));
}

function normalizeLabel(label = "") {
  return compactWhitespace(label)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LABELED_PRODUCT_FIELD_MAP = new Map(
  Object.entries({
    "product family": "productFamily",
    "chemical name": "chemicalName",
    "product family description": "productFamilyDescription",
    aliases: "aliases",
    alias: "aliases",
    "cas number": "casNumber",
    cas: "casNumber",
    "recommended use": "recommendedUse",
    "product code": "code",
    sku: "code",
    "product name": "productName",
    "packaging type": "packagingType",
    packaging: "packaging",
    package: "packaging",
    "quantity per package": "quantityPerPackage",
    "package quantity": "quantityPerPackage",
    "package qty": "quantityPerPackage",
    "unit of measure": "unitOfMeasure",
    uom: "unitOfMeasure",
    "supplier type": "supplierType",
    supplier: "supplier",
    manufacturer: "supplier",
    "document type": "documentType",
    "sds local file path": "sdsPath",
    "sds path": "sdsPath",
    "un/na number": "unNumber",
    "un na number": "unNumber",
    "un number": "unNumber",
    "na number": "unNumber",
    "packing group": "packingGroup",
    "hazard class": "hazardClass",
    "special designation": "specialDesignation",
    "proper shipping name": "properShippingName",
    "ghs signal word": "signalWord",
    "signal word": "signalWord",
    "hazard symbols": "hazardSymbols",
    "hazard symbol": "hazardSymbols",
    "nmfc code": "nmfcCode",
    nmfc: "nmfcCode",
    "freight class": "freightClass",
    pallet: "pallet",
    "packages per pallet": "packagesPerPallet",
    "physical state": "physicalState",
    appearance: "appearance",
    density: "density",
    "specific gravity": "specificGravity",
    viscosity: "viscosity",
    "flash point": "flashPoint",
    "boiling point": "boilingPoint",
    storage: "storage",
    "shelf life": "shelfLife",
    "document date": "documentDate"
  }).map(([label, field]) => [normalizeLabel(label), field])
);

export function parseLabeledProductFields(text = "") {
  const fields = {};

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || /^=+\s*.+?\s*=+$/.test(line)) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9/().#&' -]{2,70})\s*:\s*(.*)$/);

    if (!match) {
      continue;
    }

    const key = LABELED_PRODUCT_FIELD_MAP.get(normalizeLabel(match[1]));

    if (!key) {
      continue;
    }

    const value = compactWhitespace(match[2]);

    if (value || !Object.hasOwn(fields, key)) {
      fields[key] = value;
    }
  }

  return fields;
}

export function parseProductDocument(text = "") {
  const labeledFields = parseLabeledProductFields(text);
  const documentType = labeledFields.documentType || (/\btechnical data sheet\b|\btds\b/i.test(text) ? "TDS" : "SDS");
  const productName = findField(text, [
    /product(?:\s+identifier|\s+name)?\s*[:\-]\s*(.+)/i,
    /trade\s+name\s*[:\-]\s*(.+)/i,
    /name\s+of\s+(?:substance|product)\s*[:\-]\s*(.+)/i
  ]);
  const manufacturer = findField(text, [
    /manufacturer\s*[:\-]\s*(.+)/i,
    /supplier\s*[:\-]\s*(.+)/i,
    /company\s*[:\-]\s*(.+)/i
  ]);
  const casNumbers = findAll(text, /\b\d{2,7}-\d{2}-\d\b/g);
  const unNumbers = findAll(text, /\b(?:UN|NA)\s?\d{4}\b/gi);
  const packingGroup = findField(text, [/packing group\s*[:\-]\s*(.+)/i]);
  const hazardClass = findField(text, [/hazard class\s*[:\-]\s*(.+)/i]);
  const properShippingName = findField(text, [/proper shipping name\s*[:\-]\s*(.+)/i]);
  const signalWord = findField(text, [/signal word\s*[:\-]\s*(.+)/i]);
  const code = findField(text, [
    /(?:product\s+)?code\s*[:\-]\s*(.+)/i,
    /sku\s*[:\-]\s*(.+)/i
  ]);
  const productFamily = findField(text, [
    /product\s+family\s*[:\-]\s*(.+)/i,
    /family\s*[:\-]\s*(.+)/i
  ]);
  const packaging = findField(text, [
    /packaging\s*[:\-]\s*(.+)/i,
    /package\s+type\s*[:\-]\s*(.+)/i
  ]);
  const quantityPerPackage = findField(text, [
    /quantity\s+per\s+package\s*[:\-]\s*(.+)/i,
    /net\s+weight\s*[:\-]\s*(.+)/i,
    /package\s+(?:qty|quantity)\s*[:\-]\s*(.+)/i
  ]);
  const freightClass = findField(text, [/freight class\s*[:\-]\s*(.+)/i]);
  const nmfcCode = findField(text, [/nmfc\s*(?:code)?\s*[:\-]\s*(.+)/i]);

  return {
    workflow: "new_product",
    documentType,
    fields: {
      productName: labeledFields.productName ?? productName,
      code: labeledFields.code ?? code,
      productFamily: labeledFields.productFamily ?? productFamily,
      productFamilyDescription: labeledFields.productFamilyDescription ?? "",
      chemicalName: labeledFields.chemicalName ?? "",
      aliases: labeledFields.aliases ?? "",
      supplier: labeledFields.supplier ?? manufacturer,
      casNumber: labeledFields.casNumber ?? casNumbers[0] ?? "",
      packagingType: labeledFields.packagingType ?? "",
      packaging: labeledFields.packaging ?? packaging,
      quantityPerPackage: labeledFields.quantityPerPackage ?? quantityPerPackage,
      unitOfMeasure: labeledFields.unitOfMeasure ?? "",
      supplierType: labeledFields.supplierType ?? "",
      documentType,
      sdsPath: labeledFields.sdsPath ?? "",
      unNumber: labeledFields.unNumber ?? unNumbers[0] ?? "",
      packingGroup: labeledFields.packingGroup ?? packingGroup,
      hazardClass: labeledFields.hazardClass ?? hazardClass,
      specialDesignation: labeledFields.specialDesignation ?? "",
      properShippingName: labeledFields.properShippingName ?? properShippingName,
      signalWord: labeledFields.signalWord ?? signalWord,
      hazardSymbols: labeledFields.hazardSymbols ?? "",
      freightClass: labeledFields.freightClass ?? freightClass,
      nmfcCode: labeledFields.nmfcCode ?? nmfcCode,
      pallet: labeledFields.pallet ?? "",
      packagesPerPallet: labeledFields.packagesPerPallet ?? "",
      physicalState: labeledFields.physicalState ?? "",
      appearance: labeledFields.appearance ?? "",
      density: labeledFields.density ?? "",
      specificGravity: labeledFields.specificGravity ?? "",
      viscosity: labeledFields.viscosity ?? "",
      flashPoint: labeledFields.flashPoint ?? "",
      boilingPoint: labeledFields.boilingPoint ?? "",
      storage: labeledFields.storage ?? "",
      shelfLife: labeledFields.shelfLife ?? "",
      recommendedUse: labeledFields.recommendedUse ?? "",
      documentDate: labeledFields.documentDate ?? ""
    },
    attachmentPlan: {
      sds: documentType === "SDS",
      tds: documentType === "TDS",
      target: documentType === "TDS" ? "product documents drawer" : "product code safety attributes"
    },
    rawExtracts: {
      casNumbers,
      unNumbers
    }
  };
}
