import {
  PRODUCT_AI_RESEARCH_FIELDS,
  PRODUCT_FIELD_SECTIONS,
  PRODUCT_LONG_TEXT_FIELDS,
  PRODUCT_REQUIRED_FIELDS,
  PRODUCT_REVIEW_FIELDS,
  PRODUCT_SELECT_OPTIONS,
  cleanProductWarnings,
  productDisplayLabel
} from "./product-intake-config.js";

const referenceFilesInput = document.querySelector("#reference-files");
const sourceFilesInput = document.querySelector("#source-files");
const referenceStatus = document.querySelector("#reference-status");
const workflowSelect = document.querySelector("#workflow");
const productIntakeModeSelect = document.querySelector("#product-intake-mode");
const existingProductPanel = document.querySelector("#existing-product-panel");
const existingProductTargetInput = document.querySelector("#existing-product-target");
const productTargetOptionsEl = document.querySelector("#product-target-options");
const inputText = document.querySelector("#input-text");
const analyzeButton = document.querySelector("#analyze");
const clearProductDraftButton = document.querySelector("#clear-product-draft");
const parsePastedProductTextButton = document.querySelector("#parse-pasted-product-text");
const createProductActionButton = document.querySelector("#create-product-action");
const uploadProductFileButton = document.querySelector("#upload-product-file");
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
const sourceDocumentSummaryEl = document.querySelector("#source-document-summary");
const parsedProductFieldsEl = document.querySelector("#parsed-product-fields");
const productWorkflowStatusEl = document.querySelector("#product-workflow-status");
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
const PRODUCT_INTAKE_DRAFT_KEY = "clearedge-product-intake-draft-v1";
const PRODUCT_INTAKE_DRAFT_VERSION = 1;
const PRODUCT_INTAKE_DRAFT_TEXT_LIMIT = 250000;
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
  sourceFiles: [],
  sourceDocumentText: "",
  sourceDocumentFields: {},
  sourceDocumentAiDerivedFields: [],
  sourceDocumentMissingFields: [],
  sourceDocumentNotes: [],
  sourceDocumentWarnings: [],
  latestProductAnalysis: null,
  productActionDecisions: {}
};
let briefProgressTimer = null;
let manualBriefStartedAt = "";
let briefApiBase = "";
let productDraftSaveTimer = null;

function isLocalMvpHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function isProductIntakePage() {
  return Boolean(parsedProductFieldsEl || sourceDocumentSummaryEl || productActionsEl || productIntakeModeSelect);
}

function limitedProductDraftText(value = "") {
  const text = String(value || "");
  return text.length > PRODUCT_INTAKE_DRAFT_TEXT_LIMIT ? text.slice(-PRODUCT_INTAKE_DRAFT_TEXT_LIMIT) : text;
}

function productDraftSourceFiles(files = []) {
  return (files ?? []).map((file) => ({
    fileName: file.fileName || file.name || "",
    mimeType: file.mimeType || file.type || "",
    size: file.size || 0,
    localPath: file.localPath || file.path || "",
    path: file.localPath || file.path || "",
    documentType: file.documentType || "",
    extractionMethod: file.extractionMethod || "",
    fields: file.fields ?? {},
    missingShelfCycleFields: file.missingShelfCycleFields ?? [],
    shelfCycleNotes: file.shelfCycleNotes ?? [],
    warnings: file.warnings ?? []
  }));
}

