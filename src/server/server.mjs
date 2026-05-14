import http from "node:http";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { analyzeInput } from "../lib/analyze.mjs";
import { analyzeBusinessCard, businessCardVisionStatus, createBusinessCardReviewAction } from "../lib/business-card-intake.mjs";
import { researchCompanyPublicInfo } from "../lib/customer-web-enrichment.mjs";
import { importCsv } from "../lib/csv-import.mjs";
import { createKnowledgeBundle } from "../lib/knowledge-bundle.mjs";
import { addExclusion, loadBriefControl, saveBriefControl } from "../lib/brief-control.mjs";
import { createReviewActionRecord, loadLocalReviewAction, saveLocalReviewAction, sanitizeReviewAction } from "../lib/local-review-actions.mjs";
import { collectExecutableActions, collectProposedActions, findProposedAction, SHELFCYCLE_ACTION_TYPES, SHELFCYCLE_ERROR_CODES } from "../lib/shelfcycle-action-router.mjs";
import { executeApprovedShelfCycleAction } from "../lib/shelfcycle-action-executor.mjs";
import { fetchGmailAttachmentData, trashGmailThread } from "../lib/gmail-client.mjs";
import { extractPdfText } from "../lib/pdf-text-extractor.mjs";
import {
  extractProductDocumentPdfWithAi,
  refineProductDocumentWithAi,
  resolveProductDocumentAiConfig
} from "../lib/product-document-ai.mjs";
import {
  hasUsefulProductDocumentFields,
  mergeProductDocumentExtractionIntoResult,
  productDocumentTextQuality,
  shouldRunProductDocumentPdfAi
} from "../lib/product-document-source.mjs";
import { customerRequirementsForFields } from "../lib/shelfcycle-customer-requirements.mjs";
import { supplierRequirementsForFields } from "../lib/shelfcycle-supplier-requirements.mjs";
import { shelfCycleProductRequirementsForFields } from "../lib/shelfcycle-product-requirements.mjs";
import { buildShelfCycleReadyNote } from "../lib/shelfcycle-ready-note.mjs";
import { getNoteSubmissionTarget } from "../lib/shelfcycle-submit.mjs";
import {
  ACTION_STATE,
  SHELFCYCLE_APPROVAL_WORKFLOW_STEPS,
  WORKFLOW_STATUS,
  WORKFLOW_STEP_STATUS,
  actionContractForProposedAction,
  appendWorkflowLog,
  createWorkflowRun,
  failWorkflowRun,
  finishWorkflowRun,
  listWorkflowRuns,
  loadLatestWorkflowRun,
  loadWorkflowRun,
  updateWorkflowStep
} from "../lib/workflow-runs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const publicRoot = path.join(projectRoot, "public");
const dataRoot = path.join(projectRoot, "data");
const DEFAULT_INTELLIGENCE_FILE = path.join(dataRoot, "clearedge-intelligence.json");
const LEGACY_INTELLIGENCE_FILE = path.join(dataRoot, "clearedge-brain-notebook-intelligence.json");
const AUTOMATION_RUNNER_PATH = path.join(projectRoot, "src/lib/shelfcycle-automation-runner.mjs");
const LOCAL_DAILY_BRIEF_RUNNER_PATH = path.join(projectRoot, "apps/daily-brief/run-local-scheduled.mjs");
const LOCAL_DAILY_BRIEF_RUNS_DIR = path.join(projectRoot, ".local/daily-brief-runs");
const LOCAL_DAILY_BRIEF_PROGRESS_PATH = path.join(LOCAL_DAILY_BRIEF_RUNS_DIR, "current-status.json");
const LOCAL_DAILY_BRIEF_LATEST_SUMMARY_PATH = path.join(LOCAL_DAILY_BRIEF_RUNS_DIR, "latest-run-summary.json");
const LOCAL_DAILY_BRIEF_LATEST_PREVIEW_PATH = path.join(LOCAL_DAILY_BRIEF_RUNS_DIR, "latest-brief-preview.json");
const LOCAL_DAILY_BRIEF_LOCK_DIR = path.join(projectRoot, ".local/daily-brief-runner.lock");
const LOCAL_DAILY_BRIEF_REQUEST_LOCK_DIR = path.join(projectRoot, ".local/daily-brief-request.lock");
const LOCAL_BRIEF_CONTROL_PATH = path.join(projectRoot, ".local/brief-control.local.json");
const LOCAL_REVIEW_ACTIONS_DIR = path.join(projectRoot, ".local/review-actions");
const LOCAL_WORKFLOW_RUNS_DIR = path.join(projectRoot, ".local/workflow-runs");
const LOCAL_KNOWLEDGE_PATH = path.join(projectRoot, ".local/clearedge-knowledge-local.json");
const LOCAL_OPENAI_CONFIG_PATH = path.join(projectRoot, ".local/openai.local.json");
const LOCAL_HOSTED_SETTINGS_PATH = path.join(projectRoot, ".local/hosted-brief-settings.local.json");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type"
};

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...CORS_HEADERS
  });
  response.end(JSON.stringify(payload, null, 2));
}

function html(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    ...CORS_HEADERS
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

async function serveStatic(requestPath, response) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const localPaths = safePath.startsWith("/data/")
    ? [
      path.join(publicRoot, safePath.replace(/^\//, "")),
      path.join(dataRoot, safePath.replace(/^\/data\//, ""))
    ]
    : [path.join(publicRoot, safePath.replace(/^\//, ""))];

  for (const localPath of localPaths) {
    try {
      const contents = await readFile(localPath);
      const extension = path.extname(localPath);

      response.writeHead(200, {
        "content-type": MIME_TYPES[extension] ?? "application/octet-stream"
      });
      response.end(contents);
      return;
    } catch {
      // Try the next static candidate.
    }
  }

  response.writeHead(404, {
    "content-type": "text/plain; charset=utf-8"
  });
  response.end("Not found");
}

async function fetchReviewAction(reviewUrl = "") {
  const url = String(reviewUrl).trim();

  if (!url) {
    throw new Error("Missing reviewUrl.");
  }

  const parsedUrl = new URL(url);
  const requestUrl = parsedUrl.pathname.endsWith("/review-action.html")
    ? `${parsedUrl.origin}/api/review-action?id=${encodeURIComponent(parsedUrl.searchParams.get("id") || "")}&token=${encodeURIComponent(parsedUrl.searchParams.get("token") || "")}`
    : parsedUrl.href;

  const response = await fetch(requestUrl);

  if (!response.ok) {
    throw new Error(`Could not load review action from ${url}.`);
  }

  const payload = await response.json();

  if (!payload?.action) {
    throw new Error("Review action response did not include an action payload.");
  }

  return payload.action;
}

function runDetachedLoginWindow(url = "") {
  const args = [AUTOMATION_RUNNER_PATH, "login"];

  if (url) {
    args.push("--url", url);
  }

  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore"
  });

  child.unref();
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function optionalIsoDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeBriefGroupBy(value = "") {
  return ["action", "company", "sender", "type"].includes(value) ? value : "action";
}

async function acquireBriefRequestLock({ staleAfterMs = 2 * 60 * 1000 } = {}) {
  try {
    await mkdir(LOCAL_DAILY_BRIEF_REQUEST_LOCK_DIR, { recursive: false });
    await writeFile(path.join(LOCAL_DAILY_BRIEF_REQUEST_LOCK_DIR, "started-at"), new Date().toISOString(), "utf8");
    return async () => {
      await rm(LOCAL_DAILY_BRIEF_REQUEST_LOCK_DIR, { recursive: true, force: true });
    };
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }

    const stats = await stat(LOCAL_DAILY_BRIEF_REQUEST_LOCK_DIR).catch(() => null);
    const ageMs = stats ? Date.now() - stats.mtimeMs : Number.POSITIVE_INFINITY;

    if (ageMs > staleAfterMs) {
      await rm(LOCAL_DAILY_BRIEF_REQUEST_LOCK_DIR, { recursive: true, force: true });
      return acquireBriefRequestLock({ staleAfterMs });
    }

    return null;
  }
}

async function requestLocalDailyBrief(payload = {}) {
  const currentRun = await readJsonIfPresent(LOCAL_DAILY_BRIEF_PROGRESS_PATH);
  const lockStats = await stat(LOCAL_DAILY_BRIEF_LOCK_DIR).catch(() => null);
  const currentRunUpdatedAt = currentRun?.updatedAt || currentRun?.startedAt || "";
  const currentRunAgeMs = currentRunUpdatedAt ? Date.now() - new Date(currentRunUpdatedAt).getTime() : Number.POSITIVE_INFINITY;
  const currentRunIsFresh = Number.isFinite(currentRunAgeMs) && currentRunAgeMs < 2 * 60 * 60 * 1000;

  if (lockStats || (currentRun?.state === "running" && currentRunIsFresh)) {
    return {
      ok: false,
      alreadyRunning: true,
      code: "ALREADY_RUNNING",
      message: "A daily brief run is already active.",
      statusUrl: "/api/daily-brief/status"
    };
  }

  const releaseRequestLock = await acquireBriefRequestLock();

  if (!releaseRequestLock) {
    return {
      ok: false,
      alreadyRunning: true,
      code: "ALREADY_RUNNING",
      message: "A daily brief run is already being started.",
      statusUrl: "/api/daily-brief/status"
    };
  }

  const args = [LOCAL_DAILY_BRIEF_RUNNER_PATH];
  const dryRun = Boolean(payload.dryRun);
  const emailOnly = Boolean(payload.emailOnly || payload.includeMessages === false);
  const hours = optionalNumber(payload.hours);
  const maxMessages = optionalNumber(payload.maxMessages);
  const maxMessageThreads = optionalNumber(payload.maxMessageThreads);
  const since = optionalIsoDate(payload.since);
  const until = optionalIsoDate(payload.until);
  const groupBy = normalizeBriefGroupBy(payload.groupBy);

  if (dryRun) {
    args.push("--dry-run");
  }

  if (emailOnly) {
    args.push("--email-only");
  }

  if (hours) {
    args.push("--hours", String(hours));
  }

  if (maxMessages) {
    args.push("--max-messages", String(maxMessages));
  }

  if (maxMessageThreads) {
    args.push("--max-message-threads", String(maxMessageThreads));
  }

  if (since) {
    args.push("--since", since);
  }

  if (until) {
    args.push("--until", until);
  }

  args.push("--group-by", groupBy);

  const startedAt = new Date().toISOString();
  const runId = `daily-brief-${startedAt.replace(/[:.]/g, "-")}`;
  args.push("--workflow-run-id", runId, "--workflow-runs-dir", LOCAL_WORKFLOW_RUNS_DIR);

  await mkdir(LOCAL_DAILY_BRIEF_RUNS_DIR, { recursive: true });
  await createWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, {
    id: runId,
    type: "daily_brief",
    mode: emailOnly
      ? (dryRun ? "manual-email-preview" : "manual-email-only-send")
      : (dryRun ? "manual-preview" : "manual-send"),
    title: emailOnly
      ? (dryRun ? "Manual ClearEdge email-only preview" : "Manual ClearEdge email-only brief")
      : (dryRun ? "Manual ClearEdge brief preview" : "Manual ClearEdge email brief"),
    status: WORKFLOW_STATUS.RUNNING,
    metadata: {
      requestedFrom: "local-web",
      dryRun,
      emailOnly,
      hours,
      since,
      until,
      groupBy
    },
    steps: [
      { id: "config", label: "Load settings and knowledge", status: WORKFLOW_STEP_STATUS.RUNNING },
      { id: "messages_ingest", label: emailOnly ? "Skip Mac Messages memory" : "Read Mac Messages memory" },
      { id: "gmail_fetch", label: "Fetch Gmail activity" },
      { id: "workspace_artifacts", label: "Inspect attachments and Workspace links" },
      { id: "triage", label: "Classify and triage communications" },
      { id: "ai_refine", label: "Refine owner-read summaries" },
      { id: "review_generate", label: "Generate review packets" },
      { id: "brief_build", label: "Build action dashboard brief" },
      { id: "email_send", label: "Send or save brief" }
    ]
  }).catch(() => {});
  await writeFile(
    LOCAL_DAILY_BRIEF_PROGRESS_PATH,
    JSON.stringify(
      {
        ok: true,
        workflowRunId: runId,
        state: "running",
        phase: "starting",
        label: emailOnly
          ? (dryRun ? "Manual email-only preview requested" : "Manual email-only brief requested")
          : (dryRun ? "Manual preview requested" : "Manual email brief requested"),
        dryRun,
        emailOnly,
        dateRange: {
          hours: hours || "",
          since,
          until
        },
        groupBy,
        startedAt,
        updatedAt: startedAt
      },
      null,
      2
    ),
    "utf8"
  ).catch(() => {});

  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore"
  });

  child.on("error", () => {
    releaseRequestLock().catch(() => {});
  });
  child.unref();
  setTimeout(() => {
    releaseRequestLock().catch(() => {});
  }, 15_000).unref();

  return {
    ok: true,
    runId,
    startedAt,
    mode: emailOnly
      ? (dryRun ? "manual-email-preview" : "manual-email-only-send")
      : (dryRun ? "manual-preview" : "manual-send"),
    dryRun,
    emailOnly,
    hours,
    since,
    until,
    groupBy,
    message: dryRun
      ? (emailOnly
        ? "Manual email-only preview started. Use the status endpoint to track progress."
        : "Manual preview started. Use the status endpoint to track progress.")
      : (emailOnly
        ? "Manual email-only brief started. Use the status endpoint to track progress."
        : "Manual email brief started. Use the status endpoint to track progress."),
    statusUrl: "/api/daily-brief/status",
    pid: child.pid
  };
}

async function latestFileByPrefix(directory, prefix) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
        .map(async (entry) => {
          const filePath = path.join(directory, entry.name);
          const stats = await stat(filePath);
          return { filePath, name: entry.name, mtimeMs: stats.mtimeMs };
        })
    );

    return files.sort((left, right) => right.mtimeMs - left.mtimeMs)[0] ?? null;
  } catch {
    return null;
  }
}

