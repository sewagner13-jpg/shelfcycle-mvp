const referenceFilesInput = document.querySelector("#reference-files");
const referenceStatus = document.querySelector("#reference-status");
const workflowSelect = document.querySelector("#workflow");
const inputText = document.querySelector("#input-text");
const analyzeButton = document.querySelector("#analyze");
const loadSampleButton = document.querySelector("#load-sample");
const exportKnowledgeButton = document.querySelector("#export-knowledge");
const clearReferenceButton = document.querySelector("#clear-reference");
const previewBriefButton = document.querySelector("#preview-brief");
const sendBriefNowButton = document.querySelector("#send-brief-now");
const briefRequestStatusEl = document.querySelector("#brief-request-status");
const manualBriefPanel = document.querySelector("#manual-brief-panel");
const briefControlsPanel = document.querySelector("#brief-controls-panel");
const refreshBriefStatusButton = document.querySelector("#refresh-brief-status");
const briefRunStatusEl = document.querySelector("#brief-run-status");
const excludeTypeEl = document.querySelector("#exclude-type");
const excludeValueEl = document.querySelector("#exclude-value");
const addExclusionButton = document.querySelector("#add-exclusion");
const exclusionListEl = document.querySelector("#exclusion-list");
const unknownContactsEl = document.querySelector("#unknown-contacts");

const workflowChip = document.querySelector("#workflow-chip");
const signalsEl = document.querySelector("#signals");
const writePlanEl = document.querySelector("#write-plan");
const draftEl = document.querySelector("#draft");
const matchesEl = document.querySelector("#matches");
const warningsEl = document.querySelector("#warnings");
const suggestedCreatesEl = document.querySelector("#suggested-creates");
const followUpDraftEl = document.querySelector("#follow-up-draft");
const roleWorklistsEl = document.querySelector("#role-worklists");
const automationIdeasEl = document.querySelector("#automation-ideas");
const rawJsonEl = document.querySelector("#raw-json");
const intelligenceStatusEl = document.querySelector("#intelligence-status");
const intelligenceSummaryEl = document.querySelector("#intelligence-summary");
const intelligenceBriefEl = document.querySelector("#intelligence-brief");

const LOCAL_STORAGE_KEY = "shelfcycle-mvp-reference-data";
const PROJECT_INTELLIGENCE_URL = "/data/clearedge-intelligence.json";
const EMPTY_REFERENCE_DATA = {
  products: [],
  customers: [],
  contacts: [],
  locations: [],
  clearedgeIntelligence: []
};

const state = {
  referenceData: { ...EMPTY_REFERENCE_DATA }
};

function isLocalMvpHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function configureLocalOnlyBriefControls() {
  if (!isLocalMvpHost() && briefRequestStatusEl) {
    briefRequestStatusEl.textContent =
      "Manual Gmail + Messages briefs run from the local MVP only. Open http://localhost:4318 to use Preview Brief or Send Brief Now.";
  }

  if (briefControlsPanel && !isLocalMvpHost()) {
    briefControlsPanel.hidden = true;
  }
}

function saveReferenceData() {
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state.referenceData));
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

function normalizeReferenceData(data = {}) {
  return {
    products: data.products ?? [],
    customers: data.customers ?? [],
    contacts: data.contacts ?? [],
    locations: data.locations ?? [],
    clearedgeIntelligence: data.clearedgeIntelligence ?? data.notebookIntelligence ?? []
  };
}

const REFERENCE_LABELS = {
  products: "Products",
  customers: "Customers",
  contacts: "Contacts",
  locations: "Locations",
  clearedgeIntelligence: "ClearEdge Intelligence"
};

function renderReferenceStatus() {
  const counts = Object.entries(normalizeReferenceData(state.referenceData))
    .map(([key, value]) => `<div class="stat-card"><strong>${value.length}</strong><span>${REFERENCE_LABELS[key] ?? key}</span></div>`)
    .join("");

  referenceStatus.innerHTML = counts;
}

