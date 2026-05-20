import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const WORKFLOW_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  WAITING_APPROVAL: "waiting_approval",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled"
});

export const WORKFLOW_STEP_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  WAITING: "waiting",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SKIPPED: "skipped"
});

export const ACTION_STATE = Object.freeze({
  PREVIEW_ONLY: "preview_only",
  NEEDS_TARGET: "needs_target",
  READY_FOR_APPROVAL: "ready_for_approval",
  WAITING_APPROVAL: "waiting_approval",
  RUNNING: "running",
  MANUAL_ASSIST: "manual_assist",
  DRY_RUN: "dry_run",
  SUBMITTED: "submitted",
  CANCELLED: "cancelled",
  FAILED: "failed"
});

export const DAILY_BRIEF_WORKFLOW_STEPS = Object.freeze([
  { id: "config", label: "Load settings and knowledge" },
  { id: "messages_ingest", label: "Read Mac Messages memory" },
  { id: "gmail_fetch", label: "Fetch Gmail activity" },
  { id: "workspace_artifacts", label: "Inspect attachments and Workspace links" },
  { id: "triage", label: "Classify and triage communications" },
  { id: "ai_refine", label: "Refine owner-read summaries" },
  { id: "review_generate", label: "Generate review packets" },
  { id: "brief_build", label: "Build action dashboard brief" },
  { id: "email_send", label: "Send or save brief" }
]);

export const SHELFCYCLE_APPROVAL_WORKFLOW_STEPS = Object.freeze([
  { id: "load_review", label: "Load review packet" },
  { id: "validate_action", label: "Validate approved action" },
  { id: "approval_wait", label: "Confirm human approval" },
  { id: "shelfcycle_submit", label: "Submit to ShelfCycle" },
  { id: "result_log", label: "Log result" }
]);

const PHASE_TO_DAILY_STEP = Object.freeze({
  starting: "config",
  config: "config",
  loading_knowledge: "config",
  messages: "messages_ingest",
  gmail_profile: "gmail_fetch",
  gmail_fetch: "gmail_fetch",
  workspace_artifacts: "workspace_artifacts",
  classify: "triage",
  ai_refine: "ai_refine",
  review_links: "review_generate",
  build_brief: "brief_build",
  send_email: "email_send",
  complete: "email_send",
  finished: "email_send"
});

export function dailyBriefStepIdForPhase(phase = "") {
  return PHASE_TO_DAILY_STEP[phase] || phase || "";
}

function nowIso() {
  return new Date().toISOString();
}

export function workflowRunId(prefix = "run", date = new Date()) {
  return `${prefix}-${date.toISOString().replace(/[:.]/g, "-")}`;
}

