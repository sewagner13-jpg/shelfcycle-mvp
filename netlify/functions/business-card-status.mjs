import { businessCardVisionStatus } from "../../src/lib/business-card-intake.mjs";
import { getEnv } from "./_shared/env.mjs";
import { loadBriefSettings } from "./_shared/knowledge-store.mjs";

export default async (req) => {
  try {
    if (req.method !== "GET") {
      return Response.json({ ok: false, error: "METHOD_NOT_ALLOWED", message: "Method not allowed." }, { status: 405 });
    }

    const settings = await loadBriefSettings().catch(() => ({})) ?? {};
    const syncedOpenAiConfig = settings.openAiConfig ?? settings.openAIConfig ?? settings.aiBriefConfig ?? {};
    const openAiConfig = {
      apiKey: syncedOpenAiConfig.apiKey || getEnv("OPENAI_API_KEY") || "",
      model: syncedOpenAiConfig.businessCardModel || syncedOpenAiConfig.model || getEnv("OPENAI_BUSINESS_CARD_MODEL") || getEnv("OPENAI_MODEL") || "",
      timeoutMs: getEnv("OPENAI_BUSINESS_CARD_TIMEOUT_MS") || syncedOpenAiConfig.timeoutMs || ""
    };

    return Response.json({
      ...businessCardVisionStatus(openAiConfig),
      source: syncedOpenAiConfig.apiKey ? "synced-settings" : (getEnv("OPENAI_API_KEY") ? "netlify-env" : "none")
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: "BUSINESS_CARD_STATUS_FAILED",
      message: error instanceof Error ? error.message : "Business-card status check failed."
    }, { status: 500 });
  }
};

export const config = {
  path: "/api/business-card/status"
};
