import { compactWhitespace, uniqueStrings } from "./normalize.mjs";

const STRUCTURED_FIELD_SKIP = new Set(["documentType", "extractedText"]);
const MISSING_PRODUCT_FIELD_PATTERNS = [
  { key: "code", label: "Code", pattern: /\bcode\b|\bproduct\s+code\b|\bsku\b/i },
  { key: "quantityPerPackage", label: "Quantity per Package", pattern: /\bquantity\s+per\s+package\b|\bpackage\s+(?:qty|quantity)\b/i },
  { key: "packaging", label: "Packaging", pattern: /\bpackag(?:e|ing)\b/i },
  { key: "packagingType", label: "Packaging Type", pattern: /\bpackaging\s+type\b/i },
  { key: "supplierType", label: "Supplier Type", pattern: /\bsupplier\s+type\b/i }
];
const FAMILY_IDENTIFIER_FIELDS = [
  { key: "casNumber", label: "CAS Number" },
  { key: "unNumber", label: "UN/NA Number" },
  { key: "packingGroup", label: "Packing Group" },
  { key: "hazardClass", label: "Hazard Class" },
  { key: "specialDesignation", label: "Special Designation" },
  { key: "properShippingName", label: "Proper Shipping Name" },
  { key: "signalWord", label: "GHS Signal Word" },
  { key: "hazardSymbols", label: "Hazard Symbols" }
];
const SDS_TRANSPORT_WARNING_FIELDS = [
  { key: "unNumber", label: "UN/NA Number" },
  { key: "hazardClass", label: "Hazard Class" },
  { key: "packingGroup", label: "Packing Group" },
  { key: "properShippingName", label: "Proper Shipping Name" },
  { key: "signalWord", label: "GHS Signal Word" },
  { key: "hazardSymbols", label: "Hazard Symbols" }
];

export function productDocumentTextQuality(text = "") {
  const clean = compactWhitespace(text);

  if (!clean) {
    return {
      readable: false,
      reason: "No readable PDF text was extracted.",
      length: 0,
      wordCount: 0,
      nonAsciiRatio: 0
    };
  }

  const length = clean.length;
  const alphaWords = clean.match(/[A-Za-z]{3,}/g) ?? [];
  const businessTerms = clean.match(/\b(product|safety|data|sheet|cas|supplier|hazard|transport|composition|handling|storage|physical|chemical|section|technical)\b/gi) ?? [];
  const hasExplicitProductField = /\b(product\s+(?:name|identifier|code)|trade\s+name|cas\s+number|safety\s+data\s+sheet|technical\s+data\s+sheet)\b/i.test(clean);
  const nonAscii = clean.match(/[^\x09\x0A\x0D\x20-\x7E]/g) ?? [];
  const replacementChars = clean.match(/\uFFFD/g) ?? [];
  const nonAsciiRatio = length ? nonAscii.length / length : 1;
  const wordCount = alphaWords.length;
  const usefulWordCount = alphaWords.filter((word) => word.length >= 5).length;

  if (replacementChars.length > 3) {
    return {
      readable: false,
      reason: "PDF text extraction returned replacement characters.",
      length,
      wordCount,
      nonAsciiRatio
    };
  }

  if (nonAsciiRatio > 0.18 && businessTerms.length < 2) {
    return {
      readable: false,
      reason: "PDF text extraction appears garbled.",
      length,
      wordCount,
      nonAsciiRatio
    };
  }

  if (hasExplicitProductField && length >= 20 && nonAsciiRatio < 0.12) {
    return {
      readable: true,
      reason: "",
      length,
      wordCount,
      nonAsciiRatio
    };
  }

  if (length < 80 && businessTerms.length < 2) {
    return {
      readable: false,
      reason: "PDF text extraction was too short for reliable SDS/TDS parsing.",
      length,
      wordCount,
      nonAsciiRatio
    };
  }

  if (wordCount < 8 && businessTerms.length < 2) {
    return {
      readable: false,
      reason: "PDF text extraction did not contain enough readable words.",
      length,
      wordCount,
      nonAsciiRatio
    };
  }

  if (!hasExplicitProductField && businessTerms.length < 2 && usefulWordCount < 20) {
    return {
      readable: false,
      reason: "PDF text extraction did not contain enough SDS/TDS terms for reliable parsing.",
      length,
      wordCount,
      nonAsciiRatio
    };
  }

  return {
    readable: true,
    reason: "",
    length,
    wordCount,
    nonAsciiRatio
  };
}

export function shouldRunProductDocumentPdfAi({ text = "", forceAi = false } = {}) {
  return Boolean(forceAi || !productDocumentTextQuality(text).readable);
}

export function usefulProductDocumentFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields ?? {})
      .filter(([key, value]) => !STRUCTURED_FIELD_SKIP.has(key) && compactWhitespace(value))
      .map(([key, value]) => [key, compactWhitespace(value)])
  );
}

export function hasUsefulProductDocumentFields(fields = {}) {
  return Object.keys(usefulProductDocumentFields(fields)).length > 0;
}