function setOutput(id, value) {
  id.textContent = value || "None";
}

function formatMatches(matches = {}) {
  const sections = [];

  for (const [key, entries] of Object.entries(matches)) {
    if (!entries?.length) {
      continue;
    }

    sections.push(
      `${key}:\n${entries
        .map((entry) => {
          const candidate = entry.candidate ?? {};
          const label =
            candidate.name ||
            candidate.code ||
            candidate.customerName ||
            candidate.email ||
            JSON.stringify(candidate);

          return `- ${label} (score ${entry.score.toFixed(2)})`;
        })
        .join("\n")}`
    );
  }

  return sections.join("\n\n");
}

function formatDraft(result) {
  if (result.draftNote) {
    return result.draftNote.summary;
  }

  return JSON.stringify(
    {
      fields: result.fields,
      attachmentPlan: result.attachmentPlan,
      suggestedCreates: result.suggestedCreates
    },
    null,
    2
  );
}

function formatRoleWorklists(roleWorklists = {}) {
  const sections = [];

  for (const [role, items] of Object.entries(roleWorklists)) {
    sections.push(`${role}:\n${items?.length ? items.map((item) => `- ${item}`).join("\n") : "- None"}`);
  }

  return sections.join("\n\n");
}

const INTELLIGENCE_STATUS_LABELS = {
  matched: "Matched against ClearEdge Intelligence",
  no_historical_context: "No historical context yet",
  missing_primary_entity: "Primary chemical entity unresolved"
};

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function intelligenceEntityCard(entity) {
  if (!entity?.name) {
    return "";
  }

  const meta = [
    entity.code ? `Code ${entity.code}` : "",
    entity.supplier ? `Supplier ${entity.supplier}` : "",
    entity.casNumber ? `CAS ${entity.casNumber}` : "",
    entity.source ? `Source: ${entity.source.replace(/_/g, " ")}` : ""
  ]
    .filter(Boolean)
    .map((line) => `<span>${escapeHtml(line)}</span>`)
    .join("");

  return `
    <div class="pill-card notebook-card">
      <strong>${escapeHtml(entity.name)}</strong>
      ${meta}
    </div>
  `;
}

function intelligenceMatchCardTitle(matchedEntry) {
  return matchedEntry?.entity ?? "ClearEdge intelligence entry";
}

function intelligenceMatchCard(matchedEntry) {
  if (!matchedEntry) {
    return "";
  }

  const lines = [];

  if (matchedEntry.lastKnownGoodPrice) {
    lines.push(`Price: ${matchedEntry.lastKnownGoodPrice}`);
  }

  const specBits = [
    matchedEntry.masterSpecs?.casNumber ? `CAS ${matchedEntry.masterSpecs.casNumber}` : "",
    matchedEntry.masterSpecs?.purity ? `Purity ${matchedEntry.masterSpecs.purity}` : "",
    matchedEntry.masterSpecs?.flashPoint ? `Flash ${matchedEntry.masterSpecs.flashPoint}` : ""
  ].filter(Boolean);

  if (specBits.length) {
    lines.push(`Specs: ${specBits.join(" | ")}`);
  }

  if (matchedEntry.supplierNames?.length) {
    lines.push(`Suppliers: ${matchedEntry.supplierNames.slice(0, 2).join(", ")}`);
  }

  const meta = lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("");

  return `
    <div class="pill-card notebook-card">
      <strong>${escapeHtml(intelligenceMatchCardTitle(matchedEntry))}</strong>
      ${meta}
    </div>
  `;
}

function intelligenceContradictionsCard(contradictions = []) {
  if (!contradictions.length) {
    return "";
  }

  const items = contradictions
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");

  return `
    <div class="pill-card notebook-card notebook-warn">
      <strong>Contradictions detected</strong>
      <ul class="notebook-list">${items}</ul>
    </div>
  `;
}

