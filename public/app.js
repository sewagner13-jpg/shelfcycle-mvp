const referenceFilesInput = document.querySelector("#reference-files");
const sourceFilesInput = document.querySelector("#source-files");
const referenceStatus = document.querySelector("#reference-status");
const workflowSelect = document.querySelector("#workflow");
const inputText = document.querySelector("#input-text");
const analyzeButton = document.querySelector("#analyze");
const loadSampleButton = document.querySelector("#load-sample");
const exportKnowledgeButton = document.querySelector("#export-knowledge");
const clearReferenceButton = document.querySelector("#clear-reference");
const previewBriefButton = document.querySelector("#preview-brief");
const sendBriefNowButton = document.querySelector("#send-brief-now");
const sendEmailOnlyBriefButton = document.querySelector("#send-email-only-brief");
const briefRequestStatusEl = document.querySelector("#brief-request-status");
const manualBriefPanel = document.querySelector("#manual-brief-panel");
const briefControlsPanel = document.querySelector("#brief-controls-panel");
const refreshBriefStatusButton = document.querySelector("#refresh-brief-status");
const briefRunStatusEl = document.querySelector("#brief-run-status");
const briefProgressStateEl = document.querySelector("#brief-progress-state");
const briefProgressDetailEl = document.querySelector("#brief-progress-detail");
const briefProgressLogEl = document.querySelector("#brief-progress-log");
const briefProgressSteps = document.querySelectorAll(".progress-step");
const refreshBriefPreviewButton = document.querySelector("#refresh-brief-preview");
const latestBriefFrame = document.querySelector("#latest-brief-frame");
const latestBriefMetaEl = document.querySelector("#latest-brief-meta");
const latestBriefEmptyEl = document.querySelector("#latest-brief-empty");
const openBriefPreviewLink = document.querySelector("#open-brief-preview");
const briefLookbackHoursEl = document.querySelector("#brief-lookback-hours");
const briefStartEl = document.querySelector("#brief-start");
const briefEndEl = document.querySelector("#brief-end");
const briefGroupByEl = document.querySelector("#brief-group-by");
const excludeTypeEl = document.querySelector("#exclude-type");
const excludeValueEl = document.querySelector("#exclude-value");
const addExclusionButton = document.querySelector("#add-exclusion");
const exclusionListEl = document.querySelector("#exclusion-list");
const unknownContactsEl = document.querySelector("#unknown-contacts");
const hiddenNoiseListEl = document.querySelector("#hidden-noise-list");
const hiddenNoiseStatusEl = document.querySelector("#hidden-noise-status");
const refreshHiddenNoiseButton = document.querySelector("#refresh-hidden-noise");
const selectAllHiddenNoiseEl = document.querySelector("#select-all-hidden-noise");
const trashHiddenNoiseButton = document.querySelector("#trash-hidden-noise");

const workflowChip = document.querySelector("#workflow-chip");
const sourceFileStatusEl = document.querySelector("#source-file-status");
const signalsEl = document.querySelector("#signals");
const writePlanEl = document.querySelector("#write-plan");
const draftEl = document.querySelector("#draft");
const matchesEl = document.querySelector("#matches");
const warningsEl = document.querySelector("#warnings");
const suggestedCreatesEl = document.querySelector("#suggested-creates");
const followUpDraftEl = document.querySelector("#follow-up-draft");
const roleWorklistsEl = document.querySelector("#role-worklists");
const automationIdeasEl = document.querySelector("#automation-ideas");
const productActionsEl = document.querySelector("#product-actions");
const intelligenceStatusEl = document.querySelector("#intelligence-status");
const intelligenceSummaryEl = document.querySelector("#intelligence-summary");
const intelligenceBriefEl = document.querySelector("#intelligence-brief");
const homeBriefMetaEl = document.querySelector("#home-brief-meta");
const homeSnapshotEl = document.querySelector("#home-snapshot");
const homeTopActionsEl = document.querySelector("#home-top-actions");
const homeTextMessagesEl = document.querySelector("#home-text-messages");
const homeReviewCountEl = document.querySelector("#home-review-count");
const homeUnknownCountEl = document.querySelector("#home-unknown-count");
const homeUnknownContactsEl = document.querySelector("#home-unknown-contacts");
const homeNextRunEl = document.querySelector("#home-next-run");

const LOCAL_STORAGE_KEY = "shelfcycle-mvp-reference-data";
const PROJECT_INTELLIGENCE_URL = "/data/clearedge-intelligence.json";
const EMPTY_REFERENCE_DATA = {
  products: [],
  customers: [],
  contacts: [],
  locations: [],
  clearedgeIntelligence: []
};
const LOCAL_MVP_API_BASE = "http://localhost:4318";

const state = {
  referenceData: { ...EMPTY_REFERENCE_DATA },
  sourceFiles: []
};
let briefProgressTimer = null;
let manualBriefStartedAt = "";
let briefApiBase = "";

function isLocalMvpHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function briefApiUrl(path = "") {
  return `${briefApiBase || ""}${path}`;
}

async function resolveBriefApiBase() {
  if (isLocalMvpHost()) {
    briefApiBase = "";
    return briefApiBase;
  }

  try {
    const response = await fetch(`${LOCAL_MVP_API_BASE}/health`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Local MVP health check failed.");
    }

    briefApiBase = LOCAL_MVP_API_BASE;
    return briefApiBase;
  } catch {
    briefApiBase = "";
    return "";
  }
}

function configureLocalOnlyBriefControls() {
  if (!isLocalMvpHost() && briefRequestStatusEl) {
    briefRequestStatusEl.textContent =
      "Manual briefs use the local MVP backend. If the local backend is running, the hosted website can start the run through localhost; otherwise open http://localhost:4318.";
  }

  // Do not hide controls on the hosted page; requestBrief will use localhost
  // when the local backend is available.
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
  if (!referenceStatus) {
    return;
  }

  const counts = Object.entries(normalizeReferenceData(state.referenceData))
    .map(([key, value]) => `<div class="stat-card"><strong>${value.length}</strong><span>${REFERENCE_LABELS[key] ?? key}</span></div>`)
    .join("");

  referenceStatus.innerHTML = counts;
}