function saveProductIntakeDraft() {
  if (!isProductIntakePage()) {
    return;
  }

  if (productDraftSaveTimer) {
    window.clearTimeout(productDraftSaveTimer);
    productDraftSaveTimer = null;
  }

  const draft = {
    version: PRODUCT_INTAKE_DRAFT_VERSION,
    savedAt: new Date().toISOString(),
    workflow: workflowSelect?.value || "new_product",
    productIntakeMode: productIntakeModeSelect?.value || "create",
    existingProductTarget: existingProductTargetInput?.value || "",
    inputText: limitedProductDraftText(inputText?.value || ""),
    sourceFiles: productDraftSourceFiles(state.sourceFiles),
    sourceDocumentText: limitedProductDraftText(state.sourceDocumentText),
    sourceDocumentFields: state.sourceDocumentFields ?? {},
    sourceDocumentAiDerivedFields: state.sourceDocumentAiDerivedFields ?? [],
    sourceDocumentMissingFields: state.sourceDocumentMissingFields ?? [],
    sourceDocumentNotes: state.sourceDocumentNotes ?? [],
    sourceDocumentWarnings: state.sourceDocumentWarnings ?? [],
    latestProductAnalysis: state.latestProductAnalysis ?? null,
    productActionDecisions: state.productActionDecisions ?? {}
  };

  try {
    window.localStorage.setItem(PRODUCT_INTAKE_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    try {
      window.localStorage.setItem(PRODUCT_INTAKE_DRAFT_KEY, JSON.stringify({
        ...draft,
        sourceDocumentText: "",
        latestProductAnalysis: null
      }));
    } catch {
      // If the browser storage quota is full, keep the in-page state usable.
    }
  }
}

function scheduleProductIntakeDraftSave(delayMs = 300) {
  if (!isProductIntakePage()) {
    return;
  }

  if (productDraftSaveTimer) {
    window.clearTimeout(productDraftSaveTimer);
  }

  productDraftSaveTimer = window.setTimeout(() => {
    productDraftSaveTimer = null;
    saveProductIntakeDraft();
  }, delayMs);
}

function cancelScheduledProductIntakeDraftSave() {
  if (!productDraftSaveTimer) {
    return;
  }

  window.clearTimeout(productDraftSaveTimer);
  productDraftSaveTimer = null;
}

function clearProductIntakeDraft({ reset = true } = {}) {
  cancelScheduledProductIntakeDraftSave();
  window.localStorage.removeItem(PRODUCT_INTAKE_DRAFT_KEY);

  if (!reset) {
    return;
  }

  if (inputText) {
    inputText.value = "";
  }

  if (existingProductTargetInput) {
    existingProductTargetInput.value = "";
  }

  if (workflowSelect) {
    workflowSelect.value = "new_product";
  }

  if (productIntakeModeSelect) {
    productIntakeModeSelect.value = "create";
  }

  resetSourceDocumentState({ persist: false });
  syncProductIntakeModeUi();
  renderSourceDocumentSummary([]);
  renderParsedProductFields();
  renderProductActions({});
  renderProductWorkflowStatus({
    phase: "idle",
    message: "Saved product-intake work cleared."
  });
  setOutput(warningsEl, "");
  updateProductHeaderActions();
}

function restoreProductIntakeDraft() {
  if (!isProductIntakePage()) {
    return false;
  }

  const saved = window.localStorage.getItem(PRODUCT_INTAKE_DRAFT_KEY);

  if (!saved) {
    return false;
  }

  let draft = null;

  try {
    draft = JSON.parse(saved);
  } catch {
    window.localStorage.removeItem(PRODUCT_INTAKE_DRAFT_KEY);
    return false;
  }

  if (!draft || draft.version !== PRODUCT_INTAKE_DRAFT_VERSION) {
    return false;
  }

  if (workflowSelect && draft.workflow) {
    workflowSelect.value = draft.workflow;
  }

  if (productIntakeModeSelect && draft.productIntakeMode) {
    productIntakeModeSelect.value = draft.productIntakeMode;
  }

  if (existingProductTargetInput) {
    existingProductTargetInput.value = draft.existingProductTarget || "";
  }

  if (inputText) {
    inputText.value = draft.inputText || "";
  }

  state.sourceFiles = productDraftSourceFiles(draft.sourceFiles ?? []);
  state.sourceDocumentText = draft.sourceDocumentText || "";
  state.sourceDocumentFields = draft.sourceDocumentFields ?? {};
  state.sourceDocumentAiDerivedFields = draft.sourceDocumentAiDerivedFields ?? [];
  state.sourceDocumentMissingFields = draft.sourceDocumentMissingFields ?? [];
  state.sourceDocumentNotes = draft.sourceDocumentNotes ?? [];
  state.sourceDocumentWarnings = draft.sourceDocumentWarnings ?? [];
  state.latestProductAnalysis = draft.latestProductAnalysis ?? null;
  state.productActionDecisions = draft.productActionDecisions ?? {};

  syncProductIntakeModeUi();
  renderSourceDocumentSummary([]);
  renderParsedProductFields();

  if (state.latestProductAnalysis) {
    renderAnalysisResult(state.latestProductAnalysis, {
      message: `Restored saved product-intake work from ${new Date(draft.savedAt || Date.now()).toLocaleString()}.`
    });
  } else {
    renderProductActions({});
    renderProductWorkflowStatus({
      phase: Object.keys(state.sourceDocumentFields).length || state.sourceFiles.length || state.sourceDocumentText || inputText?.value
        ? "loaded"
        : "idle",
      message: `Restored saved product-intake work from ${new Date(draft.savedAt || Date.now()).toLocaleString()}.`
    });
  }

  if (sourceFileStatusEl) {
    sourceFileStatusEl.textContent = `Saved work restored from ${new Date(draft.savedAt || Date.now()).toLocaleString()}.`;
  }

  updateProductHeaderActions();
  return true;
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
  renderProductTargetOptions();

  if (!referenceStatus) {
    return;
  }

  const counts = Object.entries(normalizeReferenceData(state.referenceData))
    .map(([key, value]) => `<div class="stat-card"><strong>${value.length}</strong><span>${REFERENCE_LABELS[key] ?? key}</span></div>`)
    .join("");

  referenceStatus.innerHTML = counts;
}

function productReferenceLabel(product = {}) {
  return [
    product.code || product.sku || product.name || product.productName || product.label,
    product.name && product.code && product.name !== product.code ? product.name : "",
    product.family || product.productFamily ? `Family: ${product.family || product.productFamily}` : ""
  ].filter(Boolean).join(" - ");
}

function renderProductTargetOptions() {
  if (!productTargetOptionsEl) {
    return;
  }

  productTargetOptionsEl.innerHTML = (state.referenceData.products ?? [])
    .map((product) => {
      const label = productReferenceLabel(product);

      return label ? `<option value="${escapeHtml(label)}"></option>` : "";
    })
    .join("");
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

  if (result.workflow === "new_product") {
    return formatProductIntakeDraft(result);
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

function requiredProductFieldLabel(key = "") {
  return PRODUCT_REQUIRED_FIELDS.has(key) ? "required" : "";
}

function productFieldSourceNote(key = "") {
  const aiField = state.sourceDocumentAiDerivedFields.find((item) => item.field === key);

  if (aiField?.reason) {
    return `AI-derived: ${aiField.reason}`;
  }

  if (aiField?.value) {
    return "AI-derived. Verify before approval.";
  }

  return "";
}

function isUnresolvedProductFieldValue(value = "") {
  return /^(?:n\/?a|none|unknown|select|not available|not provided|not specified|not listed|not found|not known|unavailable|no data)$/i.test(String(value || "").trim());
}

function productFieldResearchButton(key = "", value = "") {
  if (!PRODUCT_AI_RESEARCH_FIELDS.has(key)) {
    return "";
  }

  const unresolved = !String(value || "").trim() || isUnresolvedProductFieldValue(value);

  return `
    <button type="button" class="mini secondary product-field-research-button${unresolved ? " attention" : ""}" data-product-research-field="${escapeHtml(key)}">
      ${unresolved ? "Research with AI" : "Re-check with AI"}
    </button>
  `;
}

function renderProductFieldControl(key = "", value = "") {
  const label = productDisplayLabel(key);
  const required = requiredProductFieldLabel(key);
  const review = !required && PRODUCT_REVIEW_FIELDS.has(key) ? "review" : "";
  const marker = required || review;
  const sourceNote = productFieldSourceNote(key);
  const commonAttrs = `data-product-field="${escapeHtml(key)}" ${required ? 'aria-required="true"' : ""}`;
  const note = sourceNote ? `<small>${escapeHtml(sourceNote)}</small>` : "";
  const researchButton = productFieldResearchButton(key, value);

  if (PRODUCT_SELECT_OPTIONS[key]) {
    const options = PRODUCT_SELECT_OPTIONS[key];
    const selectedValue = String(value || "");
    const hasCustomValue = selectedValue && !options.includes(selectedValue);
    const optionMarkup = [
      ...options,
      ...(hasCustomValue ? [selectedValue] : [])
    ].map((option) => `<option value="${escapeHtml(option)}"${option === selectedValue ? " selected" : ""}>${escapeHtml(option || "Select")}</option>`).join("");

    return `
      <div class="product-field-control">
        <label>
          <span>${escapeHtml(label)}${marker ? ` <strong class="required-marker">${escapeHtml(marker)}</strong>` : ""}</span>
          <select ${commonAttrs}>${optionMarkup}</select>
          ${note}
        </label>
        ${researchButton}
      </div>
    `;
  }

  if (PRODUCT_LONG_TEXT_FIELDS.has(key)) {
    return `
      <div class="product-field-control product-field-control-wide">
        <label>
          <span>${escapeHtml(label)}${marker ? ` <strong class="required-marker">${escapeHtml(marker)}</strong>` : ""}</span>
          <textarea ${commonAttrs}>${escapeHtml(value || "")}</textarea>
          ${note}
        </label>
        ${researchButton}
      </div>
    `;
  }

  return `
    <div class="product-field-control">
      <label>
        <span>${escapeHtml(label)}${marker ? ` <strong class="required-marker">${escapeHtml(marker)}</strong>` : ""}</span>
        <input type="text" value="${escapeHtml(value || "")}" ${commonAttrs} />
        ${note}
      </label>
      ${researchButton}
    </div>
  `;
}

function collectProductFieldEdits({ debounceSave = false } = {}) {
  if (!parsedProductFieldsEl) {
    return state.sourceDocumentFields;
  }

  const fields = {
    ...state.sourceDocumentFields
  };

  for (const input of parsedProductFieldsEl.querySelectorAll("[data-product-field]")) {
    fields[input.dataset.productField] = input.value;
  }

  state.sourceDocumentFields = fields;
  syncProductActionFieldValues(fields);
  updateProductHeaderActions();

  if (debounceSave) {
    scheduleProductIntakeDraftSave();
  } else {
    saveProductIntakeDraft();
  }

  return fields;
}

function syncProductActionFieldValues(fields = {}) {
  if (!state.latestProductAnalysis) {
    return;
  }

  const syncActions = (actions = []) => actions.map((action) => {
    if (action.actionType !== "product_create_or_update") {
      return action;
    }

    return {
      ...action,
      fieldValues: {
        ...(action.fieldValues ?? {}),
        ...fields
      }
    };
  });

  state.latestProductAnalysis = {
    ...state.latestProductAnalysis,
    proposedActions: syncActions(state.latestProductAnalysis.proposedActions ?? [])
  };

  if (state.latestProductAnalysis.reviewAction?.proposedActions) {
    state.latestProductAnalysis.reviewAction = {
      ...state.latestProductAnalysis.reviewAction,
      proposedActions: syncActions(state.latestProductAnalysis.reviewAction.proposedActions ?? [])
    };
  }
}

function upsertSourceDocumentAiField(item = {}) {
  const field = String(item.field || "").trim();
  const value = String(item.value || "").trim();

  if (!field || !value) {
    return;
  }

  state.sourceDocumentAiDerivedFields = dedupeAiFields([
    ...state.sourceDocumentAiDerivedFields.filter((existing) => existing.field !== field),
    {
      field,
      value,
      reason: String(item.reason || "Derived from AI field research.").trim()
    }
  ]);
}

async function researchProductField(field = "", button = null) {
  const fields = collectProductFieldEdits();
  const label = productDisplayLabel(field);
  const originalText = button?.textContent || "";

  if (!field) {
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Researching...";
  }

  try {
    const currentValue = fields[field] || "";
    const payload = await fetchProductJson(productApiUrl("/api/product-document/research-field"), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        field,
        currentValue,
        mode: currentValue && !isUnresolvedProductFieldValue(currentValue) ? "recheck" : "research",
        fields,
        text: [
          state.sourceDocumentText,
          inputText?.value || ""
        ].filter(Boolean).join("\n\n"),
        files: state.sourceFiles
      })
    });

    if (!payload.ok || !payload.value) {
      const warning = (payload.warnings ?? []).join(" ") || `AI research did not find a supportable ${label} value.`;
      setOutput(warningsEl, warning);
      return;
    }

    state.sourceDocumentFields = {
      ...state.sourceDocumentFields,
      [field]: payload.value
    };

    for (const item of payload.aiDerivedFields ?? []) {
      upsertSourceDocumentAiField(item);
    }

    state.sourceDocumentWarnings = cleanProductWarnings([
      ...state.sourceDocumentWarnings,
      ...(payload.warnings ?? [])
    ]);
    renderParsedProductFields();
    renderProductActions(state.latestProductAnalysis ?? {});
    updateProductHeaderActions();
    setOutput(warningsEl, `${label} filled by AI research: ${payload.value}${payload.sourceType ? ` (${payload.sourceType})` : ""}. Verify before approving ShelfCycle import.`);
    saveProductIntakeDraft();
  } catch (error) {
    setOutput(warningsEl, error instanceof Error ? error.message : `AI research failed for ${label}.`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || "Research with AI";
    }
  }
}