function intelligenceLearningCard(learningPrompt) {
  if (!learningPrompt) {
    return "";
  }

  return `
    <div class="pill-card notebook-card notebook-learn">
      <strong>Learning prompt</strong>
      <span>${escapeHtml(learningPrompt)}</span>
    </div>
  `;
}

function renderIntelligenceContext(result) {
  const context = result?.intelligenceContext ?? result?.notebookContext ?? null;
  const status = context?.status ?? "missing_primary_entity";
  const label = INTELLIGENCE_STATUS_LABELS[status] ?? status;

  intelligenceStatusEl.textContent = label;
  intelligenceStatusEl.className = context && status === "matched" ? "chip active" : "chip muted";

  const cards = [
    intelligenceEntityCard(context?.primaryChemicalEntity),
    intelligenceMatchCard(context?.matchedEntry),
    intelligenceContradictionsCard(context?.contradictions ?? []),
    intelligenceLearningCard(result?.learningPrompt)
  ]
    .filter(Boolean)
    .join("");

  intelligenceSummaryEl.innerHTML = cards;
  intelligenceBriefEl.textContent = context?.brief?.trim() ? context.brief : "No intelligence brief yet.";
}

function formatFollowUpDraft(followUpDraft) {
  if (!followUpDraft) {
    return "None";
  }

  return JSON.stringify(followUpDraft, null, 2);
}

async function analyze() {
  const payload = {
    text: inputText.value,
    workflow: workflowSelect.value,
    referenceData: state.referenceData
  };

  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();

  workflowChip.textContent = `${result.workflow} (${Math.round((result.confidence ?? 0) * 100)}%)`;
  workflowChip.className = "chip active";
  setOutput(signalsEl, (result.signals ?? []).join("\n"));
  setOutput(writePlanEl, JSON.stringify(result.writePlan, null, 2));
  setOutput(draftEl, formatDraft(result));
  renderIntelligenceContext(result);
  setOutput(matchesEl, formatMatches(result.matches));
  setOutput(warningsEl, (result.warnings ?? []).join("\n"));
  setOutput(suggestedCreatesEl, JSON.stringify(result.suggestedCreates ?? [], null, 2));
  setOutput(followUpDraftEl, formatFollowUpDraft(result.followUpDraft));
  setOutput(roleWorklistsEl, formatRoleWorklists(result.roleWorklists));
  setOutput(automationIdeasEl, (result.automationIdeas ?? []).map((item) => `- ${item}`).join("\n"));
  setOutput(rawJsonEl, JSON.stringify(result, null, 2));
}

async function importCsvFile(file) {
  const csvText = await file.text();

  const response = await fetch("/api/import-csv", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      csvText,
      fileName: file.name
    })
  });

  const result = await response.json();
  state.referenceData[result.entityType] = [
    ...(state.referenceData[result.entityType] ?? []),
    ...result.records
  ];
}

async function importJsonFile(file) {
  const contents = JSON.parse(await file.text());

  for (const key of ["products", "customers", "contacts", "locations"]) {
    if (Array.isArray(contents[key])) {
      state.referenceData[key] = [...(state.referenceData[key] ?? []), ...contents[key]];
    }
  }

  const intelligenceEntries = contents.clearedgeIntelligence ?? contents.notebookIntelligence ?? [];

  if (Array.isArray(intelligenceEntries)) {
    state.referenceData.clearedgeIntelligence = mergeIntelligenceEntries(
      state.referenceData.clearedgeIntelligence,
      intelligenceEntries
    );
  }
}

async function loadReferenceFiles(files) {
  for (const file of files) {
    if (file.name.endsWith(".json")) {
      await importJsonFile(file);
    } else {
      await importCsvFile(file);
    }
  }

  saveReferenceData();
  renderReferenceStatus();
}

async function loadSampleData() {
  const response = await fetch("/data/examples/reference-data.json");
  const data = await response.json();
  state.referenceData = normalizeReferenceData(data);
  await hydrateProjectIntelligence();
  saveReferenceData();
  renderReferenceStatus();
}