function setOutput(id, value) {
  if (!id) {
    return;
  }

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

  const fields = result.fields ?? {};
  const fieldLines = Object.entries(fields)
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `- ${key}: ${value}`);
  const aiLines = (result.aiDerivedFields ?? [])
    .map((item) => `- ${item.field}: ${item.value}${item.reason ? ` (${item.reason})` : ""}`);
  const attachmentLines = (result.writePlan?.attachments ?? result.attachmentPlan ?? [])
    .map((item) => `- ${item}`);
  const createLines = (result.suggestedCreates ?? [])
    .map((item) => `- ${item.type || "record"}: ${item.name || item.companyName || item.productName || "Review manually"}`);

  return [
    fieldLines.length ? `Extracted ShelfCycle fields:\n${fieldLines.join("\n")}` : "Extracted ShelfCycle fields:\n- None found yet",
    aiLines.length ? `AI-derived fields:\n${aiLines.join("\n")}` : "",
    attachmentLines.length ? `Document handling:\n${attachmentLines.join("\n")}` : "",
    createLines.length ? `Suggested creates:\n${createLines.join("\n")}` : ""
  ].filter(Boolean).join("\n\n");
}

function formatActionWarnings(action = {}) {
  return (action.warnings ?? []).filter(Boolean).join(" ");
}

function renderProductActions(result = {}) {
  if (!productActionsEl) {
    return;
  }

  const actions = (result.proposedActions ?? result.reviewAction?.proposedActions ?? [])
    .filter((action) => ["product_create_or_update", "product_document_followup"].includes(action.actionType));

  if (!actions.length) {
    productActionsEl.innerHTML = `
      <article class="brief-action-card">
        <p class="muted">No ShelfCycle product action was prepared. Analyze an SDS/TDS product workflow to create an approval packet.</p>
      </article>
    `;
    return;
  }

  const reviewLinks = [
    result.reviewUrl ? `<a href="${escapeHtml(result.reviewUrl)}" target="_blank" rel="noreferrer">Review Packet</a>` : "",
    result.submitUrl ? `<a href="${escapeHtml(result.submitUrl)}" target="_blank" rel="noreferrer">Approve ShelfCycle Action</a>` : ""
  ].filter(Boolean).join(" ");

  productActionsEl.innerHTML = actions
    .map((action) => {
      const status = action.executable ? "Ready for approval" : "Needs review";
      const target = action.selectedTarget?.label || action.fieldValues?.productName || action.fieldValues?.code || "No product target selected";
      const aiLines = (action.fieldValues?.aiDerivedFields ?? result.aiDerivedFields ?? [])
        .map((item) => `<li>${escapeHtml(item.field)}: ${escapeHtml(item.value)}${item.reason ? ` <span class="muted">(${escapeHtml(item.reason)})</span>` : ""}</li>`)
        .join("");
      const warnings = formatActionWarnings(action);

      return `
        <article class="brief-action-card">
          <p class="brief-kicker">${escapeHtml(status)}</p>
          <h3>${escapeHtml(action.displayLabel || action.actionType || "ShelfCycle action")}</h3>
          <p><strong>Target:</strong> ${escapeHtml(target)}</p>
          <p><strong>Mode:</strong> ${escapeHtml(action.fieldValues?.mode || "review")}</p>
          ${warnings ? `<p><strong>Warnings:</strong> ${escapeHtml(warnings)}</p>` : ""}
          ${aiLines ? `<p><strong>AI-derived fields:</strong></p><ul>${aiLines}</ul>` : ""}
          <div class="brief-action-links">${reviewLinks || "Run analysis to generate approval links."}</div>
        </article>
      `;
    })
    .join("");
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
  if (!intelligenceStatusEl || !intelligenceSummaryEl || !intelligenceBriefEl) {
    return;
  }

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
  if (!inputText || !workflowSelect) {
    return;
  }

  const payload = {
    text: inputText.value,
    workflow: workflowSelect.value,
    referenceData: state.referenceData,
    files: state.sourceFiles
  };

  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  let result = {};

  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(`Analyze returned a non-JSON response: ${responseText.slice(0, 180)}`);
  }

  if (!response.ok) {
    throw new Error(result.error || result.message || "Analyze request failed.");
  }

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
  renderProductActions(result);
  setOutput(automationIdeasEl, [
    result.workflowRunId ? `Workflow run: ${result.workflowRunId}` : "",
    result.workflowRun?.status ? `Workflow status: ${result.workflowRun.status}` : "",
    ...((result.workflowRun?.steps ?? []).map((step) => `- ${step.status}: ${step.label}${step.detail ? ` - ${step.detail}` : ""}`)),
    ...((result.automationIdeas ?? []).map((item) => `- ${item}`))
  ].filter(Boolean).join("\n"));
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
  const payload = result.result?.summary ?? result.summary ?? result.result ?? result;

  if (!payload?.ok) {
    return payload?.message || result.error || result.message || "The manual brief request did not start. Check the progress panel for details.";
  }

  if (!payload.summary && payload.statusUrl) {
    const runType = payload.emailOnly ? "Email-only brief" : "Combined Gmail + Messages brief";
    return [
      `Status: ${payload.dryRun ? `${runType} preview started. No email will be sent.` : `${runType} started. It will send at the Save/Email step.`}`,
      `Started: ${payload.startedAt}`,
      `Run ID: ${payload.runId || "-"}`,
      payload.dateRange?.label
        ? `Range: ${payload.dateRange.label}`
        : (payload.since || payload.until ? `Range: ${payload.since || "default start"} to ${payload.until || "now"}` : (payload.hours ? `Range: last ${payload.hours} hour(s)` : "")),
      payload.groupBy ? `Organized by: ${formatGroupByLabel(payload.groupBy)}` : "",
      payload.emailOnly
        ? "Progress will update below while the local runner works through Gmail, AI read, review links, and email. Mac Messages are skipped."
        : "Progress will update below while the local runner works through Messages, Gmail, AI read, review links, and email."
    ].filter(Boolean).join("\n");
  }

  return [
    `Status: ${payload.emailOnly ? "Email-only " : ""}${payload.dryRun ? "preview generated. No email was sent." : payload.sent ? "brief emailed" : "run completed but email was not confirmed sent."}`,
    `Generated: ${payload.generatedAt}`,
    payload.dateRange?.label ? `Range: ${payload.dateRange.label}` : "",
    payload.groupBy ? `Organized by: ${formatGroupByLabel(payload.groupBy)}` : "",
    `Gmail threads: ${payload.emailThreads}`,
    `Message business threads: ${payload.messageBusinessThreads}`,
    `Message follow-ups: ${payload.messageFollowups}`,
    `Sent: ${payload.sent ? "yes" : "no"}`,
    `Brief copy: ${payload.briefPath}`
  ].filter(Boolean).join("\n");
}

