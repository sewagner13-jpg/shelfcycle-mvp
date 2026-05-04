import { readFile } from "node:fs/promises";

import { buildDailyBrief } from "./daily-brief.mjs";
import { analyzeThread } from "./email-triage.mjs";
import { fetchRecentThreads, getProfile, sendEmail } from "./gmail-client.mjs";
import { enrichThreadsWithWorkspaceArtifacts } from "./google-workspace-client.mjs";
import { runMessagesMemorySource } from "./messages-memory.mjs";
import { filterAnalyzedThreads } from "./brief-control.mjs";
import { refineBriefWithAi } from "./brief-ai-refiner.mjs";

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
  messagesConfig = {},
  hours = 24,
  maxMessages = 200,
  maxMessageThreads = 120,
  query = "-in:trash -in:spam -subject:\"Daily ShelfCycle Brief\"",
  includeMessages = false,
  send = false,
  recipient,
  decorateAnalyzedThreads,
  briefControl = {},
  aiBriefConfig = {},
  briefFormat = "action_cards",
  timeZone = "America/New_York",
  locale = "en-US"
} = {}) {
  const resolvedBundle = bundle ?? (bundlePath ? await loadKnowledgeBundle(bundlePath) : null);

  if (!resolvedBundle) {
    throw new Error("Missing knowledge bundle or bundle path.");
  }

  const messageMemory = includeMessages
    ? await runMessagesMemorySource({
        bundle: resolvedBundle,
        config: {
          enabled: true,
          lookbackHours: hours,
          maxThreads: maxMessageThreads,
          ...messagesConfig
        }
      })
    : null;
  const profile = await getProfile({ config: gmailConfig });
  const emailThreads = await fetchRecentThreads({
    hours,
    maxMessages,
    query,
    config: gmailConfig
  });
  const enrichedThreads = await enrichThreadsWithWorkspaceArtifacts(emailThreads, {
    config: gmailConfig,
    ...googleWorkspaceConfig
  });
  let analyzedThreads = filterLowSignalThreads(
    enrichedThreads.map((thread) => analyzeThread(thread, resolvedBundle))
  );
  analyzedThreads = filterAnalyzedThreads(analyzedThreads, briefControl);
  let resolvedMessageMemory = messageMemory;
  let briefAi = {
    status: "disabled",
    error: ""
  };

  try {
    const refinement = await refineBriefWithAi({
      analyzedThreads,
      messageMemory: resolvedMessageMemory,
      config: aiBriefConfig
    });
    analyzedThreads = refinement.analyzedThreads;
    resolvedMessageMemory = refinement.messageMemory;
    briefAi = {
      status: refinement.status,
      error: ""
    };
  } catch (error) {
    briefAi = {
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };

    if (aiBriefConfig.throwOnError) {
      throw error;
    }
  }

  if (typeof decorateAnalyzedThreads === "function") {
    analyzedThreads = await decorateAnalyzedThreads(analyzedThreads);
  }

  const brief = buildDailyBrief({
    analyzedThreads,
    organization: resolvedBundle.organization,
    title: includeMessages ? "Daily ClearEdge Communications Brief" : "Daily ClearEdge Email Brief",
    messageMemory: resolvedMessageMemory,
    briefFormat,
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
      html: briefFormat === "legacy" ? "" : brief,
      config: gmailConfig
    });
  }

  return {
    profile,
    analyzedThreads,
    messageMemory: resolvedMessageMemory,
    briefAi,
    brief,
    sendResult
  };
}
