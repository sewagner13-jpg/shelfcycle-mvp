const reviewUrlEl = document.querySelector("#review-url");
const loadReviewButton = document.querySelector("#load-review");
const openSessionButton = document.querySelector("#open-session");
const submitNoteButton = document.querySelector("#submit-note");
const submitTitleEl = document.querySelector("#submit-title");
const submitLedeEl = document.querySelector("#submit-lede");
const submitStatusEl = document.querySelector("#submit-status");
const actionSummaryEl = document.querySelector("#action-summary");
const executableActionsEl = document.querySelector("#executable-actions");
const noteTargetEl = document.querySelector("#note-target");
const submitWritePlanEl = document.querySelector("#submit-write-plan");
const submitDraftNoteEl = document.querySelector("#submit-draft-note");
const submitWarningsEl = document.querySelector("#submit-warnings");
const submitResultEl = document.querySelector("#submit-result");

let currentAction = null;
let currentSubmission = null;

function setOutput(element, value) {
  element.textContent = value || "None";
}

function decodeActionParam(value = "") {
  if (!value) {
    return null;
  }

  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const json = window.atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function encodeActionParam(action = {}) {
  const json = JSON.stringify(action);
  return window.btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function formatActionSummary(action = {}) {
  return [
    `Subject: ${action.subject || "-"}`,
    `Relationship: ${action.relationship?.relationship || "-"}`,
    `Silo: ${action.silo?.name || "-"}`,
    `State: ${action.state?.state || "-"}`,
    `Summary: ${action.summary || "-"}`,
    `Customer Match: ${action.matches?.customer?.[0]?.candidate?.name || "None"}`
  ].join("\n");
}

function formatExecutableActions(actions = []) {
  if (!actions.length) {
    return "No direct local submit actions are available yet for this review packet.";
  }

  return actions.map((action) => `- ${action.label}: ${action.description}`).join("\n");
}

function formatNoteTarget(submission = null) {
  if (!submission) {
    return "No validated ShelfCycle note target is available for this review packet.";
  }

  return [
    `Customer: ${submission.customerName || "-"} (${submission.customerId || "-"})`,
    `ShelfCycle URL: ${submission.url || "-"}`,
    `Date: ${submission.fields?.date || "-"}`,
    `Type: ${submission.fields?.type || "-"}`,
    `Title: ${submission.fields?.title || "-"}`,
    "",
    "Summary to enter:",
    submission.fields?.summary || "-"
  ].join("\n");
}

function hasCreateNoteAction(action = {}) {
  return (action.executableActions ?? []).some((item) => item.key === "create_note");
}

function setSubmitEnabled(enabled) {
  submitNoteButton.disabled = !enabled;
  submitNoteButton.title = enabled ? "" : "This packet does not have a validated ShelfCycle note target.";
}

async function loadNoteTarget(action = {}) {
  if (!hasCreateNoteAction(action)) {
    currentSubmission = null;
    setOutput(noteTargetEl, "No direct note creation action is available. This usually means no single matched ShelfCycle customer id was found.");
    setSubmitEnabled(false);
    return;
  }

  const response = await fetch("/api/shelfcycle/note-target", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ action })
  });
  const payload = await response.json();

  if (!response.ok) {
    currentSubmission = null;
    setOutput(noteTargetEl, payload.error || "Could not validate ShelfCycle note target.");
    setSubmitEnabled(false);
    return;
  }

  currentSubmission = payload.submission;
  setOutput(noteTargetEl, formatNoteTarget(currentSubmission));
  setSubmitEnabled(Boolean(currentSubmission));
}

function syncQueryParam() {
  const url = new URL(window.location.href);

  if (reviewUrlEl.value.trim()) {
    url.searchParams.set("reviewUrl", reviewUrlEl.value.trim());
  } else {
    url.searchParams.delete("reviewUrl");
  }

  if (currentAction) {
    url.searchParams.set("action", encodeActionParam(currentAction));
  } else {
    url.searchParams.delete("action");
  }

  window.history.replaceState({}, "", url);
}

