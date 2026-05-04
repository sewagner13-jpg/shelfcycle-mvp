import { runAutoBrief } from "../../src/lib/auto-brief.mjs";
import { getEnv } from "./_shared/env.mjs";
import { attachReviewActions } from "./_shared/review-actions.mjs";
import { loadBriefSettings, loadKnowledgeBundle, saveLatestBrief } from "./_shared/knowledge-store.mjs";

export default async () => {
  const bundle = await loadKnowledgeBundle();
  const settings = (await loadBriefSettings()) || {};

  if (!bundle) {
    console.error("No knowledge bundle found in Netlify Blobs.");
    return;
  }

  if (!settings.gmailConfig?.clientId || !settings.gmailConfig?.clientSecret || !settings.gmailConfig?.refreshToken) {
    console.error("No Gmail settings found in Netlify Blobs.");
    return;
  }

  const recipient = settings.recipient || getEnv("DAILY_BRIEF_RECIPIENT") || settings.gmailConfig?.user || getEnv("GMAIL_USER");
  const hours = Number.parseInt(String(settings.hours ?? getEnv("DAILY_BRIEF_HOURS", "24")), 10);
  const maxMessages = Number.parseInt(String(settings.maxMessages ?? getEnv("DAILY_BRIEF_MAX_MESSAGES", "200")), 10);
  const query = settings.query || getEnv("DAILY_BRIEF_QUERY", "-in:trash -in:spam -subject:\"Daily ShelfCycle Brief\"");
  const timeZone = settings.timeZone || getEnv("DAILY_BRIEF_TIMEZONE", "America/New_York");
  const locale = settings.locale || getEnv("DAILY_BRIEF_LOCALE", "en-US");
  const siteUrl = settings.siteUrl || getEnv("URL") || getEnv("DEPLOY_PRIME_URL");
  const briefFormat = settings.briefFormat || getEnv("DAILY_BRIEF_FORMAT", "action_cards");

  const result = await runAutoBrief({
    bundle,
    gmailConfig: settings.gmailConfig,
    recipient,
    send: true,
    hours,
    maxMessages,
    query,
    briefFormat,
    aiBriefConfig: settings.aiBriefConfig ?? {},
    timeZone,
    locale,
    decorateAnalyzedThreads: (analyzedThreads) => attachReviewActions(analyzedThreads, { siteUrl })
  });

  await saveLatestBrief(result.brief);
  console.log(`Daily brief sent. Threads analyzed: ${result.analyzedThreads.length}`);
};

export const config = {
  schedule: "0 11 * * 1-5"
};