function localDateTimeToIso(value = "") {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function formatGroupByLabel(value = "action") {
  return {
    action: "Action type",
    company: "Company",
    sender: "Sender",
    type: "Business type"
  }[value] || "Action type";
}

function formatBriefOptions(options = {}) {
  const lines = [];

  if (options.since || options.until) {
    lines.push(`Range: ${options.since ? formatFullDateTime(options.since) : "default start"} to ${options.until ? formatFullDateTime(options.until) : "now"}`);
  } else if (options.hours) {
    lines.push(`Range: last ${options.hours} hour(s)`);
  }

  lines.push(`Organized by: ${formatGroupByLabel(options.groupBy)}`);
  return lines.join("\n");
}

function collectBriefRunOptions() {
  const groupBy = briefGroupByEl?.value || "action";
  const hours = Number.parseInt(briefLookbackHoursEl?.value || "24", 10);
  const since = localDateTimeToIso(briefStartEl?.value || "");
  const until = localDateTimeToIso(briefEndEl?.value || "");
  const options = {
    groupBy: ["action", "company", "sender", "type"].includes(groupBy) ? groupBy : "action"
  };

  if (Number.isFinite(hours) && hours > 0 && !since) {
    options.hours = hours;
  }

  if (since) {
    options.since = since;
  }

  if (until) {
    options.until = until;
  }

  return options;
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

function formatElapsed(startedAt = "") {
  if (!startedAt) {
    return "";
  }

  const elapsedMs = Date.now() - new Date(startedAt).getTime();

  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return "";
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function formatFullDateTime(value = "") {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function labeledLink(link = {}) {
  if (!link.url || !link.label) {
    return "";
  }

  return `<a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`;
}

function renderHomeSnapshot(snapshot = {}, lastRun = {}) {
  if (!homeSnapshotEl) {
    return;
  }

  const cards = [
    ["Needs Sean Today", snapshot["Needs Sean Today"] ?? "0", "Unanswered or decision-needed items."],
    ["Waiting on Others", snapshot["Waiting on Others"] ?? "0", "Important threads already replied to."],
    ["ShelfCycle Reviews", snapshot["ShelfCycle Reviews"] ?? lastRun.reviewLinks ?? "0", "Approval-first follow-through links."],
    ["Hidden Noise", snapshot["Hidden Noise"] ?? "0", "Solicitations/newsletters collapsed."]
  ];

  homeSnapshotEl.innerHTML = cards
    .map(
      ([label, value, note]) => `
        <div class="kpi-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
          <small>${escapeHtml(note)}</small>
        </div>
      `
    )
    .join("");
}

function renderHomeTopActions(actions = []) {
  if (!homeTopActionsEl) {
    return;
  }

  if (!actions.length) {
    homeTopActionsEl.innerHTML = `
      <article class="brief-action-card">
        <p class="muted">No top actions found in the latest local brief. Run a new brief to populate this queue.</p>
        <a href="/briefs.html">Open Briefs</a>
      </article>
    `;
    return;
  }

  homeTopActionsEl.innerHTML = actions
    .map((action) => {
      const links = (action.links ?? [])
        .filter((link) => ["Gmail", "Review Packet", "Decide in ChatGPT"].includes(link.label))
        .map(labeledLink)
        .filter(Boolean)
        .join(" ");

      return `
        <article class="brief-action-card">
          <p class="brief-kicker">${escapeHtml(action.kicker || "Priority")}</p>
          <h3>${escapeHtml(action.title || "Untitled action")}</h3>
          <div class="record-meta">
            <span>${escapeHtml(action.time || "No time")}</span>
            <span>${escapeHtml(action.type || "Unclassified")}</span>
            <span>${escapeHtml(action.state || "New")}</span>
          </div>
          <p><strong>Action:</strong> ${escapeHtml(action.action || "Review this thread.")}</p>
          <p><strong>Why:</strong> ${escapeHtml(action.why || "No reason captured.")}</p>
          ${action.confidence ? `<p><strong>Confidence:</strong> ${escapeHtml(action.confidence)}</p>` : ""}
          ${action.risk ? `<p><strong>Risk:</strong> ${escapeHtml(action.risk)}</p>` : ""}
          ${action.shelfCycleStatus ? `<p><strong>ShelfCycle status:</strong> ${escapeHtml(action.shelfCycleStatus)}</p>` : ""}
          ${action.shelfCycle ? `<p><strong>ShelfCycle:</strong> ${escapeHtml(action.shelfCycle)}</p>` : ""}
          <div class="brief-action-links">${links || '<a href="/briefs.html">Open Briefs</a>'}</div>
        </article>
      `;
    })
    .join("");
}

function renderHomeTextMessages(textMessages = null) {
  if (!homeTextMessagesEl) {
    return;
  }

  if (!textMessages) {
    homeTextMessagesEl.innerHTML = `
      <div class="activity-item">
        <strong>No Messages summary</strong>
        <span>Run the local brief to include Mac Messages memory.</span>
      </div>
    `;
    return;
  }

  const businessTexts = (textMessages.businessTexts ?? [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  homeTextMessagesEl.innerHTML = `
    <div class="activity-item">
      <strong>Summary</strong>
      <span>${escapeHtml(textMessages.summary || "No business text summary captured.")}</span>
    </div>
    <div class="activity-item">
      <strong>Action</strong>
      <span>${escapeHtml(textMessages.action || "No text-message follow-up required.")}</span>
    </div>
    ${
      businessTexts
        ? `<div class="activity-item"><strong>Business texts</strong><ul class="compact-list">${businessTexts}</ul></div>`
        : ""
    }
    ${
      textMessages.unknownText
        ? `<div class="activity-item"><strong>Unknown</strong><span>${escapeHtml(textMessages.unknownText)}</span></div>`
        : ""
    }
  `;
}

function renderHomeUnknownContacts(items = []) {
  if (!homeUnknownContactsEl) {
    return;
  }

  if (!items.length) {
    homeUnknownContactsEl.innerHTML = `
      <div class="activity-item">
        <strong>No cleanup needed</strong>
        <span>No unknown business-looking text contacts in the latest brief.</span>
      </div>
    `;
    return;
  }

  homeUnknownContactsEl.innerHTML = items
    .slice(0, 4)
    .map(
      (item) => `
        <div class="activity-item">
          <strong>${escapeHtml(item.contact || item.phone || "Unknown contact")}</strong>
          <span>${escapeHtml(item.relationship || "unclassified")} / ${escapeHtml(item.silo || "unclassified")}</span>
        </div>
      `
    )
    .join("");
}

function renderHomeNextRun(payload = {}) {
  if (!homeNextRunEl) {
    return;
  }

  const lastRun = payload.lastRun ?? {};
  homeNextRunEl.innerHTML = `
    <div class="activity-item">
      <strong>Last brief</strong>
      <span>${escapeHtml(formatFullDateTime(lastRun.generatedAt))}${lastRun.sent ? " · emailed" : lastRun.dryRun ? " · preview" : ""}</span>
    </div>
    <div class="activity-item">
      <strong>Next scheduled run</strong>
      <span>${escapeHtml(formatFullDateTime(payload.nextRunAt))}</span>
    </div>
    <div class="activity-item">
      <strong>AI owner read</strong>
      <span>${escapeHtml(lastRun.briefAi?.status || "not available")}</span>
    </div>
  `;
}

async function refreshHomeDashboard() {
  if (!homeBriefMetaEl) {
    return;
  }

  try {
    const response = await fetch("/api/home-dashboard");

    if (!response.ok) {
      throw new Error("Home dashboard data is available from the local MVP only.");
    }

    const payload = await response.json();
    const lastRun = payload.lastRun ?? {};

    homeBriefMetaEl.textContent = lastRun.generatedAt
      ? `Latest brief generated ${formatFullDateTime(lastRun.generatedAt)} with ${lastRun.emailThreads ?? 0} Gmail threads, ${lastRun.messageBusinessThreads ?? 0} business text thread(s), and ${lastRun.reviewLinks ?? 0} ShelfCycle review link(s).`
      : "No local daily brief has been generated yet.";

    if (homeReviewCountEl) {
      homeReviewCountEl.textContent = `${lastRun.reviewLinks ?? 0} review`;
    }

    if (homeUnknownCountEl) {
      homeUnknownCountEl.textContent = `${lastRun.unknownMessageContacts ?? 0} unknown`;
    }

    renderHomeSnapshot(payload.snapshot ?? {}, lastRun);
    renderHomeTopActions(payload.topActions ?? []);
    renderHomeTextMessages(payload.textMessages);
    renderHomeUnknownContacts(lastRun.unknownContacts ?? []);
    renderHomeNextRun(payload);
  } catch (error) {
    homeBriefMetaEl.textContent =
      "Home insights come from the latest local daily brief. Open the local MVP and run a brief to populate this page.";
    renderHomeSnapshot({}, {});
    renderHomeTopActions([]);
    renderHomeTextMessages(null);
    renderHomeUnknownContacts([]);
    renderHomeNextRun({});
  }
}

function renderBriefRunStatus(status = {}) {
  if (!briefRunStatusEl) {
    return;
  }

  const lastRun = status.lastRun ?? {};
  const cards = [
    ["Next Run", formatDateTime(status.nextRunAt)],
    ["Last Run", formatDateTime(lastRun.generatedAt)],
    ["Type", lastRun.emailOnly ? "email only" : "combined"],
    ["Range", lastRun.dateRange?.label || (lastRun.dateRange?.hours ? `last ${lastRun.dateRange.hours}h` : "-")],
    ["Grouped", formatGroupByLabel(lastRun.groupBy || "action")],
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

function renderLastRunEmailNotice(lastRun = {}) {
  if (!briefRequestStatusEl || !lastRun.generatedAt) {
    return;
  }

  const currentText = briefRequestStatusEl.textContent || "";

  if (currentText && !/No manual brief requested yet\.|Loading|Checking/i.test(currentText)) {
    return;
  }

  if (lastRun.dryRun) {
    briefRequestStatusEl.textContent = [
      lastRun.emailOnly ? "Last manual run was Email-Only Preview. No email was sent." : "Last manual run was Preview Only. No email was sent.",
      `Finished: ${formatFullDateTime(lastRun.generatedAt)}`,
      lastRun.emailOnly
        ? "Use the website preview below to work the same links without sending email."
        : "Press Run And Email Brief Now if you want it delivered to your inbox."
    ].join("\n");
    return;
  }

  briefRequestStatusEl.textContent = [
    lastRun.sent
      ? (lastRun.emailOnly ? "Last email-only run emailed successfully." : "Last run emailed successfully.")
      : (lastRun.emailOnly ? "Last email-only run completed, but no Gmail send confirmation was recorded." : "Last run completed, but no Gmail send confirmation was recorded."),
    `Finished: ${formatFullDateTime(lastRun.generatedAt)}`,
    lastRun.sendResultId ? `Gmail send id: ${lastRun.sendResultId}` : ""
  ].filter(Boolean).join("\n");
}

function briefHtmlWithExternalLinks(briefHtml = "") {
  const baseTag = '<base target="_blank">';

  if (/<base\s/i.test(briefHtml)) {
    return briefHtml;
  }

  if (/<head[^>]*>/i.test(briefHtml)) {
    return briefHtml.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }

  return `${baseTag}${briefHtml}`;
}

function renderLatestBriefPreview(payload = {}) {
  if (!latestBriefFrame || !latestBriefMetaEl || !latestBriefEmptyEl) {
    return;
  }

  if (!payload?.ok || !payload.briefHtml) {
    latestBriefFrame.hidden = true;
    latestBriefFrame.removeAttribute("srcdoc");
    latestBriefEmptyEl.hidden = false;
    latestBriefEmptyEl.textContent = payload?.error || "No saved brief preview found yet.";
    latestBriefMetaEl.textContent =
      "Run a preview or brief to keep the latest generated copy available here.";

    if (openBriefPreviewLink) {
      openBriefPreviewLink.classList.add("disabled-link");
      openBriefPreviewLink.removeAttribute("href");
    }
    return;
  }

  const summary = payload.summary ?? {};
  const generatedAt = payload.generatedAt || summary.generatedAt || summary.finishedAt || "";
  const typeLabel = payload.emailOnly ? "Email-only" : "Combined Gmail + Messages";
  const deliveryLabel = payload.sent ? "emailed" : payload.dryRun ? "preview only, no email sent" : "saved locally";

  latestBriefEmptyEl.hidden = true;
  latestBriefFrame.hidden = false;
  latestBriefFrame.srcdoc = briefHtmlWithExternalLinks(payload.briefHtml);
  latestBriefMetaEl.textContent = [
    `${typeLabel} brief generated ${formatFullDateTime(generatedAt)}.`,
    `Status: ${deliveryLabel}.`,
    `${summary.emailThreads ?? 0} Gmail thread(s), ${summary.reviewLinks ?? 0} review link(s).`
  ].join(" ");

  if (openBriefPreviewLink) {
    openBriefPreviewLink.classList.remove("disabled-link");
    openBriefPreviewLink.href = briefApiUrl("/api/daily-brief/latest.html");
  }
}

async function refreshLatestBriefPreview() {
  if (!latestBriefFrame || !latestBriefMetaEl || !latestBriefEmptyEl) {
    return;
  }

  const apiBase = await resolveBriefApiBase();

  if (!isLocalMvpHost() && !apiBase) {
    renderLatestBriefPreview({
      ok: false,
      error: "Start the local MVP at http://localhost:4318 to load saved brief previews."
    });
    return;
  }

  try {
    const response = await fetch(briefApiUrl("/api/daily-brief/latest"), {
      cache: "no-store"
    });
    const payload = await response.json();
    renderLatestBriefPreview(payload);
  } catch {
    renderLatestBriefPreview({
      ok: false,
      error: "Could not load the saved brief preview from the local MVP."
    });
  }
}

function hiddenNoiseTime(value = "") {
  if (!value) {
    return "-";
  }

  const dateValue = typeof value === "number" ? new Date(value).toISOString() : value;
  return formatFullDateTime(dateValue);
}

function selectedHiddenNoiseThreadIds() {
  return [...(hiddenNoiseListEl?.querySelectorAll("[data-hidden-noise-thread]:checked") ?? [])]
    .map((input) => input.value)
    .filter(Boolean);
}

function renderHiddenNoiseCleanup(payload = {}) {
  if (!hiddenNoiseListEl || !hiddenNoiseStatusEl) {
    return;
  }

  const items = payload.items ?? [];

  if (!payload.ok) {
    hiddenNoiseStatusEl.textContent = payload.error || "Could not load hidden-noise emails.";
    hiddenNoiseListEl.innerHTML = "";
    return;
  }

  hiddenNoiseStatusEl.textContent = [
    `${payload.count ?? items.length} hidden-noise email thread(s) from the latest generated brief.`,
    payload.generatedAt ? `Brief generated ${formatFullDateTime(payload.generatedAt)}.` : "",
    "Move to Trash is approval-only and reversible in Gmail."
  ].filter(Boolean).join(" ");

  if (!items.length) {
    hiddenNoiseListEl.innerHTML = `
      <div class="empty-state">
        No hidden-noise Gmail threads were saved with the latest brief. Run a new brief to populate this list.
      </div>
    `;
    return;
  }

  hiddenNoiseListEl.innerHTML = `
    <table class="workflow-table">
      <thead>
        <tr>
          <th>Select</th>
          <th>Sender</th>
          <th>Subject</th>
          <th>Received</th>
          <th>Why hidden</th>
          <th>Gmail</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item) => {
          const trashed = item.trashStatus === "trashed";
          const failed = item.trashStatus === "failed";
          const sender = item.senderName || item.senderEmail || item.senderDomain || "Unknown";
          const reasons = (item.reasons ?? []).length ? item.reasons.join("; ") : item.subtype || "Likely solicitation/newsletter";

          return `
            <tr>
              <td>
                <input
                  type="checkbox"
                  data-hidden-noise-thread
                  value="${escapeHtml(item.threadId || "")}"
                  ${trashed ? "disabled" : ""}
                />
              </td>
              <td><strong>${escapeHtml(sender)}</strong><span>${escapeHtml(item.senderEmail || item.senderDomain || "")}</span></td>
              <td><strong>${escapeHtml(item.subject || "No subject")}</strong><span>${escapeHtml(item.snippet || "")}</span></td>
              <td>${escapeHtml(hiddenNoiseTime(item.lastTimestamp))}</td>
              <td>${escapeHtml(reasons)}</td>
              <td>${item.gmailUrl ? `<a href="${escapeHtml(item.gmailUrl)}" target="_blank" rel="noreferrer">Open</a>` : "-"}</td>
              <td><span class="status-pill ${trashed ? "status-ready" : failed ? "status-review" : "status-live"}">${escapeHtml(trashed ? "In Trash" : failed ? "Failed" : "Available")}</span>${item.trashError ? `<span>${escapeHtml(item.trashError)}</span>` : ""}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

async function refreshHiddenNoiseCleanup() {
  if (!hiddenNoiseListEl || !hiddenNoiseStatusEl) {
    return;
  }

  const apiBase = await resolveBriefApiBase();

  if (!isLocalMvpHost() && !apiBase) {
    renderHiddenNoiseCleanup({
      ok: false,
      error: "Start the local MVP at http://localhost:4318 to load and clean up Gmail hidden-noise emails."
    });
    return;
  }

  hiddenNoiseStatusEl.textContent = "Loading hidden-noise email list...";

  try {
    const response = await fetch(briefApiUrl("/api/gmail/hidden-noise"), {
      cache: "no-store"
    });
    const payload = await response.json();
    renderHiddenNoiseCleanup(payload);
  } catch {
    renderHiddenNoiseCleanup({
      ok: false,
      error: "Could not load hidden-noise emails from the local backend."
    });
  }
}

async function trashSelectedHiddenNoise() {
  if (!hiddenNoiseStatusEl) {
    return;
  }

  const threadIds = selectedHiddenNoiseThreadIds();

  if (!threadIds.length) {
    hiddenNoiseStatusEl.textContent = "Select at least one hidden-noise email thread first.";
    return;
  }

  const confirmed = window.confirm(
    `Move ${threadIds.length} selected Gmail thread(s) to Trash?\n\nThis is not permanent deletion, but it changes your actual Gmail account.`
  );

  if (!confirmed) {
    hiddenNoiseStatusEl.textContent = "Gmail Trash action cancelled.";
    return;
  }

  hiddenNoiseStatusEl.textContent = `Moving ${threadIds.length} selected Gmail thread(s) to Trash...`;

  try {
    const response = await fetch(briefApiUrl("/api/gmail/hidden-noise/trash"), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        threadIds,
        confirm: true
      })
    });
    const payload = await response.json();
    const failed = payload.failedCount ?? 0;

    hiddenNoiseStatusEl.textContent = failed
      ? `Moved ${payload.movedCount ?? 0}; ${failed} failed. ${payload.results?.find((item) => !item.ok)?.error || ""}`
      : `Moved ${payload.movedCount ?? 0} Gmail thread(s) to Trash.`;
    renderHiddenNoiseCleanup({
      ok: true,
      items: payload.hiddenNoise ?? [],
      count: payload.hiddenNoise?.length ?? 0
    });
  } catch (error) {
    hiddenNoiseStatusEl.textContent = error instanceof Error ? error.message : "Could not move selected emails to Gmail Trash.";
  }
}

const BRIEF_PHASE_ORDER = [
  "starting",
  "config",
  "loading_knowledge",
  "messages",
  "gmail_profile",
  "gmail_fetch",
  "workspace_artifacts",
  "classify",
  "ai_refine",
  "review_links",
  "build_brief",
  "send_email",
  "complete",
  "finished"
];

const VISIBLE_BRIEF_STEPS = [
  "start",
  "messages",
  "gmail",
  "classify",
  "ai_refine",
  "review_links",
  "build_brief",
  "send_email",
  "finished"
];

const BRIEF_PHASE_TO_VISIBLE_STEP = {
  starting: "start",
  config: "start",
  loading_knowledge: "start",
  messages: "messages",
  gmail_profile: "gmail",
  gmail_fetch: "gmail",
  workspace_artifacts: "gmail",
  classify: "classify",
  ai_refine: "ai_refine",
  review_links: "review_links",
  build_brief: "build_brief",
  send_email: "send_email",
  complete: "finished",
  finished: "finished",
  failed: "finished"
};

const BRIEF_PHASE_LABELS = {
  starting: "Starting local runner",
  config: "Loading settings",
  loading_knowledge: "Loading ClearEdge knowledge",
  messages: "Reading Mac Messages",
  gmail_profile: "Checking Gmail account",
  gmail_fetch: "Pulling Gmail threads",
  workspace_artifacts: "Checking attachments and Drive links",
  classify: "Classifying and triaging",
  ai_refine: "AI owner-read refinement",
  review_links: "Building review packets",
  build_brief: "Building the brief",
  send_email: "Sending the email",
  complete: "Completing run",
  finished: "Finished"
};

const WORKFLOW_STEP_TO_BRIEF_PHASE = {
  config: "config",
  messages_ingest: "messages",
  gmail_fetch: "gmail_fetch",
  workspace_artifacts: "workspace_artifacts",
  triage: "classify",
  ai_refine: "ai_refine",
  review_generate: "review_links",
  brief_build: "build_brief",
  email_send: "send_email"
};

function phaseIndex(phase = "") {
  const index = BRIEF_PHASE_ORDER.indexOf(phase);
  return index === -1 ? 0 : index;
}

function visibleStepForPhase(phase = "") {
  return BRIEF_PHASE_TO_VISIBLE_STEP[phase] || "start";
}

function visibleStepIndex(step = "") {
  const index = VISIBLE_BRIEF_STEPS.indexOf(step);
  return index === -1 ? 0 : index;
}

function setBriefButtonsRunning(isRunning) {
  if (previewBriefButton) {
    previewBriefButton.disabled = isRunning;
  }

  if (sendBriefNowButton) {
    sendBriefNowButton.disabled = isRunning;
  }

  if (sendEmailOnlyBriefButton) {
    sendEmailOnlyBriefButton.disabled = isRunning;
  }
}

function renderBriefProgress(status = {}) {
  if (!briefProgressStateEl || !briefProgressDetailEl) {
    return;
  }

  const current = status.currentRun ?? {};
  const lastRun = status.lastRun ?? {};
  const workflowRun = status.workflowRun ?? null;
  const workflowCurrentStep = workflowRun?.steps?.find((step) => step.id === workflowRun.currentStepId) ?? null;
  const running = Boolean(status.isRunning && (current.state === "running" || workflowRun?.status === "running"));
  const failed = current.state === "failed" || workflowRun?.status === "failed" || Boolean(status.lastError);
  const phase = current.phase || WORKFLOW_STEP_TO_BRIEF_PHASE[workflowRun?.currentStepId] || (lastRun.generatedAt ? "finished" : "starting");
  const visibleStep = visibleStepForPhase(failed ? "failed" : phase);
  const visibleStepPosition = visibleStepIndex(visibleStep);
  const startedAt = current.startedAt || manualBriefStartedAt || "";
  const elapsed = running ? formatElapsed(startedAt) : "";
  const workflowLines = (workflowRun?.steps ?? [])
    .filter((step) => step.status && step.status !== "pending")
    .map((step) => ({
      status: step.status,
      label: step.label,
      detail: step.detail || ""
    }));

  briefProgressStateEl.textContent = running ? "Running" : failed ? "Issue" : "Ready";
  briefProgressStateEl.className = running
    ? "status-pill status-live"
    : failed
      ? "status-pill status-review"
      : "status-pill status-ready";

  for (const step of briefProgressSteps) {
    const stepPosition = visibleStepIndex(step.dataset.step || step.dataset.phase || "");
    step.classList.toggle("active", running && stepPosition === visibleStepPosition);
    step.classList.toggle("complete", !failed && stepPosition <= visibleStepPosition && (running || lastRun.generatedAt));
    step.classList.toggle("failed", failed && stepPosition === visibleStepPosition);
  }

  const currentLabel = current.label || workflowCurrentStep?.label || (lastRun.generatedAt ? "Latest brief completed." : "No brief run found yet.");
  const statusBits = [
    running ? `Elapsed ${elapsed || "0s"}` : "",
    running && current.startedAt ? `Started ${formatFullDateTime(current.startedAt)}` : "",
    current.updatedAt ? `Last update ${formatFullDateTime(current.updatedAt)}` : "",
    current.emailThreads !== undefined ? `${current.emailThreads} Gmail thread(s) found` : "",
    current.analyzedThreads !== undefined ? `${current.analyzedThreads} thread(s) being summarized` : "",
    lastRun.generatedAt && !running ? `Last finished ${formatFullDateTime(lastRun.generatedAt)}${lastRun.sent ? " and emailed" : lastRun.dryRun ? " as preview" : ""}` : "",
    status.nextRunAt && !running ? `Next scheduled run ${formatFullDateTime(status.nextRunAt)}` : ""
  ].filter(Boolean);

  briefProgressDetailEl.innerHTML = `
    <p>${escapeHtml(currentLabel)}</p>
    <p>Current stage: ${escapeHtml(BRIEF_PHASE_LABELS[phase] || phase || "Starting")}</p>
    ${status.lastError ? `<p>Issue: ${escapeHtml(status.lastError)}</p>` : ""}
    ${statusBits.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
  `;

  if (briefProgressLogEl) {
    const logItems = workflowLines.slice(-9).map((step) => `
      <div class="progress-log-item ${escapeHtml(step.status)}">
        <strong>${escapeHtml(step.label)}</strong>
        <span>${escapeHtml(step.status.replace(/_/g, " "))}${step.detail ? ` - ${escapeHtml(step.detail)}` : ""}</span>
      </div>
    `);

    briefProgressLogEl.innerHTML = logItems.length
      ? logItems.join("")
      : '<div class="progress-log-item waiting"><strong>Waiting for a run</strong><span>Press Run Brief Preview or Send Brief Now to start.</span></div>';
  }
  setBriefButtonsRunning(running);
}

function startBriefProgressPolling() {
  if (briefProgressTimer) {
    window.clearInterval(briefProgressTimer);
  }

  briefProgressTimer = window.setInterval(() => {
    refreshBriefControls().catch(() => {});
  }, 2000);
}

function stopBriefProgressPolling() {
  if (!briefProgressTimer) {
    return;
  }

  window.clearInterval(briefProgressTimer);
  briefProgressTimer = null;
  setBriefButtonsRunning(false);
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
  const apiBase = await resolveBriefApiBase();

  if (!isLocalMvpHost() && !apiBase) {
    if (briefRunStatusEl) {
      briefRunStatusEl.innerHTML = '<div class="stat-card"><strong>offline</strong><span>Local Backend</span></div>';
    }

    if (exclusionListEl) {
      exclusionListEl.textContent = "Start the local MVP at http://localhost:4318 to manage exclusions.";
    }

    if (unknownContactsEl) {
      unknownContactsEl.textContent = "Start the local MVP to load unknown text contacts.";
    }

    await refreshLatestBriefPreview();
    await refreshHiddenNoiseCleanup();
    return;
  }

  if (!briefRunStatusEl || !exclusionListEl || !unknownContactsEl) {
    return;
  }

  const [statusResponse, exclusionsResponse, unknownResponse] = await Promise.all([
    fetch(briefApiUrl("/api/daily-brief/status")),
    fetch(briefApiUrl("/api/daily-brief/exclusions")),
    fetch(briefApiUrl("/api/daily-brief/unknown-contacts"))
  ]);
  const [status, exclusions, unknown] = await Promise.all([
    statusResponse.json(),
    exclusionsResponse.json(),
    unknownResponse.json()
  ]);

  renderBriefRunStatus(status);
  renderBriefProgress(status);
  renderLastRunEmailNotice(status.lastRun ?? {});
  await refreshLatestBriefPreview();
  await refreshHiddenNoiseCleanup();
  if (briefProgressTimer && !status.isRunning) {
    stopBriefProgressPolling();
  }
  if (!briefProgressTimer && status.isRunning) {
    startBriefProgressPolling();
  }
  exclusionListEl.textContent = formatExclusions(exclusions.control ?? {});
  unknownContactsEl.textContent = formatUnknownContacts(unknown.unknownContacts ?? [], unknown.sourceBriefPath || "");
}

async function addExclusion() {
  const apiBase = await resolveBriefApiBase();

  if ((!isLocalMvpHost() && !apiBase) || !excludeValueEl || !excludeTypeEl || !exclusionListEl) {
    if (exclusionListEl) {
      exclusionListEl.textContent = "Start the local MVP at http://localhost:4318 before adding exclusions.";
    }
    return;
  }

  const value = excludeValueEl.value.trim();

  if (!value) {
    exclusionListEl.textContent = "Enter a value to exclude.";
    return;
  }

  const response = await fetch(briefApiUrl("/api/daily-brief/exclusions"), {
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

async function requestBrief({ dryRun = true, emailOnly = false } = {}) {
  if (!briefRequestStatusEl) {
    return;
  }

  const apiBase = await resolveBriefApiBase();
  const runOptions = collectBriefRunOptions();

  if (!isLocalMvpHost() && !apiBase) {
    briefRequestStatusEl.textContent =
      emailOnly
        ? "Start the local MVP at http://localhost:4318, then click Run Email-Only Brief Now again. The hosted website uses the local backend for Gmail credentials, review links, and progress tracking."
        : "Manual Gmail + Messages briefs must be run from the local MVP because Netlify cannot read Mac Messages. Open http://localhost:4318 and use this button there.";
    return;
  }

  briefRequestStatusEl.textContent = emailOnly
    ? (dryRun
      ? `Email-only preview request sent. This will not send email or read Mac Messages.\n${formatBriefOptions(runOptions)}`
      : `Email-only brief request sent. Watch the tracker; this skips Mac Messages and sends at Save/Email.\n${formatBriefOptions(runOptions)}`)
    : (dryRun
      ? `Preview-only request sent. This will not send email.\n${formatBriefOptions(runOptions)}`
      : `Email brief request sent. Watch the tracker; the email sends at Save/Email.\n${formatBriefOptions(runOptions)}`);
  manualBriefStartedAt = new Date().toISOString();
  setBriefButtonsRunning(true);
  renderBriefProgress({
    ok: true,
    isRunning: true,
    currentRun: {
      state: "running",
      phase: "starting",
      label: emailOnly
        ? (dryRun ? "Starting email-only preview" : "Starting email-only brief")
        : (dryRun ? "Starting manual preview" : "Starting manual email brief"),
      dryRun,
      emailOnly,
      groupBy: runOptions.groupBy,
      dateRange: {
        since: runOptions.since || "",
        until: runOptions.until || "",
        hours: runOptions.hours || ""
      },
      startedAt: manualBriefStartedAt,
      updatedAt: manualBriefStartedAt
    }
  });
  startBriefProgressPolling();

  let result = null;
  let keepPolling = false;

  try {
    const response = await fetch(briefApiUrl("/api/daily-brief/request"), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ dryRun, emailOnly, ...runOptions })
    });
    result = await response.json();

    if (!response.ok || result.error || result.ok === false) {
      briefRequestStatusEl.textContent = result.error || result.result?.message || result.message || "Manual brief request failed.";
      return;
    }

    briefRequestStatusEl.textContent = formatBriefRequestStatus(result);
    manualBriefStartedAt = result.result?.startedAt || result.startedAt || manualBriefStartedAt;
    keepPolling = true;
    await refreshBriefControls();
  } finally {
    if (!keepPolling) {
      stopBriefProgressPolling();
    }
  }
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read file.")));
    reader.readAsDataURL(file);
  });
}

function isPdfFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return type === "application/pdf" || name.endsWith(".pdf");
}

function aiDerivedSourceLines(aiDerivedFields = []) {
  const labels = {
    productName: "Product Name",
    productFamily: "Product Family",
    casNumber: "CAS",
    quantityPerPackage: "Quantity per package",
    nmfcCode: "NMFC",
    unNumber: "UN Number",
    packingGroup: "Packing Group",
    properShippingName: "Proper Shipping Name",
    freightClass: "Freight Class"
  };

  return (aiDerivedFields ?? [])
    .map((item) => {
      const field = String(item.field || "").trim();
      const value = String(item.value || "").trim();

      if (!field || field === "extractedText" || field === "documentType" || !value) {
        return "";
      }

      const label = labels[field] || field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
      return `${label}: ${value}`;
    })
    .filter(Boolean);
}

async function extractPdfSourceFile(file) {
  const response = await fetch("/api/product-document/extract", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      size: file.size,
      dataUrl: await fileToDataUrl(file)
    })
  });
  const text = await response.text();
  let result = {};

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`PDF extraction returned a non-JSON response: ${text.slice(0, 160)}`);
  }

  if (!response.ok || !result.ok) {
    throw new Error((result.warnings ?? []).join(" ") || result.error || "PDF extraction failed.");
  }

  return result;
}