function nextDailyRun({ hour = 3, minute = 0 } = {}) {
  const next = new Date();
  next.setHours(hour, minute, 0, 0);

  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }

  return next.toISOString();
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirst(html = "", pattern) {
  return stripHtml(pattern.exec(html)?.[1] ?? "");
}

function extractSnapshotCounts(briefHtml = "") {
  const snapshot = {};
  const snapshotTable = /<table class="brief-snapshot">([\s\S]*?)<\/table>/i.exec(briefHtml)?.[1] ?? "";

  for (const row of snapshotTable.matchAll(/<tr>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi)) {
    snapshot[stripHtml(row[1])] = stripHtml(row[2]);
  }

  return snapshot;
}

function extractBriefLinks(articleHtml = "") {
  return [...articleHtml.matchAll(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({
    label: stripHtml(match[2]),
    url: match[1].replace(/&amp;/g, "&")
  }));
}

function extractBriefTopActions(briefHtml = "", limit = 5) {
  const actions = [];
  const topActionsSection = /<h2>Top Actions<\/h2>([\s\S]*?)(?:<h2>Text Messages<\/h2>|<h2>Waiting on Others<\/h2>|<h2>Internal \/ FYI<\/h2>)/i.exec(briefHtml)?.[1] ?? "";

  for (const article of topActionsSection.matchAll(/<article class="brief-card">([\s\S]*?)<\/article>/gi)) {
    const articleHtml = article[1];
    actions.push({
      kicker: extractFirst(articleHtml, /<p class="brief-kicker">([\s\S]*?)<\/p>/i),
      title: extractFirst(articleHtml, /<h3>([\s\S]*?)<\/h3>/i),
      time: extractFirst(articleHtml, /<strong>Time:<\/strong>\s*([\s\S]*?)<\/li>/i),
      type: extractFirst(articleHtml, /<strong>Type:<\/strong>\s*([\s\S]*?)<\/li>/i),
      state: extractFirst(articleHtml, /<strong>Task state:<\/strong>\s*([\s\S]*?)<\/li>/i),
      confidence: extractFirst(articleHtml, /<strong>Confidence:<\/strong>\s*([\s\S]*?)<\/li>/i),
      action: extractFirst(articleHtml, /<strong>Action:<\/strong>\s*([\s\S]*?)<\/li>/i),
      why: extractFirst(articleHtml, /<strong>Why:<\/strong>\s*([\s\S]*?)<\/li>/i),
      shelfCycleStatus: extractFirst(articleHtml, /<strong>ShelfCycle status:<\/strong>\s*([\s\S]*?)<\/li>/i),
      shelfCycle: extractFirst(articleHtml, /<strong>ShelfCycle:<\/strong>\s*([\s\S]*?)<\/li>/i),
      risk: extractFirst(articleHtml, /<strong>Risk:<\/strong>\s*([\s\S]*?)<\/li>/i),
      links: extractBriefLinks(articleHtml)
    });

    if (actions.length >= limit) {
      break;
    }
  }

  return actions;
}

function extractTextMessageSummary(briefHtml = "") {
  const section = /<h2>Text Messages<\/h2>([\s\S]*?)(?:<h2>Waiting on Others<\/h2>|<h2>Internal \/ FYI<\/h2>|<h2>Hidden Low Priority<\/h2>)/i.exec(briefHtml)?.[1] ?? "";

  if (!section) {
    return {
      summary: "No text-message section found in the latest brief.",
      action: "",
      unknownText: "",
      businessTexts: []
    };
  }

  return {
    summary: extractFirst(section, /<p><strong>Summary:<\/strong>\s*([\s\S]*?)<\/p>/i),
    action: extractFirst(section, /<p><strong>Action:<\/strong>\s*([\s\S]*?)<\/p>/i),
    unknownText: extractFirst(section, /<p>(\d+\s+unknown text contact\(s\)[\s\S]*?)<\/p>/i),
    businessTexts: [...section.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((item) => stripHtml(item[1])).slice(0, 5)
  };
}

async function getHomeDashboard() {
  const status = await getDailyBriefStatus();
  const latestBrief = await loadLatestSuccessfulBriefSummary();
  const latestSummary = latestBrief.summary ?? status.lastRun ?? null;
  const briefHtml = latestBrief.briefPath ? await readFile(latestBrief.briefPath, "utf8").catch(() => "") : "";
  const messages = latestSummary?.structured?.messages ?? null;

  return {
    ok: true,
    nextRunAt: status.nextRunAt,
    lastRun: latestSummary,
    lastRunSummaryPath: latestBrief.summaryPath || status.lastRunSummaryPath,
    snapshot: briefHtml ? extractSnapshotCounts(briefHtml) : {},
    topActions: briefHtml ? extractBriefTopActions(briefHtml) : [],
    textMessages: messages ? {
      summary: messages.businessThreadsFound
        ? `${messages.businessThreadsFound} business text thread(s) found.`
        : "No business text-message threads found in the latest run.",
      action: (messages.suggestedFollowups ?? [])[0]?.nextStep || "",
      unknownText: messages.unknownContacts?.length ? `${messages.unknownContacts.length} unknown text contact(s) need review.` : "",
      businessTexts: (messages.items ?? []).map((item) => item.summary || item.contact || "Business text thread").slice(0, 5)
    } : (briefHtml ? extractTextMessageSummary(briefHtml) : null),
    recentLogLines: status.recentLogLines ?? []
  };
}

async function getDailyBriefStatus() {
  const latestStructuredSummary = await readJsonIfPresent(LOCAL_DAILY_BRIEF_LATEST_SUMMARY_PATH);
  const latestSummaryFile = await latestFileByPrefix(LOCAL_DAILY_BRIEF_RUNS_DIR, "run-summary-");
  const latestLogFile = path.join(LOCAL_DAILY_BRIEF_RUNS_DIR, "daily-brief-runner.log");
  const latestSummary = latestStructuredSummary ?? (latestSummaryFile ? await readJsonIfPresent(latestSummaryFile.filePath) : null);
  const currentRun = await readJsonIfPresent(LOCAL_DAILY_BRIEF_PROGRESS_PATH);
  const workflowRunId = currentRun?.workflowRunId || currentRun?.runId || latestSummary?.runId || "";
  const workflowRun = workflowRunId ? await loadWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId) : null;
  const lockStats = await stat(LOCAL_DAILY_BRIEF_LOCK_DIR).catch(() => null);
  const logText = await readFile(latestLogFile, "utf8").catch(() => "");
  const logLines = logText.trim().split("\n").filter(Boolean);

  return {
    ok: true,
    nextRunAt: nextDailyRun(),
    source: {
      scheduler: "Mac local launchd",
      messages: "Mac-local Messages database",
      email: "Gmail API",
      hosted: "Netlify can show hosted pages and email/review links, but cannot read Apple Messages."
    },
    isRunning: Boolean(lockStats) || currentRun?.state === "running",
    currentRun: currentRun ?? null,
    workflowRun: workflowRun ?? null,
    lastRun: latestSummary,
    lastRunSummaryPath: latestStructuredSummary ? LOCAL_DAILY_BRIEF_LATEST_SUMMARY_PATH : latestSummaryFile?.filePath ?? "",
    lastError: latestSummary?.ok === false ? latestSummary.error : "",
    recentLogLines: logLines.slice(-8)
  };
}

function countReferenceItems(payload = {}) {
  const arrayCount = (value) => Array.isArray(value) ? value.length : 0;
  const objectCount = (value) => value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : 0;

  return {
    customers: arrayCount(payload.customers) || objectCount(payload.customerMap),
    suppliers: arrayCount(payload.suppliers),
    contacts: arrayCount(payload.contacts),
    products: arrayCount(payload.products) || arrayCount(payload.normalizedProducts),
    locations: arrayCount(payload.locations)
  };
}

async function getReferenceSnapshotStatus() {
  const stats = await stat(LOCAL_KNOWLEDGE_PATH).catch(() => null);
  const payload = await readJsonIfPresent(LOCAL_KNOWLEDGE_PATH);
  const updatedAt = payload?.generatedAt || (stats ? stats.mtime.toISOString() : "");
  const ageHours = updatedAt ? Math.max(0, Math.round((Date.now() - new Date(updatedAt).getTime()) / 36_000) / 100) : null;

  return {
    available: Boolean(payload),
    source: "Local ShelfCycle reference export / knowledge bundle",
    updatedAt,
    ageHours,
    counts: countReferenceItems(payload ?? {}),
    warning: payload
      ? "Newer ShelfCycle records may not be reflected until reference data is refreshed."
      : "No local ShelfCycle reference snapshot found."
  };
}

function workflowHasSucceededStep(run = {}, stepId = "") {
  return (run.steps ?? []).some((step) => step.id === stepId && step.status === WORKFLOW_STEP_STATUS.SUCCEEDED);
}

async function getLastShelfCycleWriteStatus() {
  const runs = await listWorkflowRuns(LOCAL_WORKFLOW_RUNS_DIR, { limit: 50, type: "shelfcycle_action" });
  const lastSubmitted = runs.find((run) => run.status === WORKFLOW_STATUS.SUCCEEDED && workflowHasSucceededStep(run, "shelfcycle_submit"));
  const lastFailed = runs.find((run) => run.status === WORKFLOW_STATUS.FAILED);
  const latest = runs[0] ?? null;

  return {
    lastSuccessfulAt: lastSubmitted?.finishedAt || lastSubmitted?.updatedAt || "",
    lastSuccessfulAction: lastSubmitted?.title || "",
    lastSuccessfulUrl: lastSubmitted?.artifacts?.shelfcycleUrl || "",
    lastFailedAt: lastFailed?.finishedAt || lastFailed?.updatedAt || "",
    lastFailedAction: lastFailed?.title || "",
    latestStatus: latest?.status || "none",
    verification: lastSubmitted
      ? "Verify the saved ShelfCycle record in the browser after automation completes."
      : "No successful ShelfCycle browser automation run is recorded yet."
  };
}

async function getHostedReviewSyncStatus() {
  const actions = [];

  try {
    const entries = await readdir(LOCAL_REVIEW_ACTIONS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const action = await readJsonIfPresent(path.join(LOCAL_REVIEW_ACTIONS_DIR, entry.name));

      if (!action?.hostedSync) {
        continue;
      }

      actions.push({
        id: action.id || entry.name.replace(/\.json$/i, ""),
        subject: action.subject || "",
        createdAt: action.createdAt || "",
        reviewUrl: action.reviewUrl || "",
        hostedSync: action.hostedSync
      });
    }
  } catch {
    // Missing local review storage is a status signal, not a server failure.
  }

  actions.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  const recent = actions.slice(0, 50);
  const successful = recent.filter((item) => item.hostedSync?.ok);
  const failed = recent.filter((item) => item.hostedSync && !item.hostedSync.ok);
  const latestFailure = failed[0] ?? null;

  return {
    recentPacketsChecked: recent.length,
    successful: successful.length,
    failed: failed.length,
    latestFailureAt: latestFailure?.createdAt || "",
    latestFailureMessage: latestFailure?.hostedSync?.message || "",
    status: failed.length ? "warning" : (successful.length ? "ok" : "unknown"),
    detail: failed.length
      ? `${failed.length} recent packet sync failure(s). Latest: ${latestFailure?.hostedSync?.message || "unknown failure"}.`
      : successful.length
        ? `${successful.length} recent packet(s) synced to hosted review storage.`
        : "No hosted review sync results found yet."
  };
}

async function getOperationsStatus() {
  const [dailyBrief, referenceSnapshot, lastShelfCycleWrite, hostedReviewSync] = await Promise.all([
    getDailyBriefStatus(),
    getReferenceSnapshotStatus(),
    getLastShelfCycleWriteStatus(),
    getHostedReviewSyncStatus()
  ]);
  const browserRunnerStats = await stat(AUTOMATION_RUNNER_PATH).catch(() => null);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    localRunner: {
      connected: true,
      label: "Connected",
      detail: "This page is being served by the local ClearEdge backend."
    },
    shelfCycleApi: {
      available: false,
      label: "Not available",
      detail: "ShelfCycle writes use approval-first local browser automation, not a direct API."
    },
    browserAutomation: {
      available: Boolean(browserRunnerStats),
      label: browserRunnerStats ? "Available" : "Missing",
      detail: browserRunnerStats
        ? "Local runner can open ShelfCycle and attempt approved actions."
        : "ShelfCycle automation runner was not found on this machine."
    },
    dailyBrief,
    referenceSnapshot,
    lastShelfCycleWrite,
    hostedReviewSync
  };
}

