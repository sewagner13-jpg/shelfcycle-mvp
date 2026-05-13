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

export function parseProductDocument(text = "") {
  const documentType = /\btechnical data sheet\b|\btds\b/i.test(text) ? "TDS" : "SDS";
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
      productName,
      code,
      productFamily,
      supplier: manufacturer,
      casNumber: casNumbers[0] ?? "",
      packaging,
      quantityPerPackage,
      unNumber: unNumbers[0] ?? "",
      packingGroup,
      hazardClass,
      properShippingName,
      signalWord,
      freightClass,
      nmfcCode
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