async function loadReviewAction() {
  const reviewUrl = reviewUrlEl.value.trim();

  if (!reviewUrl) {
    submitStatusEl.textContent = "Enter a review packet URL first.";
    return;
  }

  syncQueryParam();
  submitStatusEl.textContent = "Loading review packet...";

  const response = await fetch("/api/load-review-action", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ reviewUrl })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Could not load review packet.");
  }

  currentAction = payload.action;
  syncQueryParam();
  submitTitleEl.textContent = currentAction.subject || "Ready to review";
  submitLedeEl.textContent = "Verify the draft below, then explicitly approve the local ShelfCycle action.";
  setOutput(actionSummaryEl, formatActionSummary(currentAction));
  setOutput(executableActionsEl, formatExecutableActions(currentAction.executableActions ?? []));
  setOutput(submitWritePlanEl, JSON.stringify(currentAction.writePlan ?? null, null, 2));
  setOutput(submitDraftNoteEl, JSON.stringify(currentAction.draftNote ?? null, null, 2));
  setOutput(submitWarningsEl, (currentAction.warnings ?? []).join("\n"));
  setOutput(submitResultEl, "");
  submitStatusEl.textContent = "Review packet loaded.";
  await loadNoteTarget(currentAction);
}

async function openShelfCycleSession() {
  submitStatusEl.textContent = "Opening local ShelfCycle browser session...";
  const response = await fetch("/api/shelfcycle/open-session", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(currentAction ? { action: currentAction } : {})
  });
  const payload = await response.json();
  submitStatusEl.textContent = payload.message || "ShelfCycle browser session opened.";

  if (payload.submission) {
    currentSubmission = payload.submission;
    setOutput(noteTargetEl, formatNoteTarget(currentSubmission));
    setSubmitEnabled(true);
  }
}

async function submitNote() {
  if (!currentAction) {
    submitStatusEl.textContent = "Load a review packet before submitting.";
    return;
  }

  if (!currentSubmission) {
    submitStatusEl.textContent = "No validated note target is available. Load a review packet with a matched ShelfCycle customer first.";
    return;
  }

  const confirmed = window.confirm(
    `Create this ShelfCycle note?\n\nCustomer: ${currentSubmission.customerName || "-"}\nTitle: ${currentSubmission.fields?.title || "-"}\n\nThis will write to ShelfCycle.`
  );

  if (!confirmed) {
    submitStatusEl.textContent = "Submission cancelled.";
    return;
  }

  submitStatusEl.textContent = "Submitting note to ShelfCycle...";
  submitResultEl.textContent = "";
  setSubmitEnabled(false);

  try {
    const response = await fetch("/api/shelfcycle/create-note", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ action: currentAction })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "ShelfCycle note submission failed.");
    }

    submitStatusEl.textContent = "ShelfCycle note submitted.";
    submitResultEl.textContent = JSON.stringify(payload, null, 2);
  } finally {
    setSubmitEnabled(Boolean(currentSubmission));
  }
}

loadReviewButton.addEventListener("click", () => {
  loadReviewAction().catch((error) => {
    submitStatusEl.textContent = error instanceof Error ? error.message : "Could not load review packet.";
  });
});

openSessionButton.addEventListener("click", () => {
  openShelfCycleSession().catch((error) => {
    submitStatusEl.textContent = error instanceof Error ? error.message : "Could not open ShelfCycle session.";
  });
});

submitNoteButton.addEventListener("click", () => {
  submitNote().catch((error) => {
    submitStatusEl.textContent = error instanceof Error ? error.message : "ShelfCycle note submission failed.";
  });
});

const initialReviewUrl = new URL(window.location.href).searchParams.get("reviewUrl") || "";
const initialAction = decodeActionParam(new URL(window.location.href).searchParams.get("action") || "");

if (initialAction) {
  currentAction = initialAction;
  submitTitleEl.textContent = currentAction.subject || "Ready to review";
  submitLedeEl.textContent = "Verify the draft below, then explicitly approve the local ShelfCycle action.";
  setOutput(actionSummaryEl, formatActionSummary(currentAction));
  setOutput(executableActionsEl, formatExecutableActions(currentAction.executableActions ?? []));
  setOutput(submitWritePlanEl, JSON.stringify(currentAction.writePlan ?? null, null, 2));
  setOutput(submitDraftNoteEl, JSON.stringify(currentAction.draftNote ?? null, null, 2));
  setOutput(submitWarningsEl, (currentAction.warnings ?? []).join("\n"));
  setOutput(submitResultEl, "");
  submitStatusEl.textContent = "Prefilled local action loaded.";
  loadNoteTarget(currentAction).catch((error) => {
    submitStatusEl.textContent = error instanceof Error ? error.message : "Could not validate ShelfCycle note target.";
  });
} else if (initialReviewUrl) {
  reviewUrlEl.value = initialReviewUrl;
  loadReviewAction().catch((error) => {
    submitStatusEl.textContent = error instanceof Error ? error.message : "Could not load review packet.";
  });
} else {
  setSubmitEnabled(false);
  setOutput(noteTargetEl, "Load a review packet to validate the ShelfCycle note target.");
}