function safeDailyBriefPath(briefPath = "") {
  if (!briefPath) {
    return "";
  }

  const resolved = path.resolve(briefPath);
  const allowedRoot = path.resolve(LOCAL_DAILY_BRIEF_RUNS_DIR);

  return resolved.startsWith(`${allowedRoot}${path.sep}`) ? resolved : "";
}

async function loadLatestSuccessfulBriefSummary() {
  const previewSummary = await readJsonIfPresent(LOCAL_DAILY_BRIEF_LATEST_PREVIEW_PATH);
  const previewPath = safeDailyBriefPath(previewSummary?.briefPath || "");

  if (previewSummary?.ok === true && previewPath && await stat(previewPath).catch(() => null)) {
    return {
      summary: previewSummary,
      briefPath: previewPath,
      summaryPath: LOCAL_DAILY_BRIEF_LATEST_PREVIEW_PATH
    };
  }

  const status = await getDailyBriefStatus();
  const latestSummary = status.lastRun ?? null;
  const latestPath = safeDailyBriefPath(latestSummary?.briefPath || "");

  if (latestSummary?.ok === true && latestPath && await stat(latestPath).catch(() => null)) {
    await writeFile(LOCAL_DAILY_BRIEF_LATEST_PREVIEW_PATH, JSON.stringify(latestSummary, null, 2), "utf8").catch(() => {});

    return {
      summary: latestSummary,
      briefPath: latestPath,
      summaryPath: status.lastRunSummaryPath || ""
    };
  }

  return {
    summary: previewSummary ?? latestSummary ?? null,
    briefPath: "",
    summaryPath: previewSummary ? LOCAL_DAILY_BRIEF_LATEST_PREVIEW_PATH : status.lastRunSummaryPath || ""
  };
}

function hiddenNoiseItemsFromSummary(summary = {}) {
  return Array.isArray(summary.hiddenNoise)
    ? summary.hiddenNoise
    : Array.isArray(summary.structured?.hiddenNoise)
      ? summary.structured.hiddenNoise
      : [];
}

async function getHiddenNoiseCleanup() {
  const latest = await loadLatestSuccessfulBriefSummary();
  const items = hiddenNoiseItemsFromSummary(latest.summary)
    .map((item) => ({
      ...item,
      trashStatus: item.trashStatus || "available"
    }));

  return {
    ok: true,
    generatedAt: latest.summary?.generatedAt || latest.summary?.finishedAt || "",
    briefPath: latest.briefPath || "",
    summaryPath: latest.summaryPath || "",
    count: items.length,
    availableCount: items.filter((item) => item.trashStatus !== "trashed").length,
    items,
    missingScopeHint: "Moving Gmail items to Trash requires Gmail OAuth scope https://www.googleapis.com/auth/gmail.modify."
  };
}

function updateHiddenNoiseTrashStatus(summary = {}, resultByThreadId = new Map()) {
  const update = (items = []) => items.map((item) => {
    const result = resultByThreadId.get(item.threadId);

    if (!result) {
      return item;
    }

    return {
      ...item,
      trashStatus: result.ok ? "trashed" : "failed",
      trashedAt: result.ok ? result.trashedAt : item.trashedAt || "",
      trashError: result.ok ? "" : result.error || "Could not move this thread to Gmail Trash."
    };
  });
  const hiddenNoise = update(hiddenNoiseItemsFromSummary(summary));

  return {
    ...summary,
    hiddenNoise,
    structured: {
      ...(summary.structured ?? {}),
      hiddenNoise
    }
  };
}