async function exportKnowledgeBundle() {
  const response = await fetch("/api/export-knowledge", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      referenceData: state.referenceData,
      internalDomains: ["clear-edge.net"],
      metadata: {
        organization: "ClearEdge Solutions"
      }
    })
  });

  const bundle = await response.json();
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const datePart = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `clearedge-knowledge-${datePart}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function clearReferenceData() {
  state.referenceData = { ...EMPTY_REFERENCE_DATA };
  await hydrateProjectIntelligence();
  saveReferenceData();
  renderReferenceStatus();
}

function formatBriefRequestStatus(result = {}) {
  const payload = result.result ?? result;

  if (!payload?.ok) {
    return JSON.stringify(result, null, 2);
  }

  return [
    `Status: ${payload.dryRun ? "Preview generated" : payload.sent ? "Brief emailed" : "Run completed"}`,
    `Generated: ${payload.generatedAt}`,
    `Gmail threads: ${payload.emailThreads}`,
    `Message business threads: ${payload.messageBusinessThreads}`,
    `Message follow-ups: ${payload.messageFollowups}`,
    `Sent: ${payload.sent ? "yes" : "no"}`,
    `Brief copy: ${payload.briefPath}`
  ].join("\n");
}

function formatDateTime(value = "") {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function renderBriefRunStatus(status = {}) {
  const lastRun = status.lastRun ?? {};
  const cards = [
    ["Next Run", formatDateTime(status.nextRunAt)],
    ["Last Run", formatDateTime(lastRun.generatedAt)],
    ["Sent", lastRun.sent ? "yes" : lastRun.dryRun ? "preview" : "-"],
    ["Gmail", String(lastRun.emailThreads ?? 0)],
    ["Messages", String(lastRun.messageBusinessThreads ?? 0)],
    ["Unknown", String(lastRun.unknownMessageContacts ?? 0)],
    ["Review Links", String(lastRun.reviewLinks ?? 0)],
    ["Last Error", status.lastError || "none"]
  ];

  briefRunStatusEl.innerHTML = cards
    .map(([label, value]) => `<div class="stat-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`)
    .join("");
}

function formatExclusions(control = {}) {
  const exclude = control.exclude ?? {};
  return [
    `Emails:\n${exclude.emails?.length ? exclude.emails.map((item) => `- ${item}`).join("\n") : "- None"}`,
    `Domains:\n${exclude.domains?.length ? exclude.domains.map((item) => `- ${item}`).join("\n") : "- None"}`,
    `Phones:\n${exclude.phones?.length ? exclude.phones.map((item) => `- ${item}`).join("\n") : "- None"}`,
    `Keywords:\n${exclude.keywords?.length ? exclude.keywords.map((item) => `- ${item}`).join("\n") : "- None"}`
  ].join("\n\n");
}

function formatUnknownContacts(items = [], sourceBriefPath = "") {
  if (!items.length) {
    return `No unknown business-looking message contacts found.${sourceBriefPath ? `\nSource: ${sourceBriefPath}` : ""}`;
  }

  return [
    ...items.map((item) => `- ${item.contact} | ${item.silo || "unclassified"} | ${item.suggestedAction || item.suggested_action || "Review contact mapping."}`),
    sourceBriefPath ? `\nSource: ${sourceBriefPath}` : ""
  ].filter(Boolean).join("\n");
}

async function refreshBriefControls() {
  if (!isLocalMvpHost()) {
    return;
  }

  const [statusResponse, exclusionsResponse, unknownResponse] = await Promise.all([
    fetch("/api/daily-brief/status"),
    fetch("/api/daily-brief/exclusions"),
    fetch("/api/daily-brief/unknown-contacts")
  ]);
  const [status, exclusions, unknown] = await Promise.all([
    statusResponse.json(),
    exclusionsResponse.json(),
    unknownResponse.json()
  ]);

  renderBriefRunStatus(status);
  exclusionListEl.textContent = formatExclusions(exclusions.control ?? {});
  unknownContactsEl.textContent = formatUnknownContacts(unknown.unknownContacts ?? [], unknown.sourceBriefPath || "");
}