function productRequiredStatus(fields = {}) {
  const missing = [...PRODUCT_REQUIRED_FIELDS].filter((key) => !String(fields[key] || "").trim());
  const missingReview = [...PRODUCT_REVIEW_FIELDS].filter((key) => !String(fields[key] || "").trim() || isUnresolvedProductFieldValue(fields[key]));

  return {
    missing,
    missingReview,
    ready: missing.length === 0
  };
}

function productApprovalActions() {
  return (state.latestProductAnalysis?.proposedActions ?? state.latestProductAnalysis?.reviewAction?.proposedActions ?? [])
    .filter((action) => action.actionType === "product_create_or_update")
    .filter((action) => state.productActionDecisions[action.id] !== "deleted");
}

function firstExecutableProductAction() {
  return productApprovalActions()
    .find((action) => productActionReadyForUserApproval(action) && state.productActionDecisions[action.id] !== "skipped");
}

function productActionReadyForUserApproval(action = {}) {
  return Boolean(action.executable);
}

function hasProductIntakeInput() {
  const parsedFields = Object.values(state.sourceDocumentFields ?? {}).some((value) => String(value || "").trim());
  return Boolean(
    parsedFields ||
    state.sourceFiles.length ||
    String(state.sourceDocumentText || "").trim() ||
    String(inputText?.value || "").trim()
  );
}

function hasPastedProductText() {
  return Boolean(String(inputText?.value || "").trim());
}

function productActionBlockingReason() {
  const actions = productApprovalActions();

  if (!state.latestProductAnalysis) {
    return hasProductIntakeInput()
      ? "Run analysis to build and validate the ShelfCycle product action."
      : "Load an SDS/TDS or paste product text, then run analysis.";
  }

  if (!actions.length) {
    return "No ShelfCycle product-code action was generated. Re-run analysis after reviewing the source data.";
  }

  const skipped = actions.find((action) => state.productActionDecisions[action.id] === "skipped");
  const blocked = actions.find((action) => !action.executable) ?? skipped;
  const warnings = blocked ? formatActionWarnings(blocked) : "";

  return warnings || "Complete the editable product fields above before ShelfCycle automation can start.";
}

function updateProductHeaderActions() {
  const hasInput = hasProductIntakeInput();
  const executableAction = firstExecutableProductAction();
  const hasPastedText = hasPastedProductText();

  if (uploadProductFileButton) {
    uploadProductFileButton.disabled = !sourceFilesInput;
    uploadProductFileButton.title = sourceFilesInput
      ? "Choose SDS/TDS/PDF files for product intake."
      : "This page does not have a source file input.";
  }

  if (parsePastedProductTextButton) {
    parsePastedProductTextButton.disabled = !hasPastedText || !analyzeButton;
    parsePastedProductTextButton.title = hasPastedText
      ? "Parse the pasted text into ShelfCycle product fields."
      : "Paste SDS/TDS or product text first.";
  }

  if (createProductActionButton) {
    createProductActionButton.disabled = !executableAction;
    createProductActionButton.textContent = "Approve & Send to ShelfCycle";
    createProductActionButton.title = executableAction
      ? "Approve and run the validated ShelfCycle product automation."
      : productActionBlockingReason();
  }
}

function usefulProductFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields ?? {})
      .filter(([key, value]) => !["documentType", "extractedText"].includes(key) && String(value || "").trim())
      .map(([key, value]) => [key, String(value || "").trim()])
  );
}

function resetSourceDocumentState({ persist = true } = {}) {
  state.sourceFiles = [];
  state.sourceDocumentText = "";
  state.sourceDocumentFields = {};
  state.sourceDocumentAiDerivedFields = [];
  state.sourceDocumentMissingFields = [];
  state.sourceDocumentNotes = [];
  state.sourceDocumentWarnings = [];
  state.latestProductAnalysis = null;
  state.productActionDecisions = {};
  updateProductHeaderActions();

  if (persist) {
    saveProductIntakeDraft();
  }
}

function mergeSourceDocumentResult(result = {}) {
  const fields = usefulProductFields(result.fields ?? {});

  state.sourceDocumentFields = {
    ...state.sourceDocumentFields,
    ...fields
  };
  state.sourceDocumentAiDerivedFields = dedupeAiFields([
    ...state.sourceDocumentAiDerivedFields,
    ...(result.aiDerivedFields ?? [])
  ]);
  state.sourceDocumentMissingFields = [...new Set([
    ...state.sourceDocumentMissingFields,
    ...(result.missingShelfCycleFields ?? [])
  ].map((item) => String(item || "").trim()).filter(Boolean))];
  state.sourceDocumentNotes = [...new Set([
    ...state.sourceDocumentNotes,
    ...(result.shelfCycleNotes ?? [])
  ].map((item) => String(item || "").trim()).filter(Boolean))];
  state.sourceDocumentWarnings = [...new Set([
    ...state.sourceDocumentWarnings,
    ...(result.warnings ?? [])
  ].map((item) => String(item || "").trim()).filter(Boolean))];
  state.sourceDocumentWarnings = cleanProductWarnings(state.sourceDocumentWarnings);

  if (String(result.text || "").trim()) {
    state.sourceDocumentText = [
      state.sourceDocumentText,
      `--- ${result.fileName || "SDS/TDS source"} (${result.method || "document extraction"}) ---\n${String(result.text || "").trim()}`
    ].filter(Boolean).join("\n\n");
  }

  updateProductHeaderActions();
  saveProductIntakeDraft();
}

