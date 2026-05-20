import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  ACTION_STATE,
  DAILY_BRIEF_WORKFLOW_STEPS,
  WORKFLOW_STATUS,
  WORKFLOW_STEP_STATUS,
  actionContractForProposedAction,
  createWorkflowRun,
  dailyBriefStepIdForPhase,
  failWorkflowRun,
  finishWorkflowRun,
  listWorkflowRuns,
  loadWorkflowRun,
  updateDailyBriefWorkflowFromPhase,
  updateWorkflowStep
} from "../src/lib/workflow-runs.mjs";

async function withTempStore(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "workflow-runs-test-"));

  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("workflow runs persist ordered step state and metrics", async () => {
  await withTempStore(async (dir) => {
    const run = await createWorkflowRun(dir, {
      id: "daily-brief-test",
      type: "daily_brief",
      mode: "manual-preview",
      steps: DAILY_BRIEF_WORKFLOW_STEPS
    });

    assert.equal(run.status, WORKFLOW_STATUS.RUNNING);
    assert.equal(run.steps[0].id, "config");

    await updateDailyBriefWorkflowFromPhase(dir, "daily-brief-test", "messages", {
      label: "Reading Mac Messages memory"
    });
    const afterMessages = await loadWorkflowRun(dir, "daily-brief-test");

    assert.equal(afterMessages.currentStepId, "messages_ingest");
    assert.equal(afterMessages.steps.find((step) => step.id === "config").status, WORKFLOW_STEP_STATUS.SUCCEEDED);
    assert.equal(afterMessages.steps.find((step) => step.id === "messages_ingest").status, WORKFLOW_STEP_STATUS.RUNNING);

    await updateWorkflowStep(dir, "daily-brief-test", "gmail_fetch", {
      status: WORKFLOW_STEP_STATUS.RUNNING,
      runMetrics: {
        emailThreads: 12
      }
    });
    await finishWorkflowRun(dir, "daily-brief-test", {
      metrics: {
        reviewLinks: 4
      }
    });

    const finished = await loadWorkflowRun(dir, "daily-brief-test");
    assert.equal(finished.status, WORKFLOW_STATUS.SUCCEEDED);
    assert.equal(finished.metrics.emailThreads, 12);
    assert.equal(finished.metrics.reviewLinks, 4);
    assert.ok(finished.steps.every((step) => step.status === WORKFLOW_STEP_STATUS.SUCCEEDED));
  });
});

test("daily brief phases map to operator-visible workflow steps", () => {
  assert.equal(dailyBriefStepIdForPhase("gmail_profile"), "gmail_fetch");
  assert.equal(dailyBriefStepIdForPhase("gmail_fetch"), "gmail_fetch");
  assert.equal(dailyBriefStepIdForPhase("review_links"), "review_generate");
  assert.equal(dailyBriefStepIdForPhase("send_email"), "email_send");
});

test("workflow runs record failures on the active step", async () => {
  await withTempStore(async (dir) => {
    await createWorkflowRun(dir, {
      id: "shelfcycle-test",
      type: "shelfcycle_action",
      actionState: ACTION_STATE.RUNNING,
      steps: [
        { id: "validate_action", label: "Validate action" },
        { id: "shelfcycle_submit", label: "Submit to ShelfCycle" }
      ]
    });
    await updateWorkflowStep(dir, "shelfcycle-test", "shelfcycle_submit", {
      status: WORKFLOW_STEP_STATUS.RUNNING
    });
    await failWorkflowRun(dir, "shelfcycle-test", new Error("ShelfCycle page changed."), {
      stepId: "shelfcycle_submit"
    });

    const failed = await loadWorkflowRun(dir, "shelfcycle-test");
    assert.equal(failed.status, WORKFLOW_STATUS.FAILED);
    assert.equal(failed.actionState, ACTION_STATE.FAILED);
    assert.equal(failed.steps.find((step) => step.id === "shelfcycle_submit").status, WORKFLOW_STEP_STATUS.FAILED);
    assert.match(failed.error, /ShelfCycle page changed/);
  });
});

test("workflow list returns newest runs first", async () => {
  await withTempStore(async (dir) => {
    await createWorkflowRun(dir, {
      id: "run-one",
      type: "daily_brief",
      createdAt: "2026-05-01T00:00:00.000Z",
      steps: []
    });
    await createWorkflowRun(dir, {
      id: "run-two",
      type: "shelfcycle_action",
      createdAt: "2026-05-02T00:00:00.000Z",
      steps: []
    });

    const runs = await listWorkflowRuns(dir);
    assert.equal(runs[0].id, "run-two");
    assert.equal(runs[1].id, "run-one");
  });
});

test("action contracts expose approval state honestly", () => {
  const ready = actionContractForProposedAction({
    id: "action-1",
    actionType: "customer_note",
    displayLabel: "Add customer note",
    executable: true,
    warnings: []
  });
  const needsTarget = actionContractForProposedAction({
    id: "action-2",
    actionType: "customer_note",
    executable: false,
    warnings: ["Select a ShelfCycle customer before submitting."]
  });
  const preview = actionContractForProposedAction({
    id: "action-3",
    actionType: "pricing_record",
    executable: false,
    warnings: ["Pricing record requires a price."]
  });

  assert.equal(ready.state, ACTION_STATE.READY_FOR_APPROVAL);
  assert.equal(needsTarget.state, ACTION_STATE.NEEDS_TARGET);
  assert.equal(preview.state, ACTION_STATE.PREVIEW_ONLY);
});
