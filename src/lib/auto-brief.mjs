import { readFile } from "node:fs/promises";

import { buildDailyBrief } from "./daily-brief.mjs";
import { analyzeThread } from "./email-triage.mjs";
import { fetchRecentThreads, getProfile, sendEmail } from "./gmail-client.mjs";
import { enrichThreadsWithWorkspaceArtifacts } from "./google-workspace-client.mjs";

async function loadKnowledgeBundle(bundlePath) {
  if (!bundlePath) {
    throw new Error("Missing knowledge bundle path.");
  }

  const contents = await readFile(bundlePath, "utf8");
  return JSON.parse(contents);
}

function filterLowSignalThreads(items = []) {
  return items.filter((item) => item.events?.length);
}

export async function runAutoBrief({
  bundle,
  bundlePath,
  gmailConfig = {},
  googleWorkspaceConfig = {},
  hours = 24,
  maxMessages = 200,
  query = "-in:trash -in:spam -subject:\"Daily ShelfCycle Brief\"",
  send = false,
  recipient,
  decorateAnalyzedThreads,
  timeZone = "America/New_York",
  locale = "en-US"
} = {}) {
  const resolvedBundle = bundle ?? (bundlePath ? await loadKnowledgeBundle(bundlePath) : null);

  if (!resolvedBundle) {
    throw new Error("Missing knowledge bundle or bundle path.");
  }

  const profile = await getProfile({ config: gmailConfig });
  const threads = await fetchRecentThreads({
    hours,
    maxMessages,
    query,
    config: gmailConfig
  });
  const enrichedThreads = await enrichThreadsWithWorkspaceArtifacts(threads, {
    config: gmailConfig,
    ...googleWorkspaceConfig
  });
  let analyzedThreads = filterLowSignalThreads(
    enrichedThreads.map((thread) => analyzeThread(thread, resolvedBundle))
  );

  if (typeof decorateAnalyzedThreads === "function") {
    analyzedThreads = await decorateAnalyzedThreads(analyzedThreads);
  }

  const brief = buildDailyBrief({
    analyzedThreads,
    organization: resolvedBundle.organization,
    timeZone,
    locale
  });

  let sendResult = null;

  if (send) {
    const to = recipient || profile.emailAddress;
    sendResult = await sendEmail({
      to,
      subject: `Daily ShelfCycle Brief - ${new Date().toISOString().slice(0, 10)}`,
      body: brief,
      config: gmailConfig
    });
  }

  return {
    profile,
    analyzedThreads,
    brief,
    sendResult
  };
}
