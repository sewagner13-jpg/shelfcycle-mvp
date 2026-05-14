import { compactWhitespace, uniqueStrings } from "./normalize.mjs";

const STRUCTURED_FIELD_SKIP = new Set(["documentType", "extractedText"]);

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
