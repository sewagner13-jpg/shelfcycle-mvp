import { analyzeBusinessCard, businessCardVisionStatus, createBusinessCardReviewAction } from "../../src/lib/business-card-intake.mjs";
import { getEnv } from "./_shared/env.mjs";
import { loadBriefSettings, loadKnowledgeBundle, saveReviewAction } from "./_shared/knowledge-store.mjs";

function sanitizeActionRecord(action = {}) {
  const { viewToken, ...safe } = action;
  return safe;
}

function jsonError(error, status = 500) {
  const message = error instanceof Error ? error.message : "Business-card API failed.";
  return Response.json({
    ok: false,
    error: "BUSINESS_CARD_API_FAILED",
    message
  }, { status });
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
      timeoutMs: getEnv("OPENAI_BUSINESS_CARD_TIMEOUT_MS") || syncedOpenAiConfig.timeoutMs || ""
    };

    if (req.method === "GET") {
      return Response.json({
        ...businessCardVisionStatus(openAiConfig),
        source: syncedOpenAiConfig.apiKey ? "synced-settings" : (getEnv("OPENAI_API_KEY") ? "netlify-env" : "none")
      });
    }

    const payload = await req.json().catch(() => ({}));
    const knowledge = await loadKnowledgeBundle().catch(() => ({})) ?? {};
    const analysis = await analyzeBusinessCard({
      imageDataUrl: payload.imageDataUrl || "",
      text: payload.text || "",
      relationshipHint: payload.relationshipHint || "auto",
      entryMode: payload.entryMode || "auto",
      existingCompanyLabel: payload.existingCompanyLabel || "",
      useWebResearch: payload.useWebResearch !== false,
      config: openAiConfig,
      referenceData: {
        ...knowledge,
        ...(payload.referenceData ?? {})
      }
    });

    if (!analysis.ok) {
      return Response.json(analysis, { status: 400 });
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