function dedupeAiFields(items = []) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const field = String(item?.field || "").trim();
    const value = String(item?.value || "").trim();

    if (!field || !value || ["documentType", "extractedText"].includes(field)) {
      continue;
    }

    const key = `${field}:${value}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push({
      field,
      value,
      reason: String(item?.reason || "").trim()
    });
  }

  return output;
}

function renderParsedProductFields() {
  if (!parsedProductFieldsEl) {
    return;
  }

  const fields = usefulProductFields(state.sourceDocumentFields);

  if (!Object.keys(fields).length) {
    parsedProductFieldsEl.innerHTML = '<div class="empty-state compact">Parsed ShelfCycle fields will appear here after a source file is loaded or analyzed.</div>';
    updateProductHeaderActions();
    return;
  }

  const status = productRequiredStatus({
    ...state.sourceDocumentFields,
    ...fields
  });

  parsedProductFieldsEl.innerHTML = `
    <article class="shelfcycle-form-card product-intake-review-card">
      <div class="shelfcycle-form-header">
        <div>
          <p class="section-kicker">Review/Edit Before Analyze</p>
          <h3>${escapeHtml(fields.productName || fields.code || fields.productFamily || "Product entry needs review")}</h3>
          <p class="small muted">Edit these fields before running analysis or approving ShelfCycle entry. Product-code actions use these reviewed values.</p>
        </div>
        <span class="status-pill ${status.ready ? "status-ready" : "status-review"}">${status.ready ? "Required fields present" : `${status.missing.length} required missing`}</span>
      </div>
      ${PRODUCT_FIELD_SECTIONS.map((section) => {
        const sectionFields = section.fields;

        if (!sectionFields.length) {
          return "";
        }

        return `
          <section class="product-field-section">
            <div class="product-field-section-header">
              <div>
                <strong>${escapeHtml(section.title)}</strong>
                ${section.help ? `<p>${escapeHtml(section.help)}</p>` : ""}
              </div>
            </div>
            <div class="shelfcycle-field-grid product-field-grid">
              ${sectionFields.map((key) => renderProductFieldControl(key, state.sourceDocumentFields[key] ?? fields[key] ?? "")).join("")}
            </div>
          </section>
        `;
      }).filter(Boolean).join("")}
      <div class="product-required-summary">
        ${status.missing.length
          ? `<strong>Required before product-code approval:</strong> ${status.missing.map((key) => escapeHtml(productDisplayLabel(key))).join(", ")}`
          : "<strong>Required fields are present.</strong> Review product family and package-size details before approval."}
        ${status.missingReview.length
          ? `<br><strong>Shipping/regulatory fields still blank:</strong> ${status.missingReview.map((key) => escapeHtml(productDisplayLabel(key))).join(", ")} <span class="muted">These do not block saving unless ShelfCycle requires them, but they should be reviewed from the SDS/freight data.</span>`
          : `<br><strong>Shipping/regulatory review fields are populated.</strong>`}
      </div>
    </article>
  `;

  for (const input of parsedProductFieldsEl.querySelectorAll("[data-product-field]")) {
    input.addEventListener("input", () => collectProductFieldEdits({ debounceSave: true }));
    input.addEventListener("change", () => collectProductFieldEdits());
  }

  for (const button of parsedProductFieldsEl.querySelectorAll("[data-product-research-field]")) {
    button.addEventListener("click", () => {
      researchProductField(button.dataset.productResearchField || "", button);
    });
  }

  updateProductHeaderActions();
}

function renderProductWorkflowStatus({ phase = "idle", message = "", workflowRun = null, warnings = [] } = {}) {
  if (!productWorkflowStatusEl) {
    return;
  }

  const stepStatus = {
    source: "pending",
    parse: "pending",
    review: "pending",
    approval: "pending",
    submit: "pending"
  };

  if (phase === "idle") {
    stepStatus.source = "pending";
  } else if (phase === "loading") {
    stepStatus.source = "running";
  } else if (phase === "loaded") {
    stepStatus.source = "succeeded";
    stepStatus.parse = "pending";
  } else if (phase === "analyzing") {
    stepStatus.source = "succeeded";
    stepStatus.parse = "running";
  } else if (phase === "review") {
    stepStatus.source = "succeeded";
    stepStatus.parse = "succeeded";
    stepStatus.review = "succeeded";
    stepStatus.approval = "waiting";
  } else if (phase === "error") {
    stepStatus.source = "failed";
  }

  for (const step of workflowRun?.steps ?? []) {
    const mapped = {
      receive_input: "source",
      analyze_intake: "parse",
      match_knowledge: "parse",
      draft_actions: "review",
      approval_wait: "approval",
      shelfcycle_submit: "submit"
    }[step.id];

    if (mapped) {
      stepStatus[mapped] = step.status || stepStatus[mapped];
    }
  }

  const labels = [
    ["source", "Load SDS/TDS"],
    ["parse", "Parse fields with local + ChatGPT extraction"],
    ["review", "Build Product Family + Product Code approval packet"],
    ["approval", "Wait for Sean approval"],
    ["submit", "Run ShelfCycle browser automation"]
  ];
  const recentLogs = (workflowRun?.logs ?? []).slice(-8);
  const activeShelfCycleUrl = workflowRun?.artifacts?.activeShelfCycleUrl || "";
  const manualAssist = workflowRun?.artifacts?.manualAssist ?? {};
  const terminalStatuses = new Set(["succeeded", "failed", "cancelled"]);
  const manualAssistRequested = Boolean(manualAssist.requested || manualAssist.active || workflowRun?.actionState === "manual_assist");
  const hasControllableRun = Boolean(workflowRun?.id && workflowRun?.type === "shelfcycle_action" && !terminalStatuses.has(workflowRun?.status));
  const canControlAgent = hasControllableRun;
  const canPauseAgent = canControlAgent && !manualAssistRequested && workflowRun?.status === "running";
  const canResumeAgent = canControlAgent && manualAssistRequested;
  const canCancelAgent = hasControllableRun;

  productWorkflowStatusEl.innerHTML = `
    <article class="product-workflow-card">
      <div class="product-field-section-header">
        <strong>SDS/TDS Workflow Status</strong>
        <p>${escapeHtml(message || "Load a source document, review fields, approve, then the local agent updates ShelfCycle.")}</p>
      </div>
      <div class="product-workflow-steps">
        ${labels.map(([key, label]) => `
          <div class="product-workflow-step ${escapeHtml(stepStatus[key])}">
            <span>${escapeHtml(label)}</span>
            <b>${escapeHtml(stepStatus[key].replace(/_/g, " "))}</b>
          </div>
        `).join("")}
      </div>
      ${activeShelfCycleUrl ? `
        <div class="product-agent-current">
          <strong>Active ShelfCycle page</strong>
          <a href="${escapeHtml(activeShelfCycleUrl)}" target="_blank" rel="noreferrer">${escapeHtml(activeShelfCycleUrl)}</a>
        </div>
      ` : ""}
      ${canControlAgent ? `
        <div class="product-agent-current">
          <strong>Manual Assist</strong>
          <p>${escapeHtml(manualAssist.message || (manualAssistRequested
            ? "Agent is paused or waiting to pause. Make the ShelfCycle selection, then click Resume."
            : "Use Pause if the visible ShelfCycle agent needs you to pick a dropdown or fix a field."))}</p>
          <div class="brief-action-links">
            <button class="ghost mini" type="button" data-product-workflow-command="pause" data-workflow-run-id="${escapeHtml(workflowRun.id)}"${canPauseAgent ? "" : " disabled"}>Pause for Manual Assist</button>
            <button class="primary mini" type="button" data-product-workflow-command="resume" data-workflow-run-id="${escapeHtml(workflowRun.id)}"${canResumeAgent ? "" : " disabled"}>Resume Agent</button>
            <button class="ghost mini danger" type="button" data-product-workflow-command="cancel" data-workflow-run-id="${escapeHtml(workflowRun.id)}"${canCancelAgent ? "" : " disabled"}>Cancel Agent Run</button>
          </div>
        </div>
      ` : ""}
      ${recentLogs.length ? `
        <div class="product-agent-log">
          <strong>Visible agent navigation</strong>
          <ol>
            ${recentLogs.map((log) => `
              <li>
                <span>${escapeHtml(new Date(log.at || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }))}</span>
                ${escapeHtml(log.message || "")}
                ${log.detail?.currentUrl ? `<small>${escapeHtml(log.detail.currentUrl)}</small>` : ""}
              </li>
            `).join("")}
          </ol>
        </div>
      ` : ""}
      ${warnings.length ? `<div class="shelfcycle-warning-box"><strong>Extraction warnings</strong><ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
    </article>
  `;

  productWorkflowStatusEl.removeEventListener("click", handleProductWorkflowControl);
  productWorkflowStatusEl.addEventListener("click", handleProductWorkflowControl);
}

function renderSourceDocumentSummary(loaded = []) {
  if (!sourceDocumentSummaryEl) {
    return;
  }

  if (!loaded.length && !state.sourceFiles.length) {
    sourceDocumentSummaryEl.innerHTML = '<div class="empty-state compact">No SDS/TDS source loaded yet.</div>';
    return;
  }

  const files = state.sourceFiles.length
    ? state.sourceFiles
    : loaded.map((fileName) => ({ fileName }));
  const cards = files
    .map((file, index) => {
      const fileName = file.fileName || file.name || `Document ${index + 1}`;
      const localPath = file.localPath || file.path || "";
      const isSelectedSds = localPath && state.sourceDocumentFields.sdsPath === localPath;

      return `
      <article class="source-document-card">
        <strong>${escapeHtml(fileName)}</strong>
        <span>${Object.keys(state.sourceDocumentFields).length ? "Structured family and product-code fields parsed. Review before approving ShelfCycle changes." : "Loaded for analysis. Click Analyze Product Document to extract ShelfCycle family/code fields."}</span>
        ${localPath ? `
          <small>${escapeHtml(localPath)}</small>
          <button class="ghost mini" type="button" data-use-sds-path="${escapeHtml(localPath)}">
            ${isSelectedSds ? "Selected for SDS upload" : "Use for SDS upload"}
          </button>
        ` : ""}
      </article>
    `;
    })
    .join("");

  sourceDocumentSummaryEl.innerHTML = cards;

  for (const button of sourceDocumentSummaryEl.querySelectorAll("[data-use-sds-path]")) {
    button.addEventListener("click", () => {
      state.sourceDocumentFields = {
        ...state.sourceDocumentFields,
        sdsPath: button.dataset.useSdsPath || "",
        documentType: state.sourceDocumentFields.documentType || "SDS"
      };
      renderSourceDocumentSummary([]);
      renderParsedProductFields();
      if (sourceFileStatusEl) {
        sourceFileStatusEl.textContent = "SDS upload file path selected for the ShelfCycle product-code action.";
      }
      saveProductIntakeDraft();
    });
  }
}

function fieldLine(fields = {}, key = "") {
  const value = String(fields[key] || "").trim();
  return value ? `- ${productDisplayLabel(key)}: ${value}` : "";
}

