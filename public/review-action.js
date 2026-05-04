const titleEl = document.querySelector("#review-title");
const ledeEl = document.querySelector("#review-lede");
const relationshipChipEl = document.querySelector("#relationship-chip");
const siloChipEl = document.querySelector("#silo-chip");
const stateChipEl = document.querySelector("#state-chip");
const createdAtEl = document.querySelector("#created-at");
const availableActionsEl = document.querySelector("#available-actions");
const participantsEl = document.querySelector("#participants");
const summaryEl = document.querySelector("#summary");
const roleWorklistsEl = document.querySelector("#role-worklists");
const warningsEl = document.querySelector("#warnings");
const draftNoteEl = document.querySelector("#draft-note");
const writePlanEl = document.querySelector("#write-plan");
const suggestedCreatesEl = document.querySelector("#suggested-creates");
const documentsEl = document.querySelector("#documents");
const rawJsonEl = document.querySelector("#raw-json");
const copyJsonButton = document.querySelector("#copy-json");

let currentAction = null;

function setOutput(element, value) {
  element.textContent = value || "None";
}

function formatDate(value = "") {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatRoleWorklists(roleWorklists = {}) {
  return ["owner", "sales", "procurement"]
    .map((role) => `${role}:\n${(roleWorklists[role] ?? []).length ? roleWorklists[role].map((item) => `- ${item}`).join("\n") : "- None"}`)
    .join("\n\n");
}

function formatParticipants(participants = []) {
  if (!participants.length) {
    return "None";
  }

  return participants
    .map((participant) => {
      const label = participant.name || participant.email || "Unknown";
      return `- ${label}${participant.email ? ` <${participant.email}>` : ""}${participant.domain ? ` | ${participant.domain}` : ""}`;
    })
    .join("\n");
}

function formatDocuments(workspaceArtifacts = {}) {
  const lines = [];
  const attachments = workspaceArtifacts.attachments ?? [];
  const driveFiles = workspaceArtifacts.driveFiles ?? [];

  if (attachments.length) {
    lines.push("Attachments:");
    lines.push(...attachments.map((item) => `- ${item.filename || "Unnamed file"}${item.mimeType ? ` (${item.mimeType})` : ""}`));
  }

  if (driveFiles.length) {
    lines.push("Google Drive Files:");
    lines.push(...driveFiles.map((item) => `- ${item.name || item.id || "Unnamed file"}`));
  }

  if (workspaceArtifacts.driveFileIds?.length && !driveFiles.length && workspaceArtifacts.driveScopeAvailable === false) {
    lines.push("Google Drive files were linked in the thread, but metadata was not available.");
  }

  return lines.join("\n") || "None";
}

function renderAvailableActions(actions = []) {
  if (!actions.length) {
    availableActionsEl.innerHTML = '<span class="pill muted-pill">No manual actions detected.</span>';
    return;
  }

  availableActionsEl.innerHTML = actions
    .map(
      (action) => `
        <article class="pill-card">
          <strong>${action.label}</strong>
          <span>${action.description}</span>
        </article>
      `
    )
    .join("");
}

function renderAction(action = {}) {
  currentAction = action;
  titleEl.textContent = action.subject || "ClearEdge review packet";
  ledeEl.textContent = action.summary || "Review this packet manually before updating ShelfCycle or following up.";
  relationshipChipEl.textContent = action.relationship?.relationship || "-";
  siloChipEl.textContent = action.silo?.name || "-";
  stateChipEl.textContent = action.state?.state || "-";
  createdAtEl.textContent = formatDate(action.createdAt);
  renderAvailableActions(action.availableActions ?? []);
  setOutput(participantsEl, formatParticipants(action.externalParticipants));
  setOutput(summaryEl, action.summary || "None");
  setOutput(roleWorklistsEl, formatRoleWorklists(action.roleWorklists ?? {}));
  setOutput(warningsEl, (action.warnings ?? []).length ? action.warnings.join("\n") : "None");
  setOutput(draftNoteEl, JSON.stringify(action.draftNote ?? null, null, 2));
  setOutput(writePlanEl, JSON.stringify(action.writePlan ?? null, null, 2));
  setOutput(suggestedCreatesEl, JSON.stringify(action.suggestedCreates ?? [], null, 2));
  setOutput(documentsEl, formatDocuments(action.workspaceArtifacts ?? {}));
  setOutput(rawJsonEl, JSON.stringify(action, null, 2));
}

async function loadReviewAction() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const token = params.get("token");

  if (!id || !token) {
    titleEl.textContent = "Missing review packet link";
    ledeEl.textContent = "This review URL is incomplete. Open the latest daily brief and use the full review link.";
    return;
  }

  const response = await fetch(`/api/review-action?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`);

  if (!response.ok) {
    titleEl.textContent = "Review packet unavailable";
    ledeEl.textContent = await response.text();
    return;
  }

  const payload = await response.json();
  renderAction(payload.action ?? {});
}

copyJsonButton.addEventListener("click", async () => {
  if (!currentAction) {
    return;
  }

  await navigator.clipboard.writeText(JSON.stringify(currentAction, null, 2));
  copyJsonButton.textContent = "Copied";
  window.setTimeout(() => {
    copyJsonButton.textContent = "Copy Review JSON";
  }, 1200);
});

loadReviewAction().catch((error) => {
  titleEl.textContent = "Review packet unavailable";
  ledeEl.textContent = error instanceof Error ? error.message : "Unexpected error loading the review packet.";
});
