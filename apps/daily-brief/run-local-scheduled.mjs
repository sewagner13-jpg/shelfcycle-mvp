import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAutoBrief } from "../../src/lib/auto-brief.mjs";
import { loadBriefControl } from "../../src/lib/brief-control.mjs";
import { attachLocalReviewActions } from "../../src/lib/local-review-actions.mjs";
import { loadMessagesMemoryConfig } from "../../src/lib/messages-memory-config.mjs";
import {
  DAILY_BRIEF_WORKFLOW_STEPS,
  createWorkflowRun,
  failWorkflowRun,
  finishWorkflowRun,
  updateDailyBriefWorkflowFromPhase
} from "../../src/lib/workflow-runs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const localDir = path.join(projectRoot, ".local");
const runsDir = path.join(localDir, "daily-brief-runs");
const defaultBundlePath = path.join(localDir, "clearedge-knowledge-local.json");
const defaultSettingsPath = path.join(localDir, "hosted-brief-settings.local.json");
const defaultMessagesConfigPath = path.join(localDir, "messages-memory-config.local.json");
const defaultBriefControlPath = path.join(localDir, "brief-control.local.json");
const defaultReviewActionsDir = path.join(localDir, "review-actions");
const defaultLockDir = path.join(localDir, "daily-brief-runner.lock");
const defaultWorkflowRunsDir = path.join(localDir, "workflow-runs");