function formatProductIntakeDraft(result = {}) {
  const fields = result.fields ?? {};
  const requirements = result.shelfCycleRequirements ?? {};
  const missing = requirements.missingRequiredFields ?? [];
  const missingReview = requirements.missingReviewFields ?? [];
  const updateTarget = result.productUpdateTarget?.label || result.productUpdateTarget?.id || "";
  const sections = [];

  sections.push([
    "ShelfCycle Product Intake",
    `- Product-code action: ${result.productIntakeMode === "update" ? "Update existing product code" : "Create new product code"}`,
    updateTarget ? `- Existing product-code target: ${updateTarget}` : "",
    fields.shelfCycleReadySummary ? `- Summary: ${fields.shelfCycleReadySummary}` : "",
    `- Document type: ${result.documentType || fields.documentType || "SDS/TDS"}`,
    `- ShelfCycle status: ${requirements.readyForProductCodeCreate ? "Required fields present for review" : "Missing required fields before product-code creation"}`
  ].filter(Boolean).join("\n"));

  sections.push([
    "Make or update Product Family (chemical/material identity)",
    fieldLine(fields, "productFamily"),
    fieldLine(fields, "chemicalName"),
    fieldLine(fields, "productFamilyDescription"),
    fieldLine(fields, "aliases"),
    fieldLine(fields, "casNumber"),
    fieldLine(fields, "recommendedUse")
  ].filter(Boolean).join("\n"));

  sections.push([
    "Make or update Product Codes (package/SKU records)",
    result.matches?.product?.length ? "- Existing family/product match found: reuse family-level identity; only change package-specific fields for the new code." : "",
    fieldLine(fields, "code"),
    fieldLine(fields, "productName"),
    fieldLine(fields, "packagingType"),
    fieldLine(fields, "packaging"),
    fieldLine(fields, "quantityPerPackage"),
    fieldLine(fields, "unitOfMeasure"),
    fieldLine(fields, "supplierType"),
    fieldLine(fields, "supplier"),
    result.proposedActions?.find((action) => action.actionType === "product_create_or_update")?.fieldValues?.reuseGuidance
      ? `- Reuse guidance: ${result.proposedActions.find((action) => action.actionType === "product_create_or_update").fieldValues.reuseGuidance}`
      : ""
  ].filter(Boolean).join("\n"));

  sections.push([
    "Safety, shipping, and logistics",
    fieldLine(fields, "unNumber"),
    fieldLine(fields, "packingGroup"),
    fieldLine(fields, "hazardClass"),
    fieldLine(fields, "specialDesignation"),
    fieldLine(fields, "properShippingName"),
    fieldLine(fields, "signalWord"),
    fieldLine(fields, "hazardSymbols"),
    fieldLine(fields, "nmfcCode"),
    fieldLine(fields, "freightClass"),
    fieldLine(fields, "pallet"),
    fieldLine(fields, "packagesPerPallet")
  ].filter(Boolean).join("\n"));

  if (missing.length) {
    sections.push([
      "Missing before ShelfCycle product-code creation",
      ...missing.map((item) => `- ${item.label || item.key}: ${item.message || "Required by ShelfCycle."}`)
    ].join("\n"));
  }

  if (missingReview.length) {
    sections.push([
      "Shipping/regulatory fields still needing review",
      ...missingReview.map((item) => `- ${item.label || item.key}: ${item.message || "Review if available before first shipment."}`)
    ].join("\n"));
  }

  if ((result.aiDerivedFields ?? []).length) {
    sections.push([
      "AI-derived fields to verify",
      ...result.aiDerivedFields
        .filter((item) => item.field && item.value && !["documentType", "extractedText"].includes(item.field))
        .map((item) => `- ${productDisplayLabel(item.field)}: ${item.value}${item.reason ? ` (${item.reason})` : ""}`)
    ].join("\n"));
  }

  if ((result.shelfCycleNotes ?? []).length) {
    sections.push([
      "ShelfCycle notes",
      ...result.shelfCycleNotes.map((item) => `- ${item}`)
    ].join("\n"));
  }

  return sections.filter(Boolean).join("\n\n");
}

function formatWritePlan(result = {}) {
  if (result.workflow !== "new_product") {
    return JSON.stringify(result.writePlan, null, 2);
  }

  const plan = result.writePlan ?? {};
  const fields = plan.fields ?? result.fields ?? {};
  const missing = plan.missingRequiredFields ?? result.shelfCycleRequirements?.missingRequiredFields?.map((item) => item.message || item.label) ?? [];
  const missingReview = plan.missingReviewFields ?? result.shelfCycleRequirements?.missingReviewFields?.map((item) => item.message || item.label) ?? [];

  return [
    `Destination: ${plan.destination || "Products > New Product Code"}`,
    `Product-code action: ${result.productIntakeMode === "update" ? "Update existing product code" : "Create new product code"}`,
    result.productUpdateTarget?.label || result.productUpdateTarget?.id
      ? `Existing product-code target: ${result.productUpdateTarget.label || result.productUpdateTarget.id}`
      : "",
    `Ready for product-code action: ${plan.readyForProductCodeCreate ? "yes" : "no"}`,
    missing.length ? `Missing required fields:\n${missing.map((item) => `- ${item}`).join("\n")}` : "Missing required fields: none detected",
    missingReview.length ? `Shipping/regulatory fields still needing review:\n${missingReview.map((item) => `- ${item}`).join("\n")}` : "Shipping/regulatory review fields: populated or not applicable",
    "",
    "Fields that will be reviewed:",
    ...Object.entries(fields)
      .filter(([, value]) => String(value || "").trim())
      .map(([key, value]) => `- ${productDisplayLabel(key)}: ${value}`),
    "",
    "Document handling:",
    ...(plan.attachments ?? []).map((item) => `- ${item}`)
  ].filter((line) => line !== null && line !== undefined).join("\n");
}

function formatSuggestedCreatesForOutput(result = {}) {
  const creates = result.suggestedCreates ?? [];

  if (!creates.length) {
    return "None";
  }

  return creates
    .map((item) => {
      const label = item.name || item.companyName || item.productName || item.code || "Review manually";
      const type = item.type || "record";
      return `- ${type}: ${label}`;
    })
    .join("\n");
}

function formatActionWarnings(action = {}) {
  return (action.warnings ?? []).filter(Boolean).join(" ");
}

function reviewActionCredentials(result = {}) {
  const reviewUrl = result.reviewUrl || result.reviewAction?.reviewUrl || "";

  try {
    const url = new URL(reviewUrl, window.location.href);
    return {
      reviewActionId: url.searchParams.get("id") || result.reviewAction?.id || "",
      token: url.searchParams.get("token") || ""
    };
  } catch {
    return {
      reviewActionId: result.reviewAction?.id || "",
      token: ""
    };
  }
}

function productApiUrl(path = "") {
  return isLocalMvpHost() ? path : `${LOCAL_MVP_API_BASE}${path}`;
}

function analyzeApiUrlForWorkflow(workflow = "") {
  return workflow === "new_product" ? productApiUrl("/api/analyze") : "/api/analyze";
}

