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

function parseDate(value = "") {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function effectiveLookbackHours({ hours = 24, since = "", until = "" } = {}) {
  const sinceDate = parseDate(since);

  if (!sinceDate) {
    return hours;
  }

  const untilDate = parseDate(until) ?? new Date();
  const diffMs = untilDate.getTime() - sinceDate.getTime();

  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return hours;
  }

  return Math.max(1, Math.ceil(diffMs / (60 * 60 * 1000)));
}

export async function runAutoBrief({
  bundle,
  bundlePath,
  gmailConfig = {},
  googleWorkspaceConfig = {},
  signatureExtractionConfig = {},
  messagesConfig = {},
  hours = 24,
  since = "",
  until = "",
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
  groupBy = "action",
  timeZone = "America/New_York",
  locale = "en-US",
  onProgress = async () => {}
} = {}) {
  const progress = async (phase, detail = {}) => {
    await onProgress({
      phase,
      ...detail
    });
  };

  await progress("loading_knowledge", { label: "Loading ClearEdge knowledge bundle" });
  const resolvedBundle = bundle ?? (bundlePath ? await loadKnowledgeBundle(bundlePath) : null);

  if (!resolvedBundle) {
    throw new Error("Missing knowledge bundle or bundle path.");
  }

  const resolvedHours = effectiveLookbackHours({ hours, since, until });

  await progress("messages", { label: includeMessages ? "Reading Mac Messages memory" : "Skipping Mac Messages" });
  const messageMemory = includeMessages
    ? await runMessagesMemorySource({
        bundle: resolvedBundle,
        config: {
          enabled: true,
          lookbackHours: resolvedHours,
          maxThreads: maxMessageThreads,
          ...messagesConfig
        }
      })
    : null;
  await progress("gmail_profile", { label: "Checking Gmail account" });
  const profile = await getProfile({ config: gmailConfig });
  await progress("gmail_fetch", { label: "Fetching recent Gmail threads" });
  const emailThreads = await fetchRecentThreads({
    hours: resolvedHours,
    since,
    until,
    maxMessages,
    query,
    config: gmailConfig
  });
  await progress("workspace_artifacts", {
    label: "Checking Gmail attachments and Workspace links",
    emailThreads: emailThreads.length
  });
  const enrichedThreads = await enrichThreadsWithWorkspaceArtifacts(emailThreads, {
    config: gmailConfig,
    signatureExtractionConfig: {
      ...(aiBriefConfig?.apiKey ? {
        apiKey: aiBriefConfig.apiKey,
        model: aiBriefConfig.model,
        endpoint: aiBriefConfig.endpoint,
        timeoutMs: aiBriefConfig.timeoutMs
      } : {}),
      internalDomains: resolvedBundle.internalDomains ?? [],
      ...signatureExtractionConfig
    },
    ...googleWorkspaceConfig
  });
  const signatureCount = enrichedThreads.reduce(
    (total, thread) => total + (thread.workspaceArtifacts?.emailSignatures?.length ?? 0),
    0
  );
  await progress("workspace_artifacts", {
    label: "Checked Gmail attachments, Workspace links, and signature contacts",
    emailThreads: enrichedThreads.length,
    emailSignatureContacts: signatureCount
  });
  await progress("classify", {
    label: "Classifying emails into customer, supplier, internal, and noise",
    emailThreads: enrichedThreads.length
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
    await progress("ai_refine", {
      label: "Refining the brief with owner-read action summaries",
      analyzedThreads: analyzedThreads.length
    });
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
    await progress("review_links", {
      label: "Creating local ShelfCycle review packet links",
      analyzedThreads: analyzedThreads.length
    });
    analyzedThreads = await decorateAnalyzedThreads(analyzedThreads);
  }

  await progress("build_brief", {
    label: "Building the final action-card brief",
    analyzedThreads: analyzedThreads.length
  });
  const brief = buildDailyBrief({
    analyzedThreads,
    organization: resolvedBundle.organization,
    title: includeMessages ? "Daily ClearEdge Communications Brief" : "Daily ClearEdge Email Brief",
    messageMemory: resolvedMessageMemory,
    briefFormat,
    groupBy,
    dateRange: {
      hours: resolvedHours,
      since,
      until
    },
    timeZone,
    locale
  });

  let sendResult = null;

  if (send) {
    await progress("send_email", {
      label: "Sending the brief email",
      recipient: recipient || profile.emailAddress
    });
    const to = recipient || profile.emailAddress;
    sendResult = await sendEmail({
      to,
      subject: `Daily ShelfCycle Brief - ${new Date().toISOString().slice(0, 10)}`,
      body: brief,
      html: briefFormat === "legacy" ? "" : brief,
      config: gmailConfig
    });
  }

  await progress("complete", {
    label: send ? "Brief emailed" : "Brief preview generated",
    analyzedThreads: analyzedThreads.length,
    sent: Boolean(sendResult)
  });

  return {
    profile,
    analyzedThreads,
    messageMemory: resolvedMessageMemory,
    briefAi,
    brief,
    sendResult
  };
}
