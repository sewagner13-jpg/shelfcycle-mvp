import { analyzeBusinessCard, businessCardVisionStatus, createBusinessCardReviewAction } from "../../src/lib/business-card-intake.mjs";
import { getEnv } from "./_shared/env.mjs";
import { loadBriefSettings, loadKnowledgeBundle, saveReviewAction } from "./_shared/knowledge-store.mjs";

const HOSTED_BUSINESS_CARD_TIMEOUT_MS = 18000;

function sanitizeActionRecord(action = {}) {
  const { viewToken, ...safe } = action;
  return safe;
}

function hostedBusinessCardTimeoutMs(...values) {
  const parsed = values
    .map((value) => Number.parseInt(String(value || ""), 10))
    .find((value) => Number.isFinite(value) && value > 0);

  return Math.min(parsed || HOSTED_BUSINESS_CARD_TIMEOUT_MS, HOSTED_BUSINESS_CARD_TIMEOUT_MS);
}

function isTimeoutMessage(message = "") {
  return /\b(timeout|timed out|aborted|inactivity timeout)\b/i.test(String(message || ""));
}

function businessCardFailureStatus(analysis = {}) {
  const text = [
    analysis.message,
    ...(analysis.warnings ?? [])
  ].filter(Boolean).join(" ");

  return isTimeoutMessage(text) ? 504 : 400;
}

function jsonError(error, status = 500) {
  const message = error instanceof Error ? error.message : "Business-card API failed.";
  const timeout = isTimeoutMessage(message);

  return Response.json({
    ok: false,
    error: timeout ? "BUSINESS_CARD_SCAN_TIMEOUT" : "BUSINESS_CARD_API_FAILED",
    message: timeout
      ? "Hosted business-card image extraction timed out before completion. Use the local ClearEdge app for image scans, or paste the card text and scan again."
      : message,
    retryLocal: timeout
  }, { status: timeout ? 504 : status });
}

export default async (req) => {
  try {
    if (req.method !== "POST" && req.method !== "GET") {
      return Response.json({ ok: false, error: "METHOD_NOT_ALLOWED", message: "Method not allowed." }, { status: 405 });
    }

    const url = new URL(req.url);
    const settings = await loadBriefSettings().catch(() => ({})) ?? {};
    const syncedOpenAiConfig = settings.openAiConfig ?? settings.openAIConfig ?? settings.aiBriefConfig ?? {};
    const openAiConfig = {
      apiKey: syncedOpenAiConfig.apiKey || getEnv("OPENAI_API_KEY") || "",
      model: syncedOpenAiConfig.businessCardModel || syncedOpenAiConfig.model || getEnv("OPENAI_BUSINESS_CARD_MODEL") || getEnv("OPENAI_MODEL") || "",
      timeoutMs: hostedBusinessCardTimeoutMs(
        getEnv("OPENAI_BUSINESS_CARD_TIMEOUT_MS"),
        syncedOpenAiConfig.businessCardTimeoutMs,
        syncedOpenAiConfig.timeoutMs
      )
    };

    if (req.method === "GET") {
      return Response.json({
        ...businessCardVisionStatus(openAiConfig),
        source: syncedOpenAiConfig.apiKey ? "synced-settings" : (getEnv("OPENAI_API_KEY") ? "netlify-env" : "none")
      });
    }

    const payload = await req.json().catch(() => ({}));
    const knowledge = await loadKnowledgeBundle().catch(() => ({})) ?? {};
    const hasImage = Boolean(payload.imageDataUrl);
    const useWebResearch = hasImage ? false : payload.useWebResearch === true;
    const analysis = await analyzeBusinessCard({
      imageDataUrl: payload.imageDataUrl || "",
      text: payload.text || "",
      relationshipHint: payload.relationshipHint || "auto",
      entryMode: payload.entryMode || "auto",
      existingCompanyLabel: payload.existingCompanyLabel || "",
      useWebResearch,
      config: openAiConfig,
      referenceData: {
        ...knowledge,
        ...(payload.referenceData ?? {})
      }
    });

    if (!analysis.ok) {
      return Response.json({
        ...analysis,
        retryLocal: businessCardFailureStatus(analysis) === 504
      }, { status: businessCardFailureStatus(analysis) });
    }

    if (hasImage && payload.useWebResearch === true) {
      analysis.warnings = [
        ...(analysis.warnings ?? []),
        "Hosted image scans skip web research to avoid timeout. Use the local app for slower enrichment after extraction."
      ];
    }

    const action = createBusinessCardReviewAction({
      analysis,
      baseUrl: url.origin
    });
    await saveReviewAction(action);

    return Response.json({
      ok: true,
      analysis,
      action: sanitizeActionRecord(action),
      reviewUrl: action.reviewUrl,
      submitUrl: action.submitUrl
    });
  } catch (error) {
    return jsonError(error);
  }
};

export const config = {
  path: "/api/business-card/scan"
};
