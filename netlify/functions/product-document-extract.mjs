import { extractPdfText } from "../../src/lib/pdf-text-extractor.mjs";
import { extractProductDocumentPdfWithAi } from "../../src/lib/product-document-ai.mjs";
import {
  hasUsefulProductDocumentFields,
  productDocumentTextQuality,
  shouldRunProductDocumentPdfAi
} from "../../src/lib/product-document-source.mjs";
import { getEnv } from "./_shared/env.mjs";

const HOSTED_PRODUCT_DOCUMENT_TIMEOUT_MS = 18000;

function base64FromPayload(payload = {}) {
  const raw = String(payload.base64 || payload.dataUrl || "");
  const match = raw.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : raw;
}

function hostedProductDocumentTimeoutMs(...values) {
  const parsed = values
    .map((value) => Number.parseInt(String(value || ""), 10))
    .find((value) => Number.isFinite(value) && value > 0);

  return Math.min(parsed || HOSTED_PRODUCT_DOCUMENT_TIMEOUT_MS, HOSTED_PRODUCT_DOCUMENT_TIMEOUT_MS);
}

function isTimeoutMessage(message = "") {
  return /\b(timeout|timed out|aborted|inactivity timeout)\b/i.test(String(message || ""));
}

function errorResponse(error, status = 500) {
  const message = error instanceof Error ? error.message : "Product document extraction failed.";
  const timeout = isTimeoutMessage(message);

  return Response.json({
    ok: false,
    error: timeout ? "PRODUCT_DOCUMENT_TIMEOUT" : "PRODUCT_DOCUMENT_EXTRACT_FAILED",
    message: timeout
      ? "Hosted SDS/TDS PDF extraction timed out. Use the local ClearEdge app for large or scanned PDFs, or paste extracted text."
      : message,
    retryLocal: timeout,
    warnings: [message]
  }, { status: timeout ? 504 : status });
}

async function loadSyncedOpenAiConfig() {
  try {
    const { loadBriefSettings } = await import("./_shared/knowledge-store.mjs");
    const settings = await loadBriefSettings().catch(() => ({})) ?? {};
    return settings.openAiConfig ?? settings.openAIConfig ?? settings.aiBriefConfig ?? {};
  } catch {
    return {};
  }
}

export default async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ ok: false, error: "METHOD_NOT_ALLOWED", message: "Method not allowed." }, { status: 405 });
    }

    const payload = await req.json().catch(() => ({}));
    const fileName = payload.fileName || payload.name || "document.pdf";
    const mimeType = payload.mimeType || "application/pdf";
    const base64 = base64FromPayload(payload);
    const warnings = [];

    if (!base64) {
      return Response.json({
        ok: false,
        error: "MISSING_PDF_DATA",
        fileName,
        text: "",
        fields: {},
        aiDerivedFields: [],
        warnings: ["No PDF data was received."]
      }, { status: 400 });
    }

    let text = "";
    let method = "local_pdf_text";

    try {
      text = extractPdfText(Buffer.from(base64, "base64"));
    } catch (error) {
      warnings.push(`Local PDF text extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    const syncedOpenAiConfig = await loadSyncedOpenAiConfig();
    const openAiConfig = {
      apiKey: syncedOpenAiConfig.apiKey || getEnv("OPENAI_API_KEY") || "",
      model: syncedOpenAiConfig.productDocumentModel || syncedOpenAiConfig.model || getEnv("OPENAI_PRODUCT_DOCUMENT_MODEL") || getEnv("OPENAI_MODEL") || "",
      timeoutMs: hostedProductDocumentTimeoutMs(
        getEnv("OPENAI_PRODUCT_DOCUMENT_TIMEOUT_MS"),
        syncedOpenAiConfig.productDocumentTimeoutMs,
        syncedOpenAiConfig.timeoutMs
      )
    };

    const textQuality = productDocumentTextQuality(text);
    const forceAi = payload.forceAi !== false && shouldRunProductDocumentPdfAi({
      text,
      forceAi: payload.forceAi === true
    });
    let aiResult = {
      ok: false,
      text: "",
      fields: {},
      aiDerivedFields: [],
      missingShelfCycleFields: [],
      shelfCycleNotes: [],
      warnings: []
    };

    if (forceAi) {
      aiResult = await extractProductDocumentPdfWithAi({
        fileName,
        mimeType,
        base64,
        config: openAiConfig
      });

      if (aiResult.text) {
        text = aiResult.text;
        method = "openai_pdf";
      } else if (hasUsefulProductDocumentFields(aiResult.fields)) {
        method = "openai_pdf_fields";
      }
    }

    const finalQuality = productDocumentTextQuality(text);
    const usefulFieldsFound = hasUsefulProductDocumentFields(aiResult.fields);
    const responseText = finalQuality.readable ? text : "";

    const combinedWarnings = [
      ...warnings,
      textQuality.readable ? "" : textQuality.reason,
      ...(aiResult.warnings ?? []),
      responseText || usefulFieldsFound ? "" : "No readable PDF text or structured ShelfCycle fields were found. If this is a scanned PDF, use the local app or paste extracted text."
    ].filter(Boolean);

    return Response.json({
      ok: Boolean(responseText || usefulFieldsFound),
      fileName,
      mimeType,
      text: responseText,
      method,
      fields: aiResult.fields ?? {},
      aiDerivedFields: aiResult.aiDerivedFields ?? [],
      missingShelfCycleFields: aiResult.missingShelfCycleFields ?? [],
      shelfCycleNotes: aiResult.shelfCycleNotes ?? [],
      warnings: combinedWarnings,
      source: "netlify"
    }, { status: responseText || usefulFieldsFound ? 200 : 422 });
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = {
  path: "/api/product-document/extract"
};