async function saveHiddenNoiseSummaryUpdate({ summary = {}, summaryPath = "" } = {}) {
  if (summaryPath) {
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8").catch(() => {});
  }

  await writeFile(LOCAL_DAILY_BRIEF_LATEST_PREVIEW_PATH, JSON.stringify(summary, null, 2), "utf8").catch(() => {});

  const latestSummary = await readJsonIfPresent(LOCAL_DAILY_BRIEF_LATEST_SUMMARY_PATH);

  if (latestSummary?.runId && latestSummary.runId === summary.runId) {
    await writeFile(LOCAL_DAILY_BRIEF_LATEST_SUMMARY_PATH, JSON.stringify(summary, null, 2), "utf8").catch(() => {});
  }
}

function gmailTrashErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (/insufficient|permission|forbidden|403|scope/i.test(message)) {
    return "Gmail rejected the Trash request. Reauthorize Gmail with the gmail.modify scope, then retry.";
  }

  return message || "Gmail Trash request failed.";
}

async function trashHiddenNoiseThreads({ threadIds = [], confirm = false } = {}) {
  if (confirm !== true) {
    const error = new Error("Explicit confirmation is required before moving Gmail threads to Trash.");
    error.statusCode = 400;
    throw error;
  }

  const requested = [...new Set(threadIds.map((item) => String(item || "").trim()).filter(Boolean))];

  if (!requested.length) {
    const error = new Error("Select at least one hidden-noise thread to move to Gmail Trash.");
    error.statusCode = 400;
    throw error;
  }

  const latest = await loadLatestSuccessfulBriefSummary();
  const summary = latest.summary ?? {};
  const allowedItems = hiddenNoiseItemsFromSummary(summary);
  const allowedByThreadId = new Map(allowedItems.map((item) => [item.threadId, item]));
  const invalid = requested.filter((threadId) => !allowedByThreadId.has(threadId));

  if (invalid.length) {
    const error = new Error(`Refusing to trash thread(s) not found in the latest hidden-noise list: ${invalid.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  const gmailConfig = await loadLocalGmailConfig();
  const results = [];

  for (const threadId of requested) {
    const item = allowedByThreadId.get(threadId);

    if (item.trashStatus === "trashed") {
      results.push({
        ok: true,
        alreadyTrashed: true,
        threadId,
        subject: item.subject || "",
        trashedAt: item.trashedAt || ""
      });
      continue;
    }

    try {
      await trashGmailThread({ threadId, config: gmailConfig });
      results.push({
        ok: true,
        threadId,
        subject: item.subject || "",
        trashedAt: new Date().toISOString()
      });
    } catch (error) {
      results.push({
        ok: false,
        threadId,
        subject: item.subject || "",
        error: gmailTrashErrorMessage(error)
      });
    }
  }

  const resultByThreadId = new Map(results.map((result) => [result.threadId, result]));
  const updatedSummary = updateHiddenNoiseTrashStatus(summary, resultByThreadId);
  await saveHiddenNoiseSummaryUpdate({
    summary: updatedSummary,
    summaryPath: latest.summaryPath || ""
  });

  return {
    ok: results.every((result) => result.ok),
    results,
    movedCount: results.filter((result) => result.ok && !result.alreadyTrashed).length,
    failedCount: results.filter((result) => !result.ok).length,
    hiddenNoise: hiddenNoiseItemsFromSummary(updatedSummary)
  };
}

async function getLatestDailyBriefPreview() {
  const latest = await loadLatestSuccessfulBriefSummary();
  const latestSummary = latest.summary ?? null;
  const briefPath = latest.briefPath || "";

  if (!latestSummary || !briefPath) {
    return {
      ok: false,
      error: "No saved daily brief preview was found. Run a preview or brief first.",
      summary: latestSummary,
      briefHtml: "",
      briefPath: ""
    };
  }

  const briefHtml = await readFile(briefPath, "utf8").catch(() => "");

  if (!briefHtml) {
    return {
      ok: false,
      error: "The saved brief file could not be read.",
      summary: latestSummary,
      briefHtml: "",
      briefPath
    };
  }

  return {
    ok: true,
    summary: latestSummary,
    briefHtml,
    briefPath,
    summaryPath: latest.summaryPath || "",
    generatedAt: latestSummary.generatedAt || latestSummary.finishedAt || "",
    emailOnly: Boolean(latestSummary.emailOnly),
    dryRun: Boolean(latestSummary.dryRun),
    sent: Boolean(latestSummary.sent)
  };
}

async function getWorkflowRunsStatus({ limit = 20, type = "" } = {}) {
  const runs = await listWorkflowRuns(LOCAL_WORKFLOW_RUNS_DIR, { limit, type });

  return {
    ok: true,
    latest: runs[0] ?? await loadLatestWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR),
    runs
  };
}

async function getUnknownContactCleanup() {
  const status = await getDailyBriefStatus();
  const latestSummary = status.lastRun ?? null;

  return {
    ok: true,
    sourceBriefPath: latestSummary?.briefPath ?? "",
    unknownContacts: latestSummary?.unknownContacts ?? []
  };
}

async function loadLocalReviewActionForRequest(url) {
  const actionId = url.searchParams.get("id") || "";
  const token = url.searchParams.get("token") || "";

  if (!actionId || !token) {
    throw new Error("Missing review action id or token.");
  }

  const action = await loadLocalReviewAction(LOCAL_REVIEW_ACTIONS_DIR, actionId);

  if (!action) {
    throw new Error("Review action not found.");
  }

  if (action.viewToken !== token) {
    const error = new Error("Invalid review token.");
    error.statusCode = 403;
    throw error;
  }

  return enrichReviewActionForResponse(sanitizeReviewAction(action));
}

async function loadRawLocalReviewAction({ reviewActionId = "", token = "" } = {}) {
  if (!reviewActionId || !token) {
    const error = new Error("Missing review action id or token.");
    error.statusCode = 400;
    error.code = SHELFCYCLE_ERROR_CODES.INVALID_REVIEW_ACTION;
    throw error;
  }

  const action = await loadLocalReviewAction(LOCAL_REVIEW_ACTIONS_DIR, reviewActionId);

  if (!action) {
    const error = new Error("Review action not found.");
    error.statusCode = 404;
    error.code = SHELFCYCLE_ERROR_CODES.INVALID_REVIEW_ACTION;
    throw error;
  }

  if (action.viewToken !== token) {
    const error = new Error("Invalid review token.");
    error.statusCode = 403;
    error.code = SHELFCYCLE_ERROR_CODES.INVALID_TOKEN;
    throw error;
  }

  return action;
}

function enrichReviewActionForResponse(action = {}) {
  const enrichedAction = {
    ...action,
    shelfCycleReadyNote: action.shelfCycleReadyNote?.source === "user_approved"
      ? action.shelfCycleReadyNote
      : buildShelfCycleReadyNote(action)
  };
  const proposedActions = collectProposedActions(enrichedAction);

  return {
    ...enrichedAction,
    proposedActions,
    actionContracts: proposedActions.map((proposedAction) => actionContractForProposedAction(proposedAction)),
    executableActions: collectExecutableActions(enrichedAction)
  };
}

function errorResponse({ reviewActionId = "", actionId = "", actionType = "", workflowRunId = "", code = "ERROR", message = "Request failed.", warnings = [] } = {}) {
  return {
    ok: false,
    reviewActionId,
    actionId,
    actionType,
    workflowRunId,
    error: {
      code,
      message
    },
    warnings
  };
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function mergeIntelligenceEntries(existing = [], incoming = []) {
  const byEntity = new Map();

  for (const entry of [...existing, ...incoming]) {
    const entity = entry?.entity;

    if (!entity || byEntity.has(entity)) {
      continue;
    }

    byEntity.set(entity, entry);
  }

  return [...byEntity.values()];
}

async function loadProjectIntelligenceEntries() {
  const payload =
    (await readJsonIfPresent(DEFAULT_INTELLIGENCE_FILE)) ??
    (await readJsonIfPresent(LEGACY_INTELLIGENCE_FILE)) ??
    {};

  return payload.clearedgeIntelligence ?? payload.notebookIntelligence ?? [];
}

async function loadLocalKnowledgeBundle() {
  return await readJsonIfPresent(LOCAL_KNOWLEDGE_PATH) ?? {
    customers: [],
    suppliers: [],
    contacts: [],
    products: []
  };
}

async function loadLocalOpenAiConfig() {
  const config = await readJsonIfPresent(LOCAL_OPENAI_CONFIG_PATH) ?? {};
  const hostedSettings = await readJsonIfPresent(LOCAL_HOSTED_SETTINGS_PATH) ?? {};
  const sharedAiConfig = hostedSettings.openAiConfig ?? hostedSettings.openAIConfig ?? hostedSettings.aiBriefConfig ?? {};

  return {
    apiKey: config.apiKey || config.OPENAI_API_KEY || process.env.OPENAI_API_KEY || sharedAiConfig.apiKey || "",
    model: config.businessCardModel || config.model || process.env.OPENAI_BUSINESS_CARD_MODEL || process.env.OPENAI_MODEL || sharedAiConfig.businessCardModel || sharedAiConfig.model || "",
    productDocumentModel: config.productDocumentModel || process.env.OPENAI_PRODUCT_DOCUMENT_MODEL || sharedAiConfig.productDocumentModel || "",
    timeoutMs: config.timeoutMs || process.env.OPENAI_BUSINESS_CARD_TIMEOUT_MS || sharedAiConfig.timeoutMs || ""
  };
}

async function loadLocalGmailConfig() {
  const hostedSettings = await readJsonIfPresent(LOCAL_HOSTED_SETTINGS_PATH) ?? {};

  return hostedSettings.gmailConfig ?? {};
}

function safeFilePart(value = "", fallback = "review-packet") {
  return String(value || fallback)
    .replace(/[/:\\?%*"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || fallback;
}

function base64FromPayload(payload = {}) {
  const raw = String(payload.base64 || payload.dataUrl || "");
  const match = raw.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : raw;
}

function productFieldLabel(field = "") {
  return {
    shelfCycleReadySummary: "ShelfCycle Summary",
    productName: "Product Name",
    productFamily: "Product Family",
    productFamilyDescription: "Product Family Description",
    chemicalName: "Chemical Name",
    aliases: "Aliases",
    packagingType: "Packaging Type",
    supplierType: "Supplier Type",
    supplier: "Supplier",
    casNumber: "CAS",
    packaging: "Packaging",
    quantityPerPackage: "Quantity per package",
    unitOfMeasure: "Unit of Measure",
    nmfcCode: "NMFC",
    unNumber: "UN Number",
    packingGroup: "Packing Group",
    hazardClass: "Hazard Class",
    specialDesignation: "Special Designation",
    properShippingName: "Proper Shipping Name",
    signalWord: "GHS Signal Word",
    hazardSymbols: "Hazard Symbols",
    freightClass: "Freight Class"
  }[field] || String(field || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}

function productAiLines(aiDerivedFields = [], fields = {}) {
  const lines = [];
  const seen = new Set();
  const skipped = new Set(["extractedText", "documentType"]);

  for (const item of aiDerivedFields) {
    const field = String(item.field || "").trim();
    const value = String(item.value || "").trim();

    if (!field || skipped.has(field) || !value) {
      continue;
    }

    const key = `${field}:${value}`;
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(`${productFieldLabel(field)}: ${value}`);
    }
  }

  for (const [field, value] of Object.entries(fields ?? {})) {
    const cleanValue = String(value || "").trim();

    if (!field || skipped.has(field) || !cleanValue) {
      continue;
    }

    const key = `${field}:${cleanValue}`;
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(`${productFieldLabel(field)}: ${cleanValue}`);
    }
  }

  return lines;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function productIntakeReviewUrls(requestUrl, action = {}, host = "") {
  const base = `${requestUrl.protocol}//${host || requestUrl.host || "localhost:4318"}`;
  const reviewUrl = `${base}/review-action.html?id=${encodeURIComponent(action.id)}&token=${encodeURIComponent(action.viewToken)}`;

  return {
    reviewUrl,
    submitUrl: `${base}/review-submit.html?reviewUrl=${encodeURIComponent(reviewUrl)}`
  };
}

function productIntakeSubject(result = {}) {
  const fields = result.fields ?? {};
  const label = fields.code || fields.productName || fields.productFamily || "Product document";

  return `${result.documentType || "SDS/TDS"} intake - ${label}`;
}

function withUpdatedProductWritePlan(result = {}) {
  if (result.workflow !== "new_product") {
    return result;
  }

  const fields = result.fields ?? {};
  const matchedProduct = result.matches?.product?.[0]?.candidate ?? null;
  const matchedFamily = matchedProduct?.family || matchedProduct?.productFamily || "";
  const normalizedProductFields = {
    ...fields,
    productFamily: fields.productFamily || matchedFamily,
    packagingType: fields.packagingType || "Fixed",
    supplierType: fields.supplierType || "Variable"
  };
  const documentType = result.documentType ?? fields.documentType ?? "SDS";
  const shelfCycleRequirements = shelfCycleProductRequirementsForFields(normalizedProductFields);

  return {
    ...result,
    fields: normalizedProductFields,
    shelfCycleRequirements,
    writePlan: {
      ...(result.writePlan ?? {}),
      destination: matchedProduct?.code || matchedProduct?.name
        ? `Products > ${matchedProduct.code || matchedProduct.name}`
        : "Products > New Product Code",
      fields: {
        ...(result.writePlan?.fields ?? {}),
        productName: normalizedProductFields.productName ?? "",
        code: normalizedProductFields.code ?? "",
        productFamily: normalizedProductFields.productFamily ?? "",
        supplier: normalizedProductFields.supplier ?? "",
        casNumber: normalizedProductFields.casNumber ?? "",
        packagingType: normalizedProductFields.packagingType ?? "",
        packaging: normalizedProductFields.packaging ?? "",
        quantityPerPackage: normalizedProductFields.quantityPerPackage ?? "",
        supplierType: normalizedProductFields.supplierType ?? "",
        unNumber: normalizedProductFields.unNumber ?? "",
        packingGroup: normalizedProductFields.packingGroup ?? "",
        properShippingName: normalizedProductFields.properShippingName ?? "",
        freightClass: normalizedProductFields.freightClass ?? "",
        nmfcCode: normalizedProductFields.nmfcCode ?? "",
        hazardClass: normalizedProductFields.hazardClass ?? "",
        specialDesignation: normalizedProductFields.specialDesignation ?? "",
        signalWord: normalizedProductFields.signalWord ?? "",
        hazardSymbols: normalizedProductFields.hazardSymbols ?? "",
        shelfCycleReadySummary: normalizedProductFields.shelfCycleReadySummary ?? ""
      },
      missingRequiredFields: shelfCycleRequirements.missingRequiredFields.map((field) => field.message || field.label),
      readyForProductCodeCreate: shelfCycleRequirements.readyForProductCodeCreate,
      requirementSource: shelfCycleRequirements.source,
      aiDerivedFields: result.aiDerivedFields ?? [],
      attachments: [
        documentType === "SDS"
          ? "Attach SDS in product code safety attributes"
          : "Upload TDS in the product Documents drawer",
        matchedProduct ? "Existing product matched. Prefer update/document upload over duplicate create." : "",
        matchedProduct?.family || matchedProduct?.productFamily
          ? "Existing Product Family matched. Reuse family-level CAS, hazmat, GHS, and shipping identity; only vary package size, product code, supplier/package logistics, and documents that differ."
          : ""
      ].filter(Boolean)
    }
  };
}

function missingProductCoreFields(fields = {}) {
  return ["code", "productFamily", "packaging", "quantityPerPackage"].filter((key) => !String(fields[key] || "").trim());
}

function isPdfDocument(item = {}) {
  const name = String(item.filename || item.name || "").toLowerCase();
  const mime = String(item.mimeType || "").toLowerCase();

  return name.endsWith(".pdf") || mime === "application/pdf";
}

function localDocumentPath(item = {}) {
  return item.localPath || item.path || item.filePath || "";
}

async function copyReviewPacketPdfDocuments({ reviewAction = {}, destinationRoot = "", gmailConfig = {} } = {}) {
  const attachments = (reviewAction.workspaceArtifacts?.attachments ?? []).filter(isPdfDocument);
  const driveFiles = (reviewAction.workspaceArtifacts?.driveFiles ?? []).filter(isPdfDocument);
  const date = new Date().toISOString().slice(0, 10);
  const folderName = safeFilePart(`${date} - ${reviewAction.subject || reviewAction.id || "Review Packet PDFs"}`);
  const root = destinationRoot || path.join(process.env.HOME || projectRoot, "Desktop", "ClearEdge Review Documents");
  const folderPath = path.join(root, folderName);
  const copied = [];
  const unavailable = [];

  await mkdir(folderPath, { recursive: true });

  for (const attachment of attachments) {
    const filename = safeFilePart(attachment.filename || attachment.name || "attachment.pdf", "attachment.pdf");
    const targetPath = path.join(folderPath, filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`);
    const sourcePath = localDocumentPath(attachment);

    if (sourcePath) {
      try {
        await copyFile(sourcePath, targetPath);
        copied.push({
          filename,
          path: targetPath,
          source: "local_file"
        });
        continue;
      } catch (error) {
        unavailable.push({
          filename,
          reason: `Local file could not be copied: ${error instanceof Error ? error.message : String(error)}`
        });
        continue;
      }
    }

    if (attachment.messageId && attachment.attachmentId) {
      try {
        const payload = await fetchGmailAttachmentData({
          messageId: attachment.messageId,
          attachmentId: attachment.attachmentId,
          config: gmailConfig
        });
        await writeFile(targetPath, Buffer.from(payload.data || "", "base64url"));
        copied.push({
          filename,
          path: targetPath,
          source: "gmail_attachment"
        });
        continue;
      } catch (error) {
        unavailable.push({
          filename,
          reason: `Gmail attachment could not be downloaded: ${error instanceof Error ? error.message : String(error)}`
        });
        continue;
      }
    }

    unavailable.push({
      filename,
      reason: "This review packet has Gmail attachment metadata only. Re-run the brief once the updated attachment metadata is active, or download this PDF from Gmail manually."
    });
  }

  for (const file of driveFiles) {
    unavailable.push({
      filename: file.name || file.id || "Google Drive PDF",
      reason: file.webViewLink
        ? `Google Drive file is linked but not downloaded. Open it here: ${file.webViewLink}`
        : "Google Drive file metadata exists, but no direct local file is available."
    });
  }

  const manifest = [
    "ClearEdge review packet PDF reference folder",
    `Review packet: ${reviewAction.subject || reviewAction.id || "-"}`,
    `Created: ${new Date().toISOString()}`,
    "",
    "Copied PDFs:",
    ...(copied.length ? copied.map((item) => `- ${item.filename}: ${item.path}`) : ["- None"]),
    "",
    "Unavailable PDFs:",
    ...(unavailable.length ? unavailable.map((item) => `- ${item.filename}: ${item.reason}`) : ["- None"])
  ].join("\n");

  await writeFile(path.join(folderPath, "README.txt"), manifest, "utf8");

  return {
    ok: true,
    folderPath,
    copied,
    unavailable
  };
}

function spawnAndWait(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function openPathInAdobe(filePath = "") {
  const adobeApps = ["Adobe Acrobat", "Adobe Acrobat Reader"];
  const attempts = [];

  for (const appName of adobeApps) {
    try {
      await spawnAndWait("/usr/bin/open", ["-a", appName, filePath]);
      return {
        path: filePath,
        app: appName,
        status: "opened"
      };
    } catch (error) {
      attempts.push(`${appName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await spawnAndWait("/usr/bin/open", [filePath]);
  return {
    path: filePath,
    app: "default_pdf_app",
    status: "opened",
    warning: `Adobe Acrobat was not available; opened with the default PDF app. Attempts: ${attempts.join(" | ")}`
  };
}

async function openReviewPacketPdfDocuments({ reviewAction = {}, gmailConfig = {} } = {}) {
  const copyResult = await copyReviewPacketPdfDocuments({
    reviewAction,
    gmailConfig
  });
  const opened = [];
  const openErrors = [];

  for (const file of copyResult.copied ?? []) {
    try {
      opened.push(await openPathInAdobe(file.path));
    } catch (error) {
      openErrors.push({
        filename: file.filename,
        path: file.path,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    ...copyResult,
    opened,
    openErrors
  };
}

async function mergeProjectIntelligence(referenceData = {}) {
  const projectEntries = await loadProjectIntelligenceEntries();
  const existingEntries = referenceData.clearedgeIntelligence ?? referenceData.notebookIntelligence ?? [];
  const mergedEntries = mergeIntelligenceEntries(existingEntries, projectEntries);

  return {
    ...referenceData,
    clearedgeIntelligence: mergedEntries
  };
}

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "OPTIONS") {
        response.writeHead(204, CORS_HEADERS);
        response.end();
        return;
      }

      if (
        request.method === "GET" &&
        !url.pathname.startsWith("/api/") &&
        (
          url.pathname === "/" ||
          url.pathname.startsWith("/data/") ||
          url.pathname.startsWith("/app") ||
          url.pathname.endsWith(".css") ||
          url.pathname.endsWith(".js") ||
          url.pathname.endsWith(".html")
        )
      ) {
        await serveStatic(url.pathname, response);
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/ops/status") {
        json(response, 200, await getOperationsStatus());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/workflows/runs") {
        json(response, 200, await getWorkflowRunsStatus({
          limit: optionalNumber(url.searchParams.get("limit")) ?? 20,
          type: url.searchParams.get("type") || ""
        }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/workflows/latest") {
        json(response, 200, {
          ok: true,
          run: await loadLatestWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR)
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/workflows/run") {
        const runId = url.searchParams.get("id") || "";
        const run = runId ? await loadWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, runId) : null;
        json(response, run ? 200 : 404, run ? { ok: true, run } : { ok: false, error: "Workflow run not found." });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/daily-brief/status") {
        json(response, 200, await getDailyBriefStatus());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/daily-brief/latest") {
        const preview = await getLatestDailyBriefPreview();
        json(response, preview.ok ? 200 : 404, preview);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/daily-brief/latest.html") {
        const preview = await getLatestDailyBriefPreview();
        html(response, preview.ok ? 200 : 404, preview.ok ? preview.briefHtml : `<p>${preview.error}</p>`);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/home-dashboard") {
        json(response, 200, await getHomeDashboard());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/daily-brief/exclusions") {
        json(response, 200, {
          ok: true,
          control: await loadBriefControl(LOCAL_BRIEF_CONTROL_PATH)
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/daily-brief/unknown-contacts") {
        json(response, 200, await getUnknownContactCleanup());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/gmail/hidden-noise") {
        json(response, 200, await getHiddenNoiseCleanup());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/gmail/hidden-noise/trash") {
        const payload = await readBody(request);
        const result = await trashHiddenNoiseThreads({
          threadIds: payload.threadIds ?? [],
          confirm: payload.confirm === true
        });
        json(response, result.ok ? 200 : 207, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/business-card/status") {
        json(response, 200, {
          ...businessCardVisionStatus(await loadLocalOpenAiConfig()),
          source: "local"
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/review-action") {
        const action = await loadLocalReviewActionForRequest(url);
        json(response, 200, { ok: true, action });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/review-action/copy-documents") {
        const payload = await readBody(request);
        const rawAction = await loadRawLocalReviewAction({
          reviewActionId: payload.reviewActionId || payload.id || "",
          token: payload.token || ""
        });
        const result = await copyReviewPacketPdfDocuments({
          reviewAction: rawAction,
          gmailConfig: await loadLocalGmailConfig()
        });

        json(response, 200, {
          ...result,
          reviewActionId: rawAction.id
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/review-action/open-pdfs") {
        const payload = await readBody(request);
        const rawAction = await loadRawLocalReviewAction({
          reviewActionId: payload.reviewActionId || payload.id || "",
          token: payload.token || ""
        });
        const result = await openReviewPacketPdfDocuments({
          reviewAction: rawAction,
          gmailConfig: await loadLocalGmailConfig()
        });

        json(response, 200, {
          ...result,
          reviewActionId: rawAction.id
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/product-document/extract") {
        const payload = await readBody(request);
        const fileName = payload.fileName || payload.name || "document.pdf";
        const mimeType = payload.mimeType || "application/pdf";
        const base64 = base64FromPayload(payload);
        const warnings = [];

        if (!base64) {
          json(response, 400, {
            ok: false,
            fileName,
            text: "",
            fields: {},
            aiDerivedFields: [],
            warnings: ["No PDF data was received."]
          });
          return;
        }

        let text = "";
        let method = "local_pdf_text";

        try {
          text = extractPdfText(Buffer.from(base64, "base64"));
        } catch (error) {
          warnings.push(`Local PDF text extraction failed: ${error instanceof Error ? error.message : String(error)}`);
        }

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
            config: await loadLocalOpenAiConfig()
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
          responseText || usefulFieldsFound ? "" : "No readable PDF text or structured ShelfCycle fields were found. If this is a scanned PDF, confirm OpenAI vision/document extraction is configured."
        ].filter(Boolean);

        json(response, responseText || usefulFieldsFound ? 200 : 422, {
          ok: Boolean(responseText || usefulFieldsFound),
          fileName,
          mimeType,
          text: responseText,
          method,
          fields: aiResult.fields ?? {},
          aiDerivedFields: aiResult.aiDerivedFields ?? [],
          missingShelfCycleFields: aiResult.missingShelfCycleFields ?? [],
          shelfCycleNotes: aiResult.shelfCycleNotes ?? [],
          warnings: combinedWarnings
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/analyze") {
        const payload = await readBody(request);
        const workflowRunId = `intake-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        await createWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, {
          id: workflowRunId,
          type: payload.workflow === "new_product" ? "product_intake" : "intake_analysis",
          mode: "manual",
          title: payload.workflow === "new_product" ? "SDS/TDS product intake" : "ClearEdge intake analysis",
          metadata: {
            requestedWorkflow: payload.workflow || "auto",
            inputLength: String(payload.text || "").length
          },
          steps: [
            { id: "receive_input", label: "Receive pasted or uploaded input", status: WORKFLOW_STEP_STATUS.SUCCEEDED },
            { id: "analyze_intake", label: "Classify and parse intake text", status: WORKFLOW_STEP_STATUS.RUNNING },
            { id: "match_knowledge", label: "Match against ClearEdge knowledge" },
            { id: "draft_actions", label: "Prepare review-only drafts and actions" },
            { id: "approval_wait", label: "Wait for human approval before ShelfCycle write", status: WORKFLOW_STEP_STATUS.WAITING }
          ]
        }).catch(() => {});

        try {
          const referenceData = await mergeProjectIntelligence(payload.referenceData ?? {});
          const inputBody = String(payload.text || "");
          let result = analyzeInput({
            ...payload,
            text: inputBody,
            referenceData
          });

          if (result.workflow === "new_product") {
            const openAiConfig = await loadLocalOpenAiConfig();
            const productAiConfig = resolveProductDocumentAiConfig(openAiConfig);
            const productDocument = payload.productDocument ?? {};
            const baseProductResult = hasUsefulProductDocumentFields(productDocument.fields)
              ? mergeProductDocumentExtractionIntoResult(result, productDocument)
              : result;
            const refinedResult = productAiConfig.enabled
              ? await refineProductDocumentWithAi({
                text: inputBody,
                result: baseProductResult,
                config: openAiConfig
              })
              : {
                ...baseProductResult,
                warnings: uniqueStrings([
                  ...(baseProductResult.warnings ?? []),
                  "OpenAI product-document parsing is not configured. Only basic local text parsing ran, so review all ShelfCycle product fields manually."
                ])
              };
            const aiLines = productAiLines(refinedResult.aiDerivedFields ?? [], refinedResult.fields ?? {});

            if (aiLines.length) {
              const rerun = analyzeInput({
                ...payload,
                text: [inputBody, "AI-derived ShelfCycle fields:", aiLines.join("\n")].filter(Boolean).join("\n\n"),
                referenceData
              });

              result = {
                ...rerun,
                fields: {
                  ...(rerun.fields ?? {}),
                  ...(refinedResult.fields ?? {})
                },
                aiDerivedFields: refinedResult.aiDerivedFields ?? [],
                missingShelfCycleFields: refinedResult.missingShelfCycleFields ?? [],
                shelfCycleNotes: refinedResult.shelfCycleNotes ?? [],
                warnings: uniqueStrings([
                  ...(rerun.warnings ?? []),
                  ...(refinedResult.warnings ?? [])
                ])
              };
            } else {
              result = refinedResult;
            }

            result = withUpdatedProductWritePlan(result);
          }

          let reviewAction = null;

          if (result.workflow === "new_product") {
            reviewAction = createReviewActionRecord({
              workflow: "new_product",
              subject: productIntakeSubject(result),
              summary: "Review this SDS/TDS product intake before any ShelfCycle product create or update.",
              analysis: result,
              state: {
                status: ACTION_STATE.WAITING_APPROVAL,
                needsReply: false,
                waiting: false
              },
              workspaceArtifacts: {
                attachments: (payload.files ?? []).map((file) => ({
                  filename: file.fileName || file.name || "",
                  mimeType: file.mimeType || file.type || "",
                  size: file.size || 0
                })),
                driveFileIds: [],
                driveFiles: [],
                driveScopeAvailable: true,
                driveError: ""
              }
            });
            const urls = productIntakeReviewUrls(url, reviewAction, request.headers.host || "");
            reviewAction.reviewUrl = urls.reviewUrl;
            reviewAction.submitUrl = urls.submitUrl;
            await saveLocalReviewAction(LOCAL_REVIEW_ACTIONS_DIR, reviewAction);
          }

          await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "analyze_intake", {
            status: WORKFLOW_STEP_STATUS.SUCCEEDED,
            detail: `${result.workflow} (${Math.round((result.confidence ?? 0) * 100)}%)`
          }).catch(() => {});
          await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "match_knowledge", {
            status: WORKFLOW_STEP_STATUS.SUCCEEDED,
            detail: result.intelligenceContext?.status || "knowledge match complete",
            runMetrics: {
              warnings: result.warnings?.length ?? 0,
              suggestedCreates: result.suggestedCreates?.length ?? 0
            }
          }).catch(() => {});
          await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "draft_actions", {
            status: WORKFLOW_STEP_STATUS.SUCCEEDED,
            detail: reviewAction
              ? `Review packet created with ${reviewAction.proposedActions?.length ?? 0} proposed ShelfCycle action(s). No ShelfCycle write performed.`
              : "Drafts prepared for review. No ShelfCycle write performed.",
            actionState: ACTION_STATE.WAITING_APPROVAL
          }).catch(() => {});
          await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "approval_wait", {
            status: WORKFLOW_STEP_STATUS.WAITING,
            detail: "Human approval is required before any ShelfCycle write.",
            runStatus: WORKFLOW_STATUS.WAITING_APPROVAL,
            actionState: ACTION_STATE.WAITING_APPROVAL
          }).catch(() => {});
          const workflowRun = await loadWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId);
          json(response, 200, {
            ...result,
            reviewAction: reviewAction ? sanitizeReviewAction(reviewAction) : null,
            reviewUrl: reviewAction?.reviewUrl || "",
            submitUrl: reviewAction?.submitUrl || "",
            proposedActions: reviewAction?.proposedActions ?? [],
            executableActions: reviewAction?.executableActions ?? [],
            workflowRunId,
            workflowRun
          });
        } catch (error) {
          await failWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, error, {
            stepId: "analyze_intake"
          }).catch(() => {});
          throw error;
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/import-csv") {
        const payload = await readBody(request);
        const result = importCsv(payload);
        json(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/export-knowledge") {
        const payload = await readBody(request);
        const result = createKnowledgeBundle({
          ...payload,
          referenceData: await mergeProjectIntelligence(payload.referenceData ?? {})
        });
        json(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/load-review-action") {
        const payload = await readBody(request);
        const action = payload.action ?? (await fetchReviewAction(payload.reviewUrl));
        json(response, 200, { ok: true, action: enrichReviewActionForResponse(action) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/shelfcycle/open-session") {
        const payload = await readBody(request);
        const action = payload.action ?? (payload.reviewUrl ? await fetchReviewAction(payload.reviewUrl) : null);
        const target = action ? getNoteSubmissionTarget(action) : null;
        runDetachedLoginWindow(target?.url ?? "");
        json(response, 200, {
          ok: true,
          message: target
            ? `A local ShelfCycle browser window has been opened to ${target.customerName || "the matched customer"} notes. Log in if prompted, then return here.`
            : "A local ShelfCycle browser window has been opened. Log in if prompted, then return here.",
          submission: target
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/shelfcycle/note-target") {
        const payload = await readBody(request);
        const action = payload.action ?? (payload.reviewUrl ? await fetchReviewAction(payload.reviewUrl) : null);

        if (!action) {
          throw new Error("Missing review action.");
        }

        json(response, 200, {
          ok: true,
          submission: getNoteSubmissionTarget(action)
        });
        return;
      }

      if (request.method === "POST" && (url.pathname === "/api/customer/research" || url.pathname === "/api/company/research")) {
        const payload = await readBody(request);
        let rawAction = payload.action ?? null;

        if (!rawAction && payload.reviewActionId && payload.token) {
          rawAction = await loadRawLocalReviewAction({
            reviewActionId: payload.reviewActionId,
            token: payload.token
          });
        }

        const actionType = payload.actionType || SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE;
        const recordType = actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE || payload.recordType === "supplier"
          ? "supplier"
          : "customer";
        const proposedAction = rawAction
          ? findProposedAction(rawAction, {
            actionId: payload.actionId || "",
            actionType,
            fields: payload.fields ?? {}
          }) ?? collectProposedActions(rawAction, { fields: payload.fields ?? {} }).find((item) =>
            item.actionType === (recordType === "supplier" ? SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE : SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE)
          )
          : null;
        const fields = {
          ...(proposedAction?.fieldValues ?? {}),
          ...(payload.fields ?? {})
        };
        const research = await researchCompanyPublicInfo({
          reviewAction: rawAction ?? {},
          fields,
          recordType,
          config: await loadLocalOpenAiConfig()
        });

        if (!research.ok) {
          json(response, 400, research);
          return;
        }

        json(response, 200, {
          ok: true,
          actionId: proposedAction?.id || payload.actionId || "",
          actionType: recordType === "supplier" ? SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE : SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE,
          recordType,
          research,
          requirements: recordType === "supplier"
            ? supplierRequirementsForFields(research.fields)
            : customerRequirementsForFields(research.fields)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/business-card/scan") {
        const payload = await readBody(request);
        const workflowRunId = `business-card-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        const baseUrl = `${request.headers["x-forwarded-proto"] || "http"}://${request.headers.host || "localhost:4318"}`;

        await createWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, {
          id: workflowRunId,
          type: "business_card_intake",
          mode: "manual",
          title: "Business card ShelfCycle intake",
          metadata: {
            relationshipHint: payload.relationshipHint || "auto",
            entryMode: payload.entryMode || "auto",
            existingCompanyLabel: payload.existingCompanyLabel || "",
            hasImage: Boolean(payload.imageDataUrl),
            textLength: String(payload.text || "").length
          },
          steps: [
            { id: "receive_input", label: "Receive business-card image or text", status: WORKFLOW_STEP_STATUS.SUCCEEDED },
            { id: "extract_card", label: "Extract card fields and optional public web info", status: WORKFLOW_STEP_STATUS.RUNNING },
            { id: "match_knowledge", label: "Match company/contact against ShelfCycle knowledge" },
            { id: "draft_actions", label: "Prepare approval-first ShelfCycle actions" },
            { id: "approval_wait", label: "Wait for human approval before ShelfCycle write", status: WORKFLOW_STEP_STATUS.WAITING }
          ]
        }).catch(() => {});

        try {
          const analysis = await analyzeBusinessCard({
            imageDataUrl: payload.imageDataUrl || "",
            text: payload.text || "",
            relationshipHint: payload.relationshipHint || "auto",
            entryMode: payload.entryMode || "auto",
            existingCompanyLabel: payload.existingCompanyLabel || "",
            useWebResearch: payload.useWebResearch !== false,
            config: await loadLocalOpenAiConfig(),
            referenceData: {
              ...(await loadLocalKnowledgeBundle()),
              ...(payload.referenceData ?? {})
            }
          });

          if (!analysis.ok) {
            await failWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, analysis.message || "Business-card scan failed.", {
              stepId: "extract_card"
            }).catch(() => {});
            json(response, 400, {
              ...analysis,
              workflowRunId
            });
            return;
          }

          const action = createBusinessCardReviewAction({
            analysis,
            baseUrl
          });
          await saveLocalReviewAction(LOCAL_REVIEW_ACTIONS_DIR, action);
          await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "extract_card", {
            status: WORKFLOW_STEP_STATUS.SUCCEEDED,
            detail: `${action.fields.personName || "Contact"} / ${action.fields.companyName || "Company"}`
          }).catch(() => {});
          await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "match_knowledge", {
            status: WORKFLOW_STEP_STATUS.SUCCEEDED,
            detail: `${analysis.matches?.customer?.length ?? 0} customer, ${analysis.matches?.supplier?.length ?? 0} supplier, ${analysis.matches?.contacts?.length ?? 0} contact match(es).`
          }).catch(() => {});
          await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "draft_actions", {
            status: WORKFLOW_STEP_STATUS.SUCCEEDED,
            detail: `${action.proposedActions?.length ?? 0} proposed ShelfCycle action(s).`,
            actionState: ACTION_STATE.WAITING_APPROVAL
          }).catch(() => {});
          await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "approval_wait", {
            status: WORKFLOW_STEP_STATUS.WAITING,
            detail: "Review packet created. Human approval is required before any ShelfCycle write.",
            runStatus: WORKFLOW_STATUS.WAITING_APPROVAL,
            actionState: ACTION_STATE.WAITING_APPROVAL
          }).catch(() => {});
          const workflowRun = await loadWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId);

          json(response, 200, {
            ok: true,
            workflowRunId,
            workflowRun,
            analysis,
            action: sanitizeReviewAction(action),
            reviewUrl: action.reviewUrl,
            submitUrl: action.submitUrl
          });
        } catch (error) {
          await failWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, error, {
            stepId: "extract_card"
          }).catch(() => {});
          throw error;
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/shelfcycle/submit-action") {
        const payload = await readBody(request);
        const reviewActionId = payload.reviewActionId || "";
        const actionId = payload.actionId || "";
        const actionType = payload.actionType || "";
        const workflowRunId = `shelfcycle-submit-${new Date().toISOString().replace(/[:.]/g, "-")}`;

        await createWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, {
          id: workflowRunId,
          type: "shelfcycle_action",
          mode: "manual-approval",
          title: `ShelfCycle ${actionType || "action"} approval`,
          actionState: payload.approvedByUser === true ? ACTION_STATE.RUNNING : ACTION_STATE.WAITING_APPROVAL,
          metadata: {
            reviewActionId,
            actionId,
            actionType
          },
          approval: {
            approvedByUser: payload.approvedByUser === true,
            approvedAt: payload.approvedByUser === true ? new Date().toISOString() : ""
          },
          steps: SHELFCYCLE_APPROVAL_WORKFLOW_STEPS
        }).catch(() => {});

        if (payload.approvedByUser !== true) {
          await failWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "Explicit user approval is required before writing to ShelfCycle.", {
            stepId: "approval_wait"
          }).catch(() => {});
          json(response, 400, errorResponse({
            reviewActionId,
            actionId,
            actionType,
            workflowRunId,
            code: SHELFCYCLE_ERROR_CODES.APPROVAL_REQUIRED,
            message: "Explicit user approval is required before writing to ShelfCycle."
          }));
          return;
        }

        await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "load_review", {
          status: WORKFLOW_STEP_STATUS.RUNNING,
          detail: "Loading local review packet and validating token."
        }).catch(() => {});
        let rawAction = null;

        try {
          rawAction = await loadRawLocalReviewAction({
            reviewActionId,
            token: payload.token || ""
          });
        } catch (error) {
          await failWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, error, {
            stepId: "load_review"
          }).catch(() => {});
          json(response, error.statusCode ?? 400, errorResponse({
            reviewActionId,
            actionId,
            actionType,
            workflowRunId,
            code: error.code || SHELFCYCLE_ERROR_CODES.INVALID_REVIEW_ACTION,
            message: error instanceof Error ? error.message : "Review action could not be loaded."
          }));
          return;
        }

        await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "load_review", {
          status: WORKFLOW_STEP_STATUS.SUCCEEDED,
          detail: rawAction.subject || reviewActionId
        }).catch(() => {});
        await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "validate_action", {
          status: WORKFLOW_STEP_STATUS.RUNNING,
          detail: "Rebuilding proposed ShelfCycle action from the review packet."
        }).catch(() => {});
        const proposedAction = findProposedAction(rawAction, {
          actionId,
          actionType,
          selectedTarget: payload.selectedTarget ?? null,
          fields: payload.fields ?? {}
        });

        if (!proposedAction) {
          await failWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "Requested ShelfCycle action was not found on this review packet.", {
            stepId: "validate_action"
          }).catch(() => {});
          json(response, 400, errorResponse({
            reviewActionId,
            actionId,
            actionType,
            workflowRunId,
            code: SHELFCYCLE_ERROR_CODES.INVALID_REVIEW_ACTION,
            message: "Requested ShelfCycle action was not found on this review packet."
          }));
          return;
        }

        if (proposedAction.requiredFields?.includes("selectedTarget.id") && !proposedAction.selectedTarget?.id) {
          await failWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "Select a ShelfCycle customer or supplier before submitting.", {
            stepId: "validate_action"
          }).catch(() => {});
          json(response, 400, errorResponse({
            reviewActionId,
            actionId,
            actionType,
            workflowRunId,
            code: SHELFCYCLE_ERROR_CODES.MISSING_TARGET,
            message: "Select a ShelfCycle customer or supplier before submitting.",
            warnings: proposedAction.warnings
          }));
          return;
        }

        if (proposedAction.requiredFields?.includes("selectedTarget.label") && !proposedAction.selectedTarget?.label) {
          await failWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "Select a ShelfCycle customer or supplier before submitting.", {
            stepId: "validate_action"
          }).catch(() => {});
          json(response, 400, errorResponse({
            reviewActionId,
            actionId,
            actionType,
            workflowRunId,
            code: SHELFCYCLE_ERROR_CODES.MISSING_TARGET,
            message: "Select a ShelfCycle customer or supplier before submitting.",
            warnings: proposedAction.warnings
          }));
          return;
        }

        if (proposedAction.requiredFields?.includes("fields.note") && !proposedAction.fieldValues?.note) {
          await failWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "A customer note body is required before submitting.", {
            stepId: "validate_action"
          }).catch(() => {});
          json(response, 400, errorResponse({
            reviewActionId,
            actionId,
            actionType,
            workflowRunId,
            code: SHELFCYCLE_ERROR_CODES.MISSING_REQUIRED_FIELDS,
            message: "A customer note body is required before submitting.",
            warnings: proposedAction.warnings
          }));
          return;
        }

        if (proposedAction.requiredFields?.includes("fields.name") && !proposedAction.fieldValues?.name) {
          await failWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "A ShelfCycle name is required before submitting.", {
            stepId: "validate_action"
          }).catch(() => {});
          json(response, 400, errorResponse({
            reviewActionId,
            actionId,
            actionType,
            workflowRunId,
            code: SHELFCYCLE_ERROR_CODES.MISSING_REQUIRED_FIELDS,
            message: "A ShelfCycle name is required before submitting.",
            warnings: proposedAction.warnings
          }));
          return;
        }

        if (proposedAction.requiredFields?.includes("fields.title") && !proposedAction.fieldValues?.title) {
          await failWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "A contact title is required before submitting.", {
            stepId: "validate_action"
          }).catch(() => {});
          json(response, 400, errorResponse({
            reviewActionId,
            actionId,
            actionType,
            workflowRunId,
            code: SHELFCYCLE_ERROR_CODES.MISSING_REQUIRED_FIELDS,
            message: "A contact title is required before submitting.",
            warnings: proposedAction.warnings
          }));
          return;
        }

        if (!proposedAction.executable) {
          await failWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, proposedAction.warnings[0] || "This ShelfCycle action is not executable yet.", {
            stepId: "validate_action"
          }).catch(() => {});
          json(response, 400, errorResponse({
            reviewActionId,
            actionId,
            actionType,
            workflowRunId,
            code: proposedAction.warnings.some((warning) => /low-confidence/i.test(warning))
              ? SHELFCYCLE_ERROR_CODES.LOW_CONFIDENCE_TARGET
              : SHELFCYCLE_ERROR_CODES.NOT_EXECUTABLE,
            message: proposedAction.warnings[0] || "This ShelfCycle action is not executable yet.",
            warnings: proposedAction.warnings
          }));
          return;
        }

        try {
          await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "validate_action", {
            status: WORKFLOW_STEP_STATUS.SUCCEEDED,
            detail: `${proposedAction.displayLabel || proposedAction.actionType} is executable.`,
            actionState: ACTION_STATE.READY_FOR_APPROVAL
          }).catch(() => {});
          await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "approval_wait", {
            status: WORKFLOW_STEP_STATUS.SUCCEEDED,
            detail: "Human approval received.",
            actionState: ACTION_STATE.RUNNING
          }).catch(() => {});
          if (payload.selectedTarget?.id || payload.selectedTarget?.label) {
            await saveLocalReviewAction(LOCAL_REVIEW_ACTIONS_DIR, {
              ...rawAction,
              selectedTargets: {
                ...(rawAction.selectedTargets ?? {}),
                [proposedAction.id]: proposedAction.selectedTarget
              }
            });
          }

          await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "shelfcycle_submit", {
            status: WORKFLOW_STEP_STATUS.RUNNING,
            detail: `Submitting ${proposedAction.displayLabel || proposedAction.actionType} to ShelfCycle.`
          }).catch(() => {});
          const result = await executeApprovedShelfCycleAction({
            reviewAction: rawAction,
            proposedAction,
            automationRunnerPath: AUTOMATION_RUNNER_PATH,
            cwd: projectRoot
          });
          await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "shelfcycle_submit", {
            status: WORKFLOW_STEP_STATUS.SUCCEEDED,
            detail: result.message || "ShelfCycle action submitted.",
            runMetrics: {
              submittedActions: 1,
              mentionLinksAttempted: result.mentionResults?.length ?? 0,
              mentionLinksCreated: (result.mentionResults ?? []).filter((item) => item.status === "linked").length
            },
            artifacts: {
              shelfcycleUrl: result.shelfcycleUrl || "",
              mentionResults: result.mentionResults ?? []
            }
          }).catch(() => {});
          await updateWorkflowStep(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, "result_log", {
            status: WORKFLOW_STEP_STATUS.SUCCEEDED,
            detail: "ShelfCycle submission result recorded.",
            actionState: ACTION_STATE.SUBMITTED
          }).catch(() => {});
          await finishWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, {
            metrics: {
              submittedActions: 1,
              failedActions: 0
            },
            artifacts: {
              shelfcycleUrl: result.shelfcycleUrl || "",
              mentionResults: result.mentionResults ?? []
            }
          }).catch(() => {});
          json(response, 200, {
            ok: true,
            reviewActionId,
            actionId,
            actionType,
            workflowRunId,
            target: proposedAction.selectedTarget,
            mentionResults: result.mentionResults ?? [],
            result
          });
        } catch (error) {
          await failWorkflowRun(LOCAL_WORKFLOW_RUNS_DIR, workflowRunId, error, {
            stepId: "shelfcycle_submit"
          }).catch(() => {});
          json(response, 500, errorResponse({
            reviewActionId,
            actionId,
            actionType,
            workflowRunId,
            code: SHELFCYCLE_ERROR_CODES.SHELFCYCLE_SUBMIT_FAILED,
            message: error instanceof Error ? error.message : "ShelfCycle submission failed.",
            warnings: proposedAction.warnings
          }));
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/shelfcycle/create-note") {
        json(response, 400, errorResponse({
          actionType: SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE,
          code: SHELFCYCLE_ERROR_CODES.APPROVAL_REQUIRED,
          message: "Use /api/shelfcycle/submit-action with reviewActionId, token, actionId, and approvedByUser=true."
        }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/daily-brief/request") {
        const payload = await readBody(request);
        const result = await requestLocalDailyBrief(payload);
        json(response, result.ok === false ? 409 : 200, { ok: result.ok !== false, result });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/daily-brief/run") {
        const payload = await readBody(request);
        const result = await requestLocalDailyBrief(payload);
        json(response, result.ok === false ? 409 : 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/daily-brief/exclusions") {
        const payload = await readBody(request);
        const control = await loadBriefControl(LOCAL_BRIEF_CONTROL_PATH);
        const nextControl = addExclusion(control, payload);
        await saveBriefControl(LOCAL_BRIEF_CONTROL_PATH, nextControl);
        json(response, 200, {
          ok: true,
          control: nextControl
        });
        return;
      }

      response.writeHead(404, {
        "content-type": "text/plain; charset=utf-8",
        ...CORS_HEADERS
      });
      response.end("Not found");
    } catch (error) {
      json(response, error.statusCode ?? 500, {
        error: error instanceof Error ? error.message : "Unexpected server error"
      });
    }
  });
}

export function startServer({ port = 4318 } = {}) {
  const server = createServer();

  server.listen(port, () => {
    console.log(`ShelfCycle MVP listening on http://localhost:${port}`);
  });

  return server;
}