function parseArgs(argv = []) {
  const args = {
    bundle: defaultBundlePath,
    settings: defaultSettingsPath,
    messagesMemoryConfig: defaultMessagesConfigPath,
    briefControl: defaultBriefControlPath,
    reviewActionsDir: defaultReviewActionsDir,
    reviewBaseUrl: "http://localhost:4318",
    outDir: runsDir,
    hours: null,
    since: "",
    until: "",
    maxMessages: null,
    maxMessageThreads: null,
    recipient: "",
    briefFormat: "action_cards",
    groupBy: "action",
    aiBrief: null,
    aiBriefModel: "",
    dryRun: false,
    emailOnly: false,
    lockDir: defaultLockDir,
    workflowRunsDir: defaultWorkflowRunsDir,
    workflowRunId: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--bundle") {
      args.bundle = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--settings") {
      args.settings = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--messages-memory-config") {
      args.messagesMemoryConfig = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--brief-control") {
      args.briefControl = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--review-actions-dir") {
      args.reviewActionsDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--review-base-url") {
      args.reviewBaseUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--out-dir") {
      args.outDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--hours") {
      args.hours = Number.parseInt(argv[index + 1], 10) || null;
      index += 1;
      continue;
    }

    if (value === "--since") {
      args.since = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (value === "--until") {
      args.until = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (value === "--max-messages") {
      args.maxMessages = Number.parseInt(argv[index + 1], 10) || null;
      index += 1;
      continue;
    }

    if (value === "--max-message-threads") {
      args.maxMessageThreads = Number.parseInt(argv[index + 1], 10) || null;
      index += 1;
      continue;
    }

    if (value === "--recipient") {
      args.recipient = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--brief-format") {
      args.briefFormat = argv[index + 1] || "action_cards";
      index += 1;
      continue;
    }

    if (value === "--group-by") {
      const groupBy = argv[index + 1] || "action";
      args.groupBy = ["action", "company", "sender", "type"].includes(groupBy) ? groupBy : "action";
      index += 1;
      continue;
    }

    if (value === "--ai-brief") {
      args.aiBrief = true;
      continue;
    }

    if (value === "--no-ai-brief") {
      args.aiBrief = false;
      continue;
    }

    if (value === "--ai-brief-model") {
      args.aiBriefModel = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (value === "--lock-dir") {
      args.lockDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--workflow-runs-dir") {
      args.workflowRunsDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--workflow-run-id") {
      args.workflowRunId = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (value === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (value === "--email-only" || value === "--skip-messages") {
      args.emailOnly = true;
    }
  }

  return args;
}

function runStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
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
    return hours || 24;
  }

  const untilDate = parseDate(until) ?? new Date();
  const diffMs = untilDate.getTime() - sinceDate.getTime();

  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    return hours || 24;
  }

  return Math.max(1, Math.ceil(diffMs / (60 * 60 * 1000)));
}

function formatDateRangeLabel({ hours = 24, since = "", until = "" } = {}) {
  if (since || until) {
    return `${since || "default start"} to ${until || "now"}`;
  }

  return `last ${hours || 24} hour(s)`;
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${label} at ${filePath}: ${error.message}`);
  }
}

async function logLine(logPath, message) {
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, `${new Date().toISOString()} ${message}\n`, {
    flag: "a"
  });
}

function compactText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value = "", maxLength = 220) {
  const text = compactText(value);

  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3).trim()}...`;
}

function latestEvent(events = []) {
  return [...events]
    .filter((event) => event?.timestamp)
    .sort((left, right) => right.timestamp - left.timestamp)[0] ?? events[events.length - 1] ?? null;
}

function buildHiddenNoiseCleanupItems(analyzedThreads = []) {
  return analyzedThreads
    .filter((item) =>
      item.source === "gmail" &&
      item.threadId &&
      item.relationship?.relationship === "solicitation"
    )
    .map((item) => {
      const event = latestEvent(item.events ?? []);
      const sender = event?.from ?? item.externalParticipants?.[0] ?? {};

      return {
        threadId: item.threadId,
        messageIds: [...new Set((item.events ?? []).map((entry) => entry.id).filter(Boolean))],
        subject: item.subject || event?.subject || "No subject",
        senderName: sender.name || "",
        senderEmail: sender.email || "",
        senderDomain: sender.domain || "",
        lastTimestamp: item.lastTimestamp || event?.timestamp || 0,
        relationship: item.relationship?.relationship || "",
        subtype: item.relationship?.subtype || "",
        silo: item.silo?.name || "",
        state: item.state?.state || "",
        reasons: [
          ...(item.relationship?.reasons ?? []),
          ...(item.silo?.reasons ?? [])
        ].filter(Boolean).slice(0, 4),
        snippet: truncateText(event?.snippet || item.summary || ""),
        gmailUrl: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(item.threadId)}`,
        trashStatus: "available",
        trashedAt: ""
      };
    });
}

async function acquireLock(lockDir, { staleAfterMs = 2 * 60 * 60 * 1000 } = {}) {
  const resolved = path.resolve(lockDir);

  try {
    await mkdir(resolved, { recursive: false });
    await writeFile(path.join(resolved, "pid"), `${process.pid}\n`, "utf8");
    return async () => {
      await rm(resolved, { recursive: true, force: true });
    };
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }

    const current = await stat(resolved).catch(() => null);
    const ageMs = current ? Date.now() - current.mtimeMs : 0;

    if (ageMs > staleAfterMs) {
      await rm(resolved, { recursive: true, force: true });
      return acquireLock(resolved, { staleAfterMs });
    }

    throw new Error(`Daily brief runner is already running. Lock: ${resolved}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stamp = runStamp();
  const outDir = path.resolve(args.outDir);
  const workflowRunsDir = path.resolve(args.workflowRunsDir);
  const workflowRunId = args.workflowRunId || `daily-brief-${stamp}`;
  const briefPath = path.join(outDir, `combined-brief-${stamp}.txt`);
  const runSummaryPath = path.join(outDir, `run-summary-${stamp}.json`);
  const latestRunSummaryPath = path.join(outDir, "latest-run-summary.json");
  const latestBriefPreviewPath = path.join(outDir, "latest-brief-preview.json");
  const logPath = path.join(outDir, "daily-brief-runner.log");
  const progressPath = path.join(outDir, "current-status.json");
  const startedAt = new Date().toISOString();
  const resolvedHours = effectiveLookbackHours({
    hours: args.hours ?? 24,
    since: args.since,
    until: args.until
  });
  const dateRange = {
    hours: resolvedHours,
    since: args.since,
    until: args.until,
    label: formatDateRangeLabel({
      hours: resolvedHours,
      since: args.since,
      until: args.until
    })
  };
  let releaseLock = null;

  const writeProgress = async (patch = {}) => {
    if (patch.phase && !["finished", "failed"].includes(patch.phase) && patch.state !== "finished" && patch.state !== "failed") {
      await updateDailyBriefWorkflowFromPhase(workflowRunsDir, workflowRunId, patch.phase, patch).catch(() => {});
    }

    await writeFile(
      progressPath,
      JSON.stringify(
        {
          ok: true,
          runId: workflowRunId,
          workflowRunId,
          state: "running",
          dryRun: args.dryRun,
          emailOnly: args.emailOnly,
          dateRange,
          groupBy: args.groupBy,
          startedAt,
          updatedAt: new Date().toISOString(),
          briefPath,
          runSummaryPath,
          ...patch
        },
        null,
        2
      ),
      "utf8"
    );
  };

  await mkdir(outDir, { recursive: true });
  await logLine(logPath, `starting local scheduled brief; dryRun=${args.dryRun}; emailOnly=${args.emailOnly}; range=${dateRange.label}; groupBy=${args.groupBy}`);
  await createWorkflowRun(workflowRunsDir, {
    id: workflowRunId,
    type: "daily_brief",
    mode: args.emailOnly
      ? (args.dryRun ? "manual-email-preview" : "manual-email-only-send")
      : (args.dryRun ? "manual-preview" : "scheduled-or-manual"),
    title: args.emailOnly
      ? (args.dryRun ? "Manual ClearEdge email-only preview" : "ClearEdge email-only brief")
      : (args.dryRun ? "Manual ClearEdge brief preview" : "ClearEdge daily brief email"),
    metadata: {
      dryRun: args.dryRun,
      emailOnly: args.emailOnly,
      dateRange,
      groupBy: args.groupBy,
      briefPath,
      runSummaryPath,
      reviewBaseUrl: args.reviewBaseUrl
    },
    artifacts: {
      briefPath,
      runSummaryPath
    },
    steps: DAILY_BRIEF_WORKFLOW_STEPS
  });
  await writeProgress({
    phase: "starting",
    label: args.emailOnly
      ? "Starting Gmail-only brief"
      : "Starting local Mac Messages plus Gmail brief",
    dateRange,
    groupBy: args.groupBy
  });

  try {
    releaseLock = await acquireLock(args.lockDir);
    await writeProgress({
      phase: "config",
      label: args.emailOnly
        ? "Loading Gmail, exclusions, and knowledge settings"
        : "Loading Gmail, Messages, exclusions, and knowledge settings"
    });

    const [bundle, settings, messagesConfig, briefControl] = await Promise.all([
      readJson(args.bundle, "knowledge bundle"),
      readJson(args.settings, "Gmail settings"),
      loadMessagesMemoryConfig(path.resolve(args.messagesMemoryConfig)),
      loadBriefControl(path.resolve(args.briefControl))
    ]);
    const mergedMessagesConfig = {
      ...messagesConfig,
      blacklist: [
        ...(messagesConfig.blacklist ?? []),
        ...(briefControl.exclude?.emails ?? []),
        ...(briefControl.exclude?.phones ?? [])
      ],
      excludedKeywords: [
        ...(messagesConfig.excludedKeywords ?? []),
        ...(briefControl.exclude?.keywords ?? [])
      ]
    };
    const runHours = effectiveLookbackHours({
      hours: args.hours ?? settings.hours ?? 24,
      since: args.since,
      until: args.until
    });
    const runDateRange = {
      hours: runHours,
      since: args.since,
      until: args.until,
      label: formatDateRangeLabel({
        hours: runHours,
        since: args.since,
        until: args.until
      })
    };

    const result = await runAutoBrief({
      bundle,
      gmailConfig: settings.gmailConfig ?? {},
      googleWorkspaceConfig: settings.googleWorkspaceConfig ?? {},
      recipient: args.recipient || settings.recipient,
      hours: runHours,
      since: args.since,
      until: args.until,
      maxMessages: args.maxMessages ?? settings.maxMessages ?? 200,
      maxMessageThreads: args.maxMessageThreads ?? settings.maxMessageThreads ?? mergedMessagesConfig.maxThreads,
      query: settings.query,
      includeMessages: !args.emailOnly,
      briefFormat: settings.briefFormat || args.briefFormat,
      groupBy: args.groupBy,
      aiBriefConfig: {
        ...(settings.aiBriefConfig ?? {}),
        ...(args.aiBrief !== null ? { enabled: args.aiBrief } : {}),
        ...(args.aiBriefModel ? { model: args.aiBriefModel } : {})
      },
      messagesConfig: mergedMessagesConfig,
      briefControl,
      send: !args.dryRun,
      timeZone: settings.timeZone || "America/New_York",
      locale: settings.locale || "en-US",
      onProgress: writeProgress,
      decorateAnalyzedThreads: (analyzedThreads) =>
        attachLocalReviewActions(analyzedThreads, {
          storageDir: path.resolve(args.reviewActionsDir),
          baseUrl: args.reviewBaseUrl
        })
    });

    const messageMemory = result.messageMemory ?? {};
    const hiddenNoise = buildHiddenNoiseCleanupItems(result.analyzedThreads ?? []);
    const packetsGenerated = result.analyzedThreads?.filter((item) => item.reviewUrl).length ?? 0;
    const executableActions = result.analyzedThreads
      ?.flatMap((item) => item.reviewAction?.executableActions ?? item.executableActions ?? [])
      .length ?? 0;
    const summary = {
      ok: true,
      runId: workflowRunId,
      legacyRunId: stamp,
      mode: args.emailOnly
        ? (args.dryRun ? "manual-email-preview" : "manual-email-only-send")
        : (args.dryRun ? "manual-preview" : "scheduled-or-manual"),
      startedAt,
      finishedAt: new Date().toISOString(),
      dryRun: args.dryRun,
      emailOnly: args.emailOnly,
      dateRange: runDateRange,
      groupBy: args.groupBy,
      generatedAt: new Date().toISOString(),
      profileEmail: result.profile?.emailAddress ?? "",
      sent: Boolean(result.sendResult),
      sendResultId: result.sendResult?.id ?? "",
      emailThreads: result.analyzedThreads?.length ?? 0,
      messageBusinessThreads: messageMemory.business_threads?.length ?? 0,
      unknownMessageContacts: messageMemory.unknown_contacts?.length ?? 0,
      unknownContacts: messageMemory.unknown_contacts ?? [],
      messageFollowups: messageMemory.suggested_followups?.length ?? 0,
      reviewLinks: packetsGenerated,
      hiddenNoise,
      briefAi: result.briefAi,
      briefPath,
      structured: {
        runId: workflowRunId,
        legacyRunId: stamp,
        mode: args.emailOnly
          ? (args.dryRun ? "manual-email-preview" : "manual-email-only-send")
          : (args.dryRun ? "manual-preview" : "scheduled-or-manual"),
        startedAt,
        finishedAt: new Date().toISOString(),
        dateRange: runDateRange,
        groupBy: args.groupBy,
        gmail: {
          threadsProcessed: result.analyzedThreads?.length ?? 0,
          unansweredThreads: result.analyzedThreads?.filter((item) => item.state?.state === "needs_attention").length ?? 0,
          highPriorityThreads: result.analyzedThreads?.filter((item) => item.priority === "high" || item.briefAi?.priority === "high").length ?? 0
        },
        messages: {
          businessThreadsFound: messageMemory.business_threads?.length ?? 0,
          items: messageMemory.business_threads ?? [],
          suggestedFollowups: messageMemory.suggested_followups ?? [],
          unknownContacts: messageMemory.unknown_contacts ?? []
        },
        review: {
          packetsGenerated,
          executableActions,
          previewOnlyActions: Math.max(0, packetsGenerated - executableActions)
        },
        hiddenNoise,
        shelfcycle: {
          submittedActions: 0,
          failedActions: 0
        },
        errors: []
      }
    };

    await writeFile(briefPath, result.brief, "utf8");
    await writeFile(runSummaryPath, JSON.stringify(summary, null, 2), "utf8");
    await writeFile(latestRunSummaryPath, JSON.stringify(summary, null, 2), "utf8");
    await writeFile(latestBriefPreviewPath, JSON.stringify(summary, null, 2), "utf8");
    await finishWorkflowRun(workflowRunsDir, workflowRunId, {
      metrics: {
        emailThreads: summary.emailThreads,
        messageBusinessThreads: summary.messageBusinessThreads,
        unknownMessageContacts: summary.unknownMessageContacts,
        reviewLinks: summary.reviewLinks,
        sent: summary.sent
      },
      artifacts: {
        briefPath,
        runSummaryPath
      }
    }).catch(() => {});
    await writeProgress({
      state: "finished",
      phase: "finished",
      label: summary.sent ? "Brief emailed successfully" : "Brief preview generated successfully",
      summary
    });
    await logLine(
      logPath,
      `finished ok; emailThreads=${summary.emailThreads}; messageBusinessThreads=${summary.messageBusinessThreads}; unknownMessageContacts=${summary.unknownMessageContacts}; reviewLinks=${summary.reviewLinks}; sent=${summary.sent}; brief=${briefPath}`
    );
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    const summary = {
      ok: false,
      generatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    };

    await writeFile(runSummaryPath, JSON.stringify(summary, null, 2), "utf8").catch(() => {});
    await writeFile(latestRunSummaryPath, JSON.stringify(summary, null, 2), "utf8").catch(() => {});
    await failWorkflowRun(workflowRunsDir, workflowRunId, summary.error, {
      stepId: "email_send"
    }).catch(() => {});
    await writeProgress({
      ok: false,
      state: "failed",
      phase: "failed",
      label: "Brief failed",
      error: summary.error,
      summary
    }).catch(() => {});
    await logLine(logPath, `failed; ${summary.error}`).catch(() => {});
    throw error;
  } finally {
    if (releaseLock) {
      await releaseLock();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