async function loadSourceFiles(files = []) {
  if (!inputText) {
    return;
  }

  const chunks = [];
  const skipped = [];
  const loaded = [];
  const warnings = [];

  if (sourceFileStatusEl) {
    sourceFileStatusEl.textContent = "Reading selected SDS/TDS files...";
  }

  for (const file of files) {
    const fileName = file.name.toLowerCase();
    const canReadAsText =
      file.type.startsWith("text/") ||
      [".txt", ".md", ".csv", ".tsv", ".sds", ".tds"].some((extension) => fileName.endsWith(extension));

    if (isPdfFile(file)) {
      try {
        const extracted = await extractPdfSourceFile(file);
        const aiLines = aiDerivedSourceLines(extracted.aiDerivedFields);
        const fieldLines = aiLines.length ? `\n\nAI-derived ShelfCycle fields:\n${aiLines.join("\n")}` : "";
        chunks.push(`--- ${file.name} (${extracted.method || "pdf extraction"}) ---\n${extracted.text}${fieldLines}`);
        warnings.push(...(extracted.warnings ?? []));
        loaded.push(`${file.name} (${extracted.method || "PDF"})`);
        state.sourceFiles.push({
          fileName: file.name,
          mimeType: file.type || "application/pdf",
          size: file.size,
          extractionMethod: extracted.method || "pdf"
        });
      } catch (error) {
        skipped.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }

    if (!canReadAsText) {
      skipped.push(file.name);
      continue;
    }

    chunks.push(`--- ${file.name} ---\n${await file.text()}`);
    loaded.push(file.name);
    state.sourceFiles.push({
      fileName: file.name,
      mimeType: file.type || "text/plain",
      size: file.size,
      extractionMethod: "browser_text"
    });
  }

  if (chunks.length) {
    inputText.value = [inputText.value.trim(), chunks.join("\n\n")].filter(Boolean).join("\n\n");
  }

  if (sourceFileStatusEl) {
    sourceFileStatusEl.textContent = loaded.length
      ? `Loaded ${loaded.join(", ")}.`
      : "No source files were loaded.";
  }

  if (skipped.length) {
    warnings.push(`Skipped files: ${skipped.join("; ")}`);
  }

  if (warnings.length) {
    setOutput(warningsEl, warnings.join("\n"));
  }
}

referenceFilesInput?.addEventListener("change", async (event) => {
  const files = [...(event.target.files ?? [])];

  if (!files.length) {
    return;
  }

  await loadReferenceFiles(files);
  event.target.value = "";
});

sourceFilesInput?.addEventListener("change", async (event) => {
  const files = [...(event.target.files ?? [])];

  if (!files.length) {
    return;
  }

  await loadSourceFiles(files);
  event.target.value = "";
});

analyzeButton?.addEventListener("click", () => {
  analyze().catch((error) => {
    setOutput(warningsEl, error instanceof Error ? error.message : "Product analysis failed.");
  });
});
loadSampleButton?.addEventListener("click", loadSampleData);
exportKnowledgeButton?.addEventListener("click", exportKnowledgeBundle);
clearReferenceButton?.addEventListener("click", clearReferenceData);
refreshBriefStatusButton?.addEventListener("click", () => {
  refreshBriefControls().catch((error) => {
    exclusionListEl.textContent = error instanceof Error ? error.message : "Could not refresh brief controls.";
  });
});
addExclusionButton?.addEventListener("click", () => {
  addExclusion().catch((error) => {
    exclusionListEl.textContent = error instanceof Error ? error.message : "Could not add exclusion.";
  });
});
refreshBriefPreviewButton?.addEventListener("click", () => {
  refreshLatestBriefPreview().catch(() => {});
});
refreshHiddenNoiseButton?.addEventListener("click", () => {
  refreshHiddenNoiseCleanup().catch(() => {});
});
selectAllHiddenNoiseEl?.addEventListener("change", () => {
  for (const input of hiddenNoiseListEl?.querySelectorAll("[data-hidden-noise-thread]:not(:disabled)") ?? []) {
    input.checked = selectAllHiddenNoiseEl.checked;
  }
});
trashHiddenNoiseButton?.addEventListener("click", () => {
  trashSelectedHiddenNoise().catch((error) => {
    if (hiddenNoiseStatusEl) {
      hiddenNoiseStatusEl.textContent = error instanceof Error ? error.message : "Could not move hidden-noise emails to Gmail Trash.";
    }
  });
});
previewBriefButton?.addEventListener("click", () => requestBrief({ dryRun: true }));
sendEmailOnlyBriefButton?.addEventListener("click", () => {
  requestBrief({ dryRun: true, emailOnly: true });
});
sendBriefNowButton?.addEventListener("click", () => {
  requestBrief({ dryRun: false });
});

async function initialize() {
  configureLocalOnlyBriefControls();
  restoreReferenceData();
  await hydrateProjectIntelligence();
  saveReferenceData();
  renderReferenceStatus();
  await refreshBriefControls().catch(() => {});
  await refreshHomeDashboard().catch(() => {});
}

initialize();