async function fetchProductJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {
      ok: false,
      error: text
    };
  }

  if (!response.ok) {
    const message = payload.error?.message || payload.message || payload.error || `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return payload;
}

function productActionFieldsForSubmit(action = {}) {
  const editedFields = collectProductFieldEdits();
  const fields = {
    ...(action.fieldValues ?? {}),
    ...editedFields
  };

  fields.sdsPath = editedFields.sdsPath || action.fieldValues?.sdsPath || state.sourceFiles.find((file) => file.localPath || file.path)?.localPath || "";
  fields.documentType = editedFields.documentType || action.fieldValues?.documentType || "SDS";
  return fields;
}

function setProductActionStatus(actionId = "", message = "", { error = false } = {}) {
  const escapedActionId = window.CSS?.escape
    ? window.CSS.escape(actionId)
    : String(actionId).replace(/"/g, '\\"');
  const statusEl = productActionsEl?.querySelector(`[data-product-action-status="${escapedActionId}"]`);

  if (statusEl) {
    statusEl.textContent = message;
    statusEl.className = error ? "text-block danger-text" : "text-block";
  }
}

function formatInlineWorkflowProgress(run = null) {
  if (!run) {
    return "Starting ShelfCycle workflow...";
  }

  const currentStep = (run.steps ?? []).find((step) => step.id === run.currentStepId);
  const logs = (run.logs ?? []).slice(-8);
  const manualAssist = run.artifacts?.manualAssist ?? {};
  return [
    `Workflow: ${run.status || "running"}`,
    currentStep ? `Current step: ${currentStep.label} - ${currentStep.status}${currentStep.detail ? ` - ${currentStep.detail}` : ""}` : "",
    manualAssist.requested || manualAssist.active
      ? `Manual Assist: ${manualAssist.active ? "paused" : "requested"}${manualAssist.label ? ` at ${manualAssist.label}` : ""}`
      : "",
    run.artifacts?.activeShelfCycleUrl ? `Active ShelfCycle page: ${run.artifacts.activeShelfCycleUrl}` : "",
    logs.length ? "Visible agent navigation:" : "",
    ...logs.map((log) => {
      const time = log.at ? new Date(log.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "";
      return `- ${time ? `${time}: ` : ""}${log.message || ""}${log.detail?.currentUrl ? `\n  ${log.detail.currentUrl}` : ""}`;
    }),
    ...(run.steps ?? []).map((step) => `- ${step.status}: ${step.label}${step.detail ? ` - ${step.detail}` : ""}`)
  ].filter(Boolean).join("\n");
}

async function updateWorkflowManualAssist(runId = "", command = "") {
  if (!runId || !command) {
    return null;
  }

  const payload = await fetchProductJson(productApiUrl("/api/workflows/manual-assist"), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ runId, command })
  });

  renderProductWorkflowStatus({
    phase: "review",
    message: command === "pause"
      ? "Manual assist requested. The agent will pause at the next safe ShelfCycle checkpoint."
      : command === "cancel"
        ? "ShelfCycle agent run cancelled. If the ShelfCycle browser is still open, close it manually or leave it idle."
        : "Manual assist resumed. The agent can continue.",
    workflowRun: payload.run ?? null,
    warnings: []
  });

  return payload.run ?? null;
}

async function handleProductWorkflowControl(event) {
  const button = event.target.closest("[data-product-workflow-command]");

  if (!button) {
    return;
  }

  const command = button.dataset.productWorkflowCommand || "";
  const runId = button.dataset.workflowRunId || "";

  if (command === "cancel" && !window.confirm("Cancel this ShelfCycle agent run? This stops tracking/automation for the current run. If the ShelfCycle browser is open, close it manually or leave it idle.")) {
    return;
  }

  button.disabled = true;

  try {
    await updateWorkflowManualAssist(runId, command);
  } catch (error) {
    renderProductWorkflowStatus({
      phase: "error",
      message: error instanceof Error ? error.message : "Could not update manual assist state.",
      workflowRun: null,
      warnings: []
    });
  }
}

async function restoreActiveShelfCycleWorkflowStatus() {
  if (!productWorkflowStatusEl) {
    return false;
  }

  try {
    const payload = await fetchProductJson(productApiUrl("/api/workflows/runs?type=shelfcycle_action&limit=5"));
    const runs = payload.runs ?? [];
    const activeRun = runs.find((run) => {
      const manualAssist = run.artifacts?.manualAssist ?? {};

      return !["succeeded", "failed", "cancelled"].includes(run.status) &&
        (run.status === "running" || manualAssist.requested || manualAssist.active || run.actionState === "manual_assist");
    });

    if (!activeRun) {
      return false;
    }

    const manualAssist = activeRun.artifacts?.manualAssist ?? {};
    renderProductWorkflowStatus({
      phase: "review",
      message: manualAssist.requested || manualAssist.active || activeRun.actionState === "manual_assist"
        ? "ShelfCycle agent is paused for Manual Assist. Fix the visible ShelfCycle field, then click Resume Agent."
        : "ShelfCycle agent is still running. Keep this page open to track progress.",
      workflowRun: activeRun,
      warnings: []
    });
    return true;
  } catch {
    return false;
  }
}

async function pollInlineProductWorkflow(workflowRunId = "", actionId = "") {
  let deadline = Date.now() + 10 * 60 * 1000;
  let latestRun = null;

  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
    const payload = await fetchProductJson(productApiUrl(`/api/workflows/run?id=${encodeURIComponent(workflowRunId)}`));
    latestRun = payload.run ?? null;
    setProductActionStatus(actionId, formatInlineWorkflowProgress(latestRun));
    renderProductWorkflowStatus({
      phase: "review",
      message: latestRun?.status === "running" ? "ShelfCycle automation is running." : "ShelfCycle automation status updated.",
      workflowRun: latestRun,
      warnings: []
    });

    const manualAssist = latestRun?.artifacts?.manualAssist ?? {};
    if (manualAssist.requested || manualAssist.active || latestRun?.actionState === "manual_assist") {
      deadline = Math.max(deadline, Date.now() + 30 * 60 * 1000);
    }

    if (latestRun?.status === "succeeded") {
      return latestRun;
    }

    if (latestRun?.status === "failed") {
      throw new Error(latestRun.error || "ShelfCycle automation failed.");
    }

    if (latestRun?.status === "cancelled") {
      throw new Error("ShelfCycle automation was cancelled.");
    }
  }

  throw new Error("ShelfCycle automation did not finish before the tracker timed out.");
}

async function approveInlineProductAction(actionId = "") {
  const result = state.latestProductAnalysis;
  const action = (result?.proposedActions ?? result?.reviewAction?.proposedActions ?? [])
    .find((item) => item.id === actionId);

  if (!result || !action) {
    throw new Error("Run product analysis before approving a ShelfCycle action.");
  }

  if (!action.executable) {
    throw new Error(formatActionWarnings(action) || "This product action is not executable yet.");
  }

  const { reviewActionId, token } = reviewActionCredentials(result);

  if (!reviewActionId || !token) {
    throw new Error("Product approval packet is missing its local review id or token. Re-run Analyze Product Document.");
  }

  const fields = productActionFieldsForSubmit(action);
  const confirmed = window.confirm(
    `Run this ShelfCycle product action?\n\n${action.displayLabel || action.actionType}\nProduct code: ${fields.code || "-"}\nProduct family: ${fields.productFamily || "-"}\nSDS path: ${fields.sdsPath || "-"}\n\nThis will write to ShelfCycle after approval.`
  );

  if (!confirmed) {
    setProductActionStatus(actionId, "Approval cancelled.");
    return;
  }

  setProductActionStatus(actionId, "Starting visible ShelfCycle agent. Watch the browser window; navigation progress will update here.");
  renderProductWorkflowStatus({
    phase: "review",
    message: "Visible ShelfCycle browser automation is starting. Keep this page open to watch progress.",
    workflowRun: null,
    warnings: []
  });
  const payload = await fetchProductJson(productApiUrl("/api/shelfcycle/submit-action"), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      reviewActionId,
      token,
      actionId: action.id,
      actionType: action.actionType,
      selectedTarget: action.selectedTarget ?? null,
      fields,
      approvals: {
        productFamily: true,
        packageSize: true
      },
      async: true,
      visibleAgent: true,
      approvedByUser: true
    })
  });

  if (payload.accepted && payload.workflowRunId) {
    setProductActionStatus(actionId, "ShelfCycle agent started. The browser should open or come forward; tracking Product Family and Product Code entry...");
    const run = await pollInlineProductWorkflow(payload.workflowRunId, actionId);
    setProductActionStatus(actionId, `Completed. Verify in ShelfCycle.\n${formatInlineWorkflowProgress(run)}`);
    state.productActionDecisions[actionId] = "approved";
    updateProductHeaderActions();
    saveProductIntakeDraft();
    return;
  }

  setProductActionStatus(actionId, payload.message || "ShelfCycle action submitted.");
  state.productActionDecisions[actionId] = "approved";
  updateProductHeaderActions();
  saveProductIntakeDraft();
}

function handleProductActionCommand(event) {
  const button = event.target.closest("[data-product-action-command]");

  if (!button) {
    return;
  }

  const actionId = button.dataset.productActionId || "";
  const command = button.dataset.productActionCommand || "";

  if (!actionId || !command) {
    return;
  }

  if (command === "skip") {
    state.productActionDecisions[actionId] = "skipped";
    renderProductActions(state.latestProductAnalysis ?? {});
    saveProductIntakeDraft();
    return;
  }

  if (command === "delete") {
    state.productActionDecisions[actionId] = "deleted";
    renderProductActions(state.latestProductAnalysis ?? {});
    saveProductIntakeDraft();
    return;
  }

  if (command === "approve") {
    button.disabled = true;
    approveInlineProductAction(actionId)
      .catch((error) => {
        setProductActionStatus(actionId, error instanceof Error ? error.message : "ShelfCycle approval failed.", { error: true });
      })
      .finally(() => {
        button.disabled = false;
        updateProductHeaderActions();
      });
  }
}

function renderProductActions(result = {}) {
  if (!productActionsEl) {
    return;
  }

  state.latestProductAnalysis = result?.workflow ? result : null;
  const actions = productApprovalActions();

  if (!actions.length) {
    productActionsEl.innerHTML = `
      <article class="brief-action-card">
        <p class="muted">No ShelfCycle product-code action is currently queued. Analyze an SDS/TDS workflow or restore a deleted action by re-running analysis.</p>
      </article>
    `;
    updateProductHeaderActions();
    return;
  }

  productActionsEl.innerHTML = actions
    .map((action) => {
      const decision = state.productActionDecisions[action.id] || "";
      const fields = {
        ...(action.fieldValues ?? {}),
        ...(state.sourceDocumentFields ?? {})
      };
      const status = action.executable ? "Action ready" : "Needs required fields";
      const target = action.selectedTarget?.label || fields.productName || fields.code || "No product-code target selected";
      const canApprove = Boolean(action.executable);
      const aiDerivedCount = (action.fieldValues?.aiDerivedFields ?? result.aiDerivedFields ?? [])
        .filter((item) => item?.field && item?.value && !["documentType", "extractedText"].includes(item.field))
        .length;
      const warnings = formatActionWarnings(action);
      const currentSummary = [
        fields.productFamily ? `Family: ${fields.productFamily}` : "",
        fields.code ? `Code: ${fields.code}` : "",
        fields.packaging ? `Package: ${fields.packaging}` : "",
        fields.quantityPerPackage || fields.unitOfMeasure
          ? `Qty: ${[fields.quantityPerPackage, fields.unitOfMeasure].filter(Boolean).join(" ")}`
          : ""
      ].filter(Boolean).join(" | ");
      const actionControls = decision === "skipped"
        ? `
          <button class="ghost mini" type="button" data-product-action-command="approve" data-product-action-id="${escapeHtml(action.id)}"${canApprove ? "" : " disabled"}>Approve Anyway</button>
          <button class="danger mini" type="button" data-product-action-command="delete" data-product-action-id="${escapeHtml(action.id)}">Delete</button>
        `
        : `
          <button class="primary mini" type="button" data-product-action-command="approve" data-product-action-id="${escapeHtml(action.id)}"${canApprove ? "" : " disabled"}>Approve & Send to ShelfCycle</button>
          <button class="ghost mini" type="button" data-product-action-command="skip" data-product-action-id="${escapeHtml(action.id)}">Skip</button>
          <button class="danger mini" type="button" data-product-action-command="delete" data-product-action-id="${escapeHtml(action.id)}">Delete</button>
        `;

      return `
        <article class="brief-action-card">
          <p class="brief-kicker">${escapeHtml(decision === "skipped" ? "Skipped" : status)}</p>
          <h3>${escapeHtml(action.displayLabel || action.actionType || "ShelfCycle action")}</h3>
          <p><strong>Target:</strong> ${escapeHtml(target)}</p>
          ${currentSummary ? `<p class="small muted">${escapeHtml(currentSummary)}</p>` : ""}
          <p class="small muted">The editable Product Family and Product Code fields above are the approval screen. This action uses the current values in those fields when you click approve.</p>
          ${warnings ? `<p><strong>Warnings:</strong> ${escapeHtml(warnings)}</p>` : ""}
          ${aiDerivedCount ? `<p class="small muted">${escapeHtml(String(aiDerivedCount))} AI-derived field(s) are available in the editable product setup above.</p>` : ""}
          <div class="brief-action-links">${actionControls}</div>
          <pre class="text-block" data-product-action-status="${escapeHtml(action.id)}">${decision === "skipped" ? "Skipped. This action will not run unless you approve it anyway." : (canApprove ? "Ready. Approval here starts local ShelfCycle automation using the current editable fields above." : productActionBlockingReason())}</pre>
        </article>
      `;
    })
    .join("");

  productActionsEl.removeEventListener("click", handleProductActionCommand);
  productActionsEl.addEventListener("click", handleProductActionCommand);
  updateProductHeaderActions();
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

function productIdFromShelfCycleUrl(value = "") {
  const match = String(value || "").match(/\/products\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function productLabelFromTargetInput(value = "") {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  if (/^https?:\/\//i.test(text)) {
    return "";
  }

  return text.replace(/\s+-\s+Family:.+$/i, "").trim();
}

function selectedProductUpdateTarget() {
  if (productIntakeModeSelect?.value !== "update") {
    return null;
  }

  const raw = existingProductTargetInput?.value?.trim() || "";
  const id = productIdFromShelfCycleUrl(raw);
  const label = productLabelFromTargetInput(raw);

  if (!id && !label) {
    return null;
  }

  return {
    kind: "product",
    id,
    label: label || id,
    confidence: id ? 1 : 0.92,
    matchReasons: [id ? "user pasted ShelfCycle product URL" : "user selected existing ShelfCycle product for SDS/TDS update"]
  };
}

function syncProductIntakeModeUi() {
  const updateMode = productIntakeModeSelect?.value === "update";

  if (existingProductPanel) {
    existingProductPanel.hidden = !updateMode;
  }

  if (workflowSelect && updateMode) {
    workflowSelect.value = "new_product";
  }
}

function renderAnalysisResult(result = {}, { message = "" } = {}) {
  if (!result?.workflow) {
    return;
  }

  workflowChip.textContent = `${result.workflow} (${Math.round((result.confidence ?? 0) * 100)}%)`;
  workflowChip.className = "chip active";
  setOutput(signalsEl, (result.signals ?? []).join("\n"));
  setOutput(writePlanEl, formatWritePlan(result));
  setOutput(draftEl, formatDraft(result));
  renderIntelligenceContext(result);
  setOutput(matchesEl, formatMatches(result.matches));
  setOutput(warningsEl, (result.warnings ?? []).join("\n"));
  setOutput(suggestedCreatesEl, formatSuggestedCreatesForOutput(result));
  setOutput(followUpDraftEl, formatFollowUpDraft(result.followUpDraft));
  setOutput(roleWorklistsEl, formatRoleWorklists(result.roleWorklists));
  renderProductActions(result);
  renderProductWorkflowStatus({
    phase: "review",
    message: message || (result.reviewUrl
      ? "Review packet is ready. Product Family and Product Code run in the same approved ShelfCycle workflow."
      : "Product fields were parsed. Review required fields before approval."),
    workflowRun: result.workflowRun,
    warnings: result.warnings ?? []
  });
  setOutput(automationIdeasEl, [
    result.workflowRunId ? `Workflow run: ${result.workflowRunId}` : "",
    result.workflowRun?.status ? `Workflow status: ${result.workflowRun.status}` : "",
    ...((result.workflowRun?.steps ?? []).map((step) => `- ${step.status}: ${step.label}${step.detail ? ` - ${step.detail}` : ""}`)),
    ...((result.automationIdeas ?? []).map((item) => `- ${item}`))
  ].filter(Boolean).join("\n"));
}

async function analyze() {
  if (!inputText || !workflowSelect) {
    return;
  }

  collectProductFieldEdits();
  const isProductWorkflow = workflowSelect.value === "new_product";
  renderProductWorkflowStatus({
    phase: "analyzing",
    message: isProductWorkflow && !isLocalMvpHost()
      ? "Sending SDS/TDS analysis to the local ClearEdge runner so the same packet can start the visible ShelfCycle desktop agent."
      : "Analyzing SDS/TDS data and building Product Family plus Product Code approval actions."
  });
  const productUpdateTarget = selectedProductUpdateTarget();

  if (productIntakeModeSelect?.value === "update" && !productUpdateTarget) {
    throw new Error("Update existing product-code mode requires an exact ShelfCycle product code/name or product URL.");
  }

  const aiLines = aiDerivedSourceLines(state.sourceDocumentAiDerivedFields);
  const structuredFieldLines = aiDerivedSourceLines(
    Object.entries(usefulProductFields(state.sourceDocumentFields)).map(([field, value]) => ({
      field,
      value,
      reason: "Parsed from uploaded SDS/TDS source."
    }))
  );
  const sourceText = [
    inputText.value.trim(),
    state.sourceDocumentText,
    structuredFieldLines.length ? `Structured ShelfCycle fields parsed from uploaded SDS/TDS:\n${structuredFieldLines.join("\n")}` : "",
    aiLines.length ? `AI-derived ShelfCycle fields:\n${aiLines.join("\n")}` : ""
  ].filter(Boolean).join("\n\n");

  const payload = {
    text: sourceText,
    workflow: workflowSelect.value,
    referenceData: state.referenceData,
    files: state.sourceFiles,
    productIntakeMode: productIntakeModeSelect?.value || "create",
    productUpdateTarget,
    productDocument: {
      fields: state.sourceDocumentFields,
      aiDerivedFields: state.sourceDocumentAiDerivedFields,
      missingShelfCycleFields: state.sourceDocumentMissingFields,
      shelfCycleNotes: state.sourceDocumentNotes,
      warnings: state.sourceDocumentWarnings
    },
    useAi: workflowSelect.value === "new_product"
  };

  let response = null;

  try {
    response = await fetch(analyzeApiUrlForWorkflow(workflowSelect.value), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (isProductWorkflow && !isLocalMvpHost()) {
      throw new Error("Product ShelfCycle automation requires the local ClearEdge runner at http://localhost:4318. Start or restart the local runner, then run Analyze Product Document again so the local agent owns the review packet.");
    }

    throw error;
  }

  const responseText = await response.text();
  let result = {};

  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(`Analyze returned a non-JSON response: ${responseText.slice(0, 180)}`);
  }

  if (!response.ok) {
    renderProductWorkflowStatus({
      phase: "error",
      message: result.error || result.message || "Analyze request failed.",
      warnings: result.warnings ?? []
    });
    throw new Error(result.error || result.message || "Analyze request failed.");
  }

  if (result.workflow === "new_product") {
    state.sourceDocumentFields = {
      ...state.sourceDocumentFields,
      ...usefulProductFields(result.fields ?? {})
    };
    state.sourceDocumentAiDerivedFields = dedupeAiFields([
      ...state.sourceDocumentAiDerivedFields,
      ...(result.aiDerivedFields ?? [])
    ]);
    state.sourceDocumentMissingFields = result.missingShelfCycleFields ?? state.sourceDocumentMissingFields;
    state.sourceDocumentNotes = result.shelfCycleNotes ?? state.sourceDocumentNotes;
    renderParsedProductFields();
    renderSourceDocumentSummary([]);
  }

  renderAnalysisResult(result);
  saveProductIntakeDraft();
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
  const body = JSON.stringify({
    fileName: file.name,
    mimeType: file.type || "application/pdf",
    size: file.size,
    dataUrl: await fileToDataUrl(file),
    forceAi: true
  });
  const request = {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body
  };
  let response = await fetch("/api/product-document/extract", request);
  let text = await response.text();
  let result = {};
  let retriedLocal = false;

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    if (!isLocalMvpHost()) {
      response = await fetch(`${LOCAL_MVP_API_BASE}/api/product-document/extract`, request);
      retriedLocal = true;
      text = await response.text();

      try {
        result = text ? JSON.parse(text) : {};
      } catch {
        throw new Error("Hosted PDF extraction returned HTML and the local ClearEdge backend did not return JSON. Open http://localhost:4318/product-intake.html, or redeploy the hosted product-document function.");
      }
    } else {
      throw new Error("Local PDF extraction endpoint returned HTML instead of JSON. Restart the local ClearEdge backend and try again.");
    }
  }

  if ((!response.ok || !result.ok) && !retriedLocal && !isLocalMvpHost()) {
    try {
      const localResponse = await fetch(`${LOCAL_MVP_API_BASE}/api/product-document/extract`, request);
      const localText = await localResponse.text();
      const localResult = localText ? JSON.parse(localText) : {};

      if (localResponse.ok && localResult.ok) {
        return {
          ...localResult,
          source: localResult.source || "local_fallback",
          hostedFallback: true,
          warnings: cleanProductWarnings(localResult.warnings ?? [])
        };
      }
    } catch {
      // Keep the hosted error below; it usually explains whether local retry is required.
    }
  }

  if (!response.ok || !result.ok) {
    const details = [
      ...(result.warnings ?? []),
      result.message || "",
      result.retryLocal && !isLocalMvpHost() ? "Try the local app for large/scanned PDFs: http://localhost:4318/product-intake.html" : ""
    ].filter(Boolean).join(" ");
    throw new Error(details || result.error || "PDF extraction failed.");
  }

  return result;
}

async function loadSourceFiles(files = []) {
  if (!inputText) {
    return;
  }

  const skipped = [];
  const loaded = [];
  const warnings = [];
  resetSourceDocumentState();
  renderSourceDocumentSummary([]);
  renderParsedProductFields();
  renderProductWorkflowStatus({
    phase: "loading",
    message: "Reading SDS/TDS source files and extracting product fields."
  });

  if (sourceFileStatusEl) {
    sourceFileStatusEl.textContent = "Parsing selected SDS/TDS files into ShelfCycle fields...";
  }

  for (const file of files) {
    const fileName = file.name.toLowerCase();
    const canReadAsText =
      file.type.startsWith("text/") ||
      [".txt", ".md", ".csv", ".tsv", ".sds", ".tds"].some((extension) => fileName.endsWith(extension));

    if (isPdfFile(file)) {
      try {
        const extracted = await extractPdfSourceFile(file);
        mergeSourceDocumentResult(extracted);
        warnings.push(...cleanProductWarnings(extracted.warnings ?? []));
        loaded.push(`${file.name} (${extracted.method || "PDF"})`);
        const extractedDocumentType = extracted.fields?.documentType || (/sds/i.test(file.name) ? "SDS" : "");
        if (extracted.localPath && (!state.sourceDocumentFields.sdsPath || extractedDocumentType === "SDS")) {
          state.sourceDocumentFields = {
            ...state.sourceDocumentFields,
            sdsPath: extracted.localPath,
            documentType: extractedDocumentType || state.sourceDocumentFields.documentType || "SDS"
          };
        }
        state.sourceFiles.push({
          fileName: file.name,
          mimeType: file.type || "application/pdf",
          size: file.size,
          localPath: extracted.localPath || "",
          path: extracted.localPath || "",
          documentType: extracted.fields?.documentType || "",
          extractionMethod: extracted.method || "pdf",
          fields: usefulProductFields(extracted.fields ?? {}),
          missingShelfCycleFields: extracted.missingShelfCycleFields ?? [],
          shelfCycleNotes: extracted.shelfCycleNotes ?? [],
          warnings: extracted.warnings ?? []
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

    state.sourceDocumentText = [
      state.sourceDocumentText,
      `--- ${file.name} ---\n${await file.text()}`
    ].filter(Boolean).join("\n\n");
    loaded.push(file.name);
    state.sourceFiles.push({
      fileName: file.name,
      mimeType: file.type || "text/plain",
      size: file.size,
      extractionMethod: "browser_text"
    });
  }

  if (sourceFileStatusEl) {
    sourceFileStatusEl.textContent = loaded.length
      ? `Loaded ${loaded.join(", ")}. Click Analyze Product Document to build the ShelfCycle family/product plan.`
      : "No source files were loaded.";
  }

  if (skipped.length) {
    warnings.push(`Skipped files: ${skipped.join("; ")}`);
  }

  const visibleWarnings = cleanProductWarnings(warnings);

  if (visibleWarnings.length) {
    setOutput(warningsEl, visibleWarnings.join("\n"));
  }

  renderSourceDocumentSummary(loaded);
  renderParsedProductFields();
  renderProductWorkflowStatus({
    phase: loaded.length ? "loaded" : "error",
    message: loaded.length
      ? "Source loaded. Review parsed fields, then run Analyze Product Document."
      : "No source files were loaded.",
    warnings: visibleWarnings
  });
  saveProductIntakeDraft();
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

productIntakeModeSelect?.addEventListener("change", () => {
  syncProductIntakeModeUi();
  saveProductIntakeDraft();
});
existingProductTargetInput?.addEventListener("input", () => scheduleProductIntakeDraftSave());
inputText?.addEventListener("input", () => {
  updateProductHeaderActions();
  scheduleProductIntakeDraftSave();

  if (!sourceFileStatusEl) {
    return;
  }

  const length = String(inputText.value || "").trim().length;

  if (length) {
    sourceFileStatusEl.textContent = `Pasted text ready (${length.toLocaleString()} characters). Click Parse Pasted Text with ChatGPT.`;
  } else if (!state.sourceFiles.length) {
    sourceFileStatusEl.textContent = "Upload a file, or paste readable text below.";
  }
});
clearProductDraftButton?.addEventListener("click", () => {
  if (window.confirm("Clear the saved SDS/TDS product-intake work from this browser?")) {
    clearProductIntakeDraft();
  }
});
parsePastedProductTextButton?.addEventListener("click", () => {
  if (!hasPastedProductText()) {
    setOutput(warningsEl, "Paste SDS/TDS or product text first.");
    return;
  }

  if (workflowSelect) {
    workflowSelect.value = "new_product";
  }

  analyzeButton?.click();
});
uploadProductFileButton?.addEventListener("click", () => {
  sourceFilesInput?.click();
});
createProductActionButton?.addEventListener("click", () => {
  const action = firstExecutableProductAction();

  if (!action) {
    productActionsEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOutput(warningsEl, productActionBlockingReason());
    return;
  }

  approveInlineProductAction(action.id).catch((error) => {
    setProductActionStatus(action.id, error instanceof Error ? error.message : "ShelfCycle product approval failed.", { error: true });
    setOutput(warningsEl, error instanceof Error ? error.message : "ShelfCycle product approval failed.");
  });
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
  const restoredProductDraft = restoreProductIntakeDraft();
  syncProductIntakeModeUi();
  const restoredActiveWorkflow = await restoreActiveShelfCycleWorkflowStatus();
  if (!restoredProductDraft && !restoredActiveWorkflow) {
    renderProductWorkflowStatus({
      phase: "idle",
      message: "No SDS/TDS workflow is running."
    });
  }
  updateProductHeaderActions();
  restoreReferenceData();
  await hydrateProjectIntelligence();
  saveReferenceData();
  renderReferenceStatus();
  await refreshBriefControls().catch(() => {});
  await refreshHomeDashboard().catch(() => {});
}

initialize();