function safeFileName(id = "") {
  return String(id || "workflow-run").replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function runPath(storageDir, runId) {
  return path.join(storageDir, `${safeFileName(runId)}.json`);
}

function normalizeStep(step = {}) {
  return {
    id: step.id,
    label: step.label || step.id,
    status: step.status || WORKFLOW_STEP_STATUS.PENDING,
    startedAt: step.startedAt || "",
    finishedAt: step.finishedAt || "",
    updatedAt: step.updatedAt || "",
    detail: step.detail || "",
    metrics: step.metrics ?? {},
    error: step.error || ""
  };
}

function normalizeRun(run = {}) {
  const timestamp = nowIso();

  return {
    id: run.id || workflowRunId(run.type || "workflow", new Date(timestamp)),
    type: run.type || "workflow",
    mode: run.mode || "manual",
    title: run.title || "Workflow run",
    status: run.status || WORKFLOW_STATUS.QUEUED,
    actionState: run.actionState || "",
    createdAt: run.createdAt || timestamp,
    startedAt: run.startedAt || "",
    updatedAt: run.updatedAt || timestamp,
    finishedAt: run.finishedAt || "",
    currentStepId: run.currentStepId || "",
    metadata: run.metadata ?? {},
    metrics: run.metrics ?? {},
    artifacts: run.artifacts ?? {},
    approval: run.approval ?? null,
    error: run.error || "",
    steps: (run.steps ?? []).map(normalizeStep),
    logs: run.logs ?? []
  };
}

async function writeRun(storageDir, run) {
  await mkdir(storageDir, { recursive: true });
  const normalized = normalizeRun(run);
  await writeFile(runPath(storageDir, normalized.id), JSON.stringify(normalized, null, 2), "utf8");
  await writeFile(path.join(storageDir, "latest.json"), JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

export async function createWorkflowRun(storageDir, run = {}) {
  const timestamp = nowIso();
  const normalized = normalizeRun({
    ...run,
    status: run.status || WORKFLOW_STATUS.RUNNING,
    startedAt: run.startedAt || timestamp,
    updatedAt: timestamp,
    steps: (run.steps ?? []).map((step) => normalizeStep(step))
  });

  return writeRun(storageDir, {
    ...normalized,
    logs: [
      ...(normalized.logs ?? []),
      {
        at: timestamp,
        level: "info",
        message: "Workflow run created."
      }
    ]
  });
}

export async function loadWorkflowRun(storageDir, runId) {
  try {
    return normalizeRun(JSON.parse(await readFile(runPath(storageDir, runId), "utf8")));
  } catch {
    return null;
  }
}

export async function loadLatestWorkflowRun(storageDir) {
  try {
    return normalizeRun(JSON.parse(await readFile(path.join(storageDir, "latest.json"), "utf8")));
  } catch {
    return null;
  }
}

export async function listWorkflowRuns(storageDir, { limit = 20, type = "" } = {}) {
  try {
    const entries = await readdir(storageDir, { withFileTypes: true });
    const runs = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "latest.json") {
        continue;
      }

      const run = await loadWorkflowRun(storageDir, entry.name.replace(/\.json$/i, ""));

      if (!run || (type && run.type !== type)) {
        continue;
      }

      runs.push(run);
    }

    return runs
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function appendWorkflowLog(storageDir, runId, { level = "info", message = "", detail = null } = {}) {
  const run = await loadWorkflowRun(storageDir, runId);

  if (!run) {
    return null;
  }

  return writeRun(storageDir, {
    ...run,
    updatedAt: nowIso(),
    logs: [
      ...(run.logs ?? []),
      {
        at: nowIso(),
        level,
        message,
        ...(detail ? { detail } : {})
      }
    ].slice(-250)
  });
}

export async function updateWorkflowStep(storageDir, runId, stepId, patch = {}) {
  const run = await loadWorkflowRun(storageDir, runId);

  if (!run) {
    return null;
  }

  const timestamp = nowIso();
  const steps = run.steps.map((step) => {
    if (step.id !== stepId) {
      return step;
    }

    const status = patch.status || step.status;
    return {
      ...step,
      ...patch,
      status,
      startedAt: step.startedAt || (status === WORKFLOW_STEP_STATUS.RUNNING ? timestamp : ""),
      finishedAt: [WORKFLOW_STEP_STATUS.SUCCEEDED, WORKFLOW_STEP_STATUS.FAILED, WORKFLOW_STEP_STATUS.SKIPPED].includes(status)
        ? patch.finishedAt || timestamp
        : patch.finishedAt || step.finishedAt || "",
      updatedAt: timestamp
    };
  });

  return writeRun(storageDir, {
    ...run,
    status: patch.runStatus || run.status,
    actionState: patch.actionState ?? run.actionState,
    updatedAt: timestamp,
    currentStepId: stepId,
    metrics: {
      ...(run.metrics ?? {}),
      ...(patch.runMetrics ?? {})
    },
    artifacts: {
      ...(run.artifacts ?? {}),
      ...(patch.artifacts ?? {})
    },
    steps
  });
}

export async function updateDailyBriefWorkflowFromPhase(storageDir, runId, phase, detail = {}) {
  const stepId = dailyBriefStepIdForPhase(phase);
  const run = await loadWorkflowRun(storageDir, runId);

  if (!run) {
    return null;
  }

  const stepIds = run.steps.map((step) => step.id);
  const stepIndex = stepIds.indexOf(stepId);
  let nextRun = run;

  for (let index = 0; index < stepIndex; index += 1) {
    const step = nextRun.steps[index];

    if ([WORKFLOW_STEP_STATUS.PENDING, WORKFLOW_STEP_STATUS.RUNNING].includes(step.status)) {
      nextRun = await updateWorkflowStep(storageDir, runId, step.id, {
        status: WORKFLOW_STEP_STATUS.SUCCEEDED
      }) ?? nextRun;
    }
  }

  return updateWorkflowStep(storageDir, runId, stepId, {
    status: WORKFLOW_STEP_STATUS.RUNNING,
    detail: detail.label || "",
    runMetrics: {
      ...(detail.emailThreads !== undefined ? { emailThreads: detail.emailThreads } : {}),
      ...(detail.analyzedThreads !== undefined ? { analyzedThreads: detail.analyzedThreads } : {}),
      ...(detail.sent !== undefined ? { sent: detail.sent } : {})
    }
  });
}

export async function finishWorkflowRun(storageDir, runId, { metrics = {}, artifacts = {}, status = WORKFLOW_STATUS.SUCCEEDED } = {}) {
  const run = await loadWorkflowRun(storageDir, runId);

  if (!run) {
    return null;
  }

  const timestamp = nowIso();
  const steps = run.steps.map((step) => {
    if ([WORKFLOW_STEP_STATUS.SUCCEEDED, WORKFLOW_STEP_STATUS.FAILED, WORKFLOW_STEP_STATUS.SKIPPED].includes(step.status)) {
      return step;
    }

    return {
      ...step,
      status: WORKFLOW_STEP_STATUS.SUCCEEDED,
      startedAt: step.startedAt || timestamp,
      finishedAt: step.finishedAt || timestamp,
      updatedAt: timestamp
    };
  });

  return writeRun(storageDir, {
    ...run,
    status,
    actionState: status === WORKFLOW_STATUS.SUCCEEDED && run.actionState === ACTION_STATE.RUNNING
      ? ACTION_STATE.SUBMITTED
      : run.actionState,
    updatedAt: timestamp,
    finishedAt: timestamp,
    metrics: {
      ...(run.metrics ?? {}),
      ...metrics
    },
    artifacts: {
      ...(run.artifacts ?? {}),
      ...artifacts
    },
    steps,
    logs: [
      ...(run.logs ?? []),
      {
        at: timestamp,
        level: "info",
        message: "Workflow run finished."
      }
    ].slice(-250)
  });
}

export async function failWorkflowRun(storageDir, runId, error, { stepId = "" } = {}) {
  const run = await loadWorkflowRun(storageDir, runId);

  if (!run) {
    return null;
  }

  const timestamp = nowIso();
  const message = error instanceof Error ? error.message : String(error || "Workflow failed.");

  return writeRun(storageDir, {
    ...run,
    status: WORKFLOW_STATUS.FAILED,
    actionState: [ACTION_STATE.RUNNING, ACTION_STATE.MANUAL_ASSIST].includes(run.actionState)
      ? ACTION_STATE.FAILED
      : run.actionState,
    updatedAt: timestamp,
    finishedAt: timestamp,
    currentStepId: stepId || run.currentStepId,
    error: message,
    steps: run.steps.map((step) => step.id === (stepId || run.currentStepId)
      ? {
        ...step,
        status: WORKFLOW_STEP_STATUS.FAILED,
        finishedAt: timestamp,
        updatedAt: timestamp,
        error: message
      }
      : step),
    logs: [
      ...(run.logs ?? []),
      {
        at: timestamp,
        level: "error",
        message
      }
    ].slice(-250)
  });
}

export async function cancelWorkflowRun(storageDir, runId, { stepId = "", message = "Workflow run cancelled by user." } = {}) {
  const run = await loadWorkflowRun(storageDir, runId);

  if (!run) {
    return null;
  }

  const timestamp = nowIso();
  const activeStepId = stepId || run.currentStepId;

  return writeRun(storageDir, {
    ...run,
    status: WORKFLOW_STATUS.CANCELLED,
    actionState: ACTION_STATE.CANCELLED,
    updatedAt: timestamp,
    finishedAt: timestamp,
    currentStepId: activeStepId,
    artifacts: {
      ...(run.artifacts ?? {}),
      manualAssist: {
        ...(run.artifacts?.manualAssist ?? {}),
        requested: false,
        active: false,
        cancelledAt: timestamp,
        message
      }
    },
    steps: run.steps.map((step) => step.id === activeStepId
      ? {
        ...step,
        status: WORKFLOW_STEP_STATUS.SKIPPED,
        detail: message,
        finishedAt: timestamp,
        updatedAt: timestamp
      }
      : step),
    logs: [
      ...(run.logs ?? []),
      {
        at: timestamp,
        level: "info",
        message
      }
    ].slice(-250)
  });
}

export function actionContractForProposedAction(action = {}) {
  const warnings = action.warnings ?? [];
  const requiresTarget = warnings.some((warning) => /target|customer|supplier|product/i.test(warning));

  return {
    actionId: action.id || "",
    actionType: action.actionType || "",
    displayLabel: action.displayLabel || action.actionType || "ShelfCycle action",
    state: action.executable
      ? ACTION_STATE.READY_FOR_APPROVAL
      : requiresTarget
        ? ACTION_STATE.NEEDS_TARGET
        : ACTION_STATE.PREVIEW_ONLY,
    executable: Boolean(action.executable),
    submitEndpoint: action.submitEndpoint || "",
    selectedTarget: action.selectedTarget ?? null,
    targetCandidates: action.targetCandidates ?? [],
    requiredFields: action.requiredFields ?? [],
    fieldValues: action.fieldValues ?? {},
    warnings
  };
}
