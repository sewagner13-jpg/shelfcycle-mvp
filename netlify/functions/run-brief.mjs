import { runAutoBrief } from "../../src/lib/auto-brief.mjs";
import { requireBearerToken } from "./_shared/auth.mjs";
import { getEnv } from "./_shared/env.mjs";
import { attachReviewActions } from "./_shared/review-actions.mjs";
import { loadBriefSettings, loadKnowledgeBundle, saveLatestBrief } from "./_shared/knowledge-store.mjs";

export default async (req) => {
  const auth = requireBearerToken(req);

  if (!auth.ok) {
    return auth.response;
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const bundle = await loadKnowledgeBundle();
  const settings = (await loadBriefSettings()) || {};

  if (!bundle) {
    return new Response("No knowledge bundle has been synced yet.", { status: 400 });
  }

  if (!settings.gmailConfig?.clientId || !settings.gmailConfig?.clientSecret || !settings.gmailConfig?.refreshToken) {
    return new Response("No Gmail settings have been synced yet.", { status: 400 });
  }

  const payload = await req.json().catch(() => ({}));
  const send = payload.send !== false;
  const siteUrl = settings.siteUrl || getEnv("URL") || getEnv("DEPLOY_PRIME_URL");
  const recipient =
    payload.recipient ||
    settings.recipient ||
    getEnv("DAILY_BRIEF_RECIPIENT") ||
    settings.gmailConfig?.user ||
    getEnv("GMAIL_USER");
  const result = await runAutoBrief({
    bundle,
    gmailConfig: settings.gmailConfig,
    recipient,
    send,
    hours: payload.hours ?? settings.hours ?? Number.parseInt(getEnv("DAILY_BRIEF_HOURS", "24"), 10),
    maxMessages:
      payload.maxMessages ?? settings.maxMessages ?? Number.parseInt(getEnv("DAILY_BRIEF_MAX_MESSAGES", "200"), 10),
    query: payload.query || settings.query || getEnv("DAILY_BRIEF_QUERY", "-in:trash -in:spam -subject:\"Daily ShelfCycle Brief\""),
    briefFormat: payload.briefFormat || settings.briefFormat || getEnv("DAILY_BRIEF_FORMAT", "action_cards"),
    aiBriefConfig: {
      ...(settings.aiBriefConfig ?? {}),
      ...(payload.aiBrief !== undefined ? { enabled: Boolean(payload.aiBrief) } : {}),
      ...(payload.aiBriefModel ? { model: payload.aiBriefModel } : {})
    },
    timeZone: payload.timeZone || settings.timeZone || getEnv("DAILY_BRIEF_TIMEZONE", "America/New_York"),
    locale: payload.locale || settings.locale || getEnv("DAILY_BRIEF_LOCALE", "en-US"),
    decorateAnalyzedThreads: (analyzedThreads) => attachReviewActions(analyzedThreads, { siteUrl })
  });

  await saveLatestBrief(result.brief);

  return Response.json({
    ok: true,
    analyzedThreads: result.analyzedThreads.length,
    brief: result.brief
  });
};

export const config = {
  path: "/api/run-brief"
};