export function mergeProductDocumentExtractionIntoResult(result = {}, productDocument = {}) {
  const structuredFields = usefulProductDocumentFields(productDocument.fields ?? {});
  const mergedFields = {
    ...(result.fields ?? {}),
    ...structuredFields
  };
  const seenAi = new Set();
  const aiDerivedFields = [];

  for (const item of [...(result.aiDerivedFields ?? []), ...(productDocument.aiDerivedFields ?? [])]) {
    const field = compactWhitespace(item?.field);
    const value = compactWhitespace(item?.value);

    if (!field || STRUCTURED_FIELD_SKIP.has(field) || !value) {
      continue;
    }

    const key = `${field}:${value}`;

    if (seenAi.has(key)) {
      continue;
    }

    seenAi.add(key);
    aiDerivedFields.push({
      field,
      value,
      reason: compactWhitespace(item?.reason) || "AI derived from SDS/TDS document."
    });
  }

  return {
    ...result,
    documentType: result.documentType || productDocument.fields?.documentType || productDocument.documentType || "SDS",
    fields: mergedFields,
    aiDerivedFields,
    missingShelfCycleFields: productDocument.missingShelfCycleFields ?? result.missingShelfCycleFields ?? [],
    shelfCycleNotes: productDocument.shelfCycleNotes ?? result.shelfCycleNotes ?? [],
    warnings: uniqueStrings([
      ...(result.warnings ?? []),
      ...(productDocument.warnings ?? [])
    ])
  };
}

function normalizedComparable(value = "") {
  return compactWhitespace(value)
    .toLowerCase()
    .replace(/[®™]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasExplicitProductCodeSource(text = "") {
  return /\b(product\s+code|sku|item\s*(?:no|number|#)|material\s*(?:no|number|#)|article\s*(?:no|number|#)|part\s*(?:no|number|#))\b/i.test(text);
}

export function sanitizeProductDocumentResultForSource(result = {}, sourceText = "") {
  if (result.workflow !== "new_product") {
    return result;
  }

  const fields = { ...(result.fields ?? {}) };
  const warnings = [...(result.warnings ?? [])];
  const code = compactWhitespace(fields.code);
  const codeComparable = normalizedComparable(code);
  const productNameComparable = normalizedComparable(fields.productName);
  const productFamilyComparable = normalizedComparable(fields.productFamily);
  const hasGeneratedPackageCode = Boolean(
    code &&
    compactWhitespace(fields.packaging) &&
    compactWhitespace(fields.quantityPerPackage) &&
    (result.aiDerivedFields ?? []).some((item) =>
      normalizedComparable(item?.field) === "code" &&
      normalizedComparable(item?.value) === codeComparable &&
      /\bgenerated\b.*\bpackage\b|\bpackage\b.*\bsize\b/i.test(compactWhitespace(item?.reason))
    )
  );
  const invalidCodeValue =
    /\bnot\s+(?:given|provided|specified|available|applicable)\b/i.test(code) ||
    /\b(?:FreightClass|Freight Class|Pallet|PackagesPerPallet|Packages Per Pallet|DocumentDate|Document Date|DocumentType|Document Type)\s*:/i.test(code) ||
    code.length > 80;

  if (
    code &&
    (
      invalidCodeValue ||
      (!hasExplicitProductCodeSource(sourceText) && !hasGeneratedPackageCode) ||
      codeComparable === productNameComparable ||
      codeComparable === productFamilyComparable
    )
  ) {
    fields.code = "";
    warnings.push("No explicit product SKU/code was found in the SDS/TDS. Enter the ShelfCycle Product Code before approving product-code creation.");
  }

  return {
    ...result,
    fields,
    warnings: filterResolvedProductDocumentWarnings(warnings, fields)
  };
}

export function filterResolvedProductDocumentWarnings(warnings = [], fields = {}) {
  const output = [];

  for (const warning of warnings) {
    const clean = compactWhitespace(warning);

    if (!clean) {
      continue;
    }

    const missingField = MISSING_PRODUCT_FIELD_PATTERNS.find((item) =>
      item.pattern.test(clean) && /\bmissing\b/i.test(clean)
    );

    if (missingField && compactWhitespace(fields[missingField.key])) {
      continue;
    }

    if (/missing family-level identifiers/i.test(clean)) {
      const missing = FAMILY_IDENTIFIER_FIELDS
        .filter((item) => !compactWhitespace(fields[item.key]))
        .map((item) => item.label);

      if (!missing.length) {
        continue;
      }

      output.push(`Missing family-level identifiers: ${missing.join(", ")}`);
      continue;
    }

    if (/\b(?:technical data sheet|TDS)\b.*\bnot\s+(?:an?\s+)?SDS\b/i.test(clean) || /\bSDS\b.*\bneeded\b/i.test(clean)) {
      const missing = FAMILY_IDENTIFIER_FIELDS
        .filter((item) => !compactWhitespace(fields[item.key]))
        .map((item) => item.label);

      if (!missing.length) {
        continue;
      }

      if (output.some((item) => /^Missing family-level identifiers:/i.test(item))) {
        continue;
      }

      output.push(`SDS still needed for unresolved fields: ${missing.join(", ")}`);
      continue;
    }

    if (/\b(?:section\s*14|transport\s+information|Missing SDS transport info)\b/i.test(clean) && /\bmissing|not\s+(?:listed|provided|available)|cannot\s+be\s+extracted/i.test(clean)) {
      const missing = SDS_TRANSPORT_WARNING_FIELDS
        .filter((item) => !compactWhitespace(fields[item.key]))
        .map((item) => item.label);

      if (!missing.length) {
        continue;
      }

      output.push(`SDS transport/GHS fields still unresolved: ${missing.join(", ")}`);
      continue;
    }

    output.push(clean);
  }

  return [...new Set(output)];
}