async function addExclusion() {
  if (!isLocalMvpHost()) {
    return;
  }

  const value = excludeValueEl.value.trim();

  if (!value) {
    exclusionListEl.textContent = "Enter a value to exclude.";
    return;
  }

  const response = await fetch("/api/daily-brief/exclusions", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      type: excludeTypeEl.value,
      value
    })
  });
  const result = await response.json();

  if (!response.ok || result.error) {
    exclusionListEl.textContent = result.error || "Could not add exclusion.";
    return;
  }

  excludeValueEl.value = "";
  exclusionListEl.textContent = formatExclusions(result.control ?? {});
}

async function requestBrief({ dryRun = true } = {}) {
  if (!isLocalMvpHost()) {
    briefRequestStatusEl.textContent =
      "Manual Gmail + Messages briefs must be run from the local MVP because Netlify cannot read Mac Messages. Open http://localhost:4318 and use this button there.";
    return;
  }

  briefRequestStatusEl.textContent = dryRun
    ? "Generating preview. This may take a minute..."
    : "Sending combined Gmail and Messages brief now. This may take a minute...";

  const response = await fetch("/api/daily-brief/request", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ dryRun })
  });
  const result = await response.json();

  if (!response.ok || result.error) {
    briefRequestStatusEl.textContent = result.error || "Manual brief request failed.";
    return;
  }

  briefRequestStatusEl.textContent = formatBriefRequestStatus(result);
  await refreshBriefControls();
}

function restoreReferenceData() {
  const saved = window.localStorage.getItem(LOCAL_STORAGE_KEY);

  if (!saved) {
    renderReferenceStatus();
    return;
  }

  try {
    state.referenceData = normalizeReferenceData(JSON.parse(saved));
  } catch {
    clearReferenceData();
    return;
  }

  renderReferenceStatus();
}

async function hydrateProjectIntelligence() {
  try {
    const response = await fetch(PROJECT_INTELLIGENCE_URL);

    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    const merged = mergeIntelligenceEntries(
      state.referenceData.clearedgeIntelligence,
      payload.clearedgeIntelligence ?? payload.notebookIntelligence ?? []
    );

    if (merged.length === state.referenceData.clearedgeIntelligence.length) {
      return;
    }

    state.referenceData.clearedgeIntelligence = merged;
  } catch {
    // Keep the app usable even when the local intelligence file is missing.
  }
}

referenceFilesInput.addEventListener("change", async (event) => {
  const files = [...(event.target.files ?? [])];

  if (!files.length) {
    return;
  }

  await loadReferenceFiles(files);
  event.target.value = "";
});

analyzeButton.addEventListener("click", analyze);
loadSampleButton.addEventListener("click", loadSampleData);
exportKnowledgeButton.addEventListener("click", exportKnowledgeBundle);
clearReferenceButton.addEventListener("click", clearReferenceData);
refreshBriefStatusButton.addEventListener("click", () => {
  refreshBriefControls().catch((error) => {
    exclusionListEl.textContent = error instanceof Error ? error.message : "Could not refresh brief controls.";
  });
});
addExclusionButton.addEventListener("click", () => {
  addExclusion().catch((error) => {
    exclusionListEl.textContent = error instanceof Error ? error.message : "Could not add exclusion.";
  });
});
previewBriefButton.addEventListener("click", () => requestBrief({ dryRun: true }));
sendBriefNowButton.addEventListener("click", () => {
  const confirmed = window.confirm("Send the combined Gmail and Messages brief email now?");

  if (confirmed) {
    requestBrief({ dryRun: false });
  }
});

async function initialize() {
  configureLocalOnlyBriefControls();
  restoreReferenceData();
  await hydrateProjectIntelligence();
  saveReferenceData();
  renderReferenceStatus();
  await refreshBriefControls().catch(() => {});
}

initialize();
