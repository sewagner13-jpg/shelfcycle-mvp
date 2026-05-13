const imageInput = document.querySelector("#card-image");
const textInput = document.querySelector("#card-text");
const relationshipHintInput = document.querySelector("#relationship-hint");
const cardEntryModeInput = document.querySelector("#card-entry-mode");
const existingCompanyLabelInput = document.querySelector("#existing-company-label");
const webResearchInput = document.querySelector("#web-research");
const scanButton = document.querySelector("#scan-card");
const clearButton = document.querySelector("#clear-card");
const startCameraButton = document.querySelector("#start-camera");
const captureCardButton = document.querySelector("#capture-card");
const retakeCardButton = document.querySelector("#retake-card");
const stopCameraButton = document.querySelector("#stop-camera");
const cameraPanel = document.querySelector("#camera-panel");
const cameraVideo = document.querySelector("#card-camera-video");
const cameraCanvas = document.querySelector("#card-camera-canvas");
const cameraPreview = document.querySelector("#card-camera-preview");
const cameraStatusEl = document.querySelector("#camera-status");
const visionStatusPill = document.querySelector("#vision-status-pill");
const statusEl = document.querySelector("#card-status");
const resultsEl = document.querySelector("#card-results");
const confidenceEl = document.querySelector("#card-confidence");
const resultGridEl = document.querySelector("#card-result-grid");
const LOCAL_API_BASE = "http://localhost:4318";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const MAX_SCAN_IMAGE_DIMENSION = 1400;
const SCAN_IMAGE_JPEG_QUALITY = 0.82;

let cameraStream = null;
let capturedImageDataUrl = "";
let currentScanPayload = null;
let currentScanApiBase = "";
let currentScanStoredLocally = false;
let approvedBusinessCardTargets = {
  customer: null,
  supplier: null
};
const submittedBusinessCardActionIds = new Set();
let visionStatus = {
  visionConfigured: false,
  message: "OpenAI vision status has not been checked yet."
};

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readImageAsDataUrl(file) {
  if (!file) {
    return Promise.resolve("");
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read image file.")));
    reader.readAsDataURL(file);
  });
}

function optimizeImageDataUrl(dataUrl = "") {
  if (!String(dataUrl || "").startsWith("data:image/")) {
    return Promise.resolve(dataUrl || "");
  }

  return new Promise((resolve) => {
    const image = new Image();

    image.addEventListener("load", () => {
      try {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;

        if (!width || !height) {
          resolve(dataUrl);
          return;
        }

        const scale = Math.min(1, MAX_SCAN_IMAGE_DIMENSION / Math.max(width, height));
        const outputWidth = Math.max(1, Math.round(width * scale));
        const outputHeight = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) {
          resolve(dataUrl);
          return;
        }

        canvas.width = outputWidth;
        canvas.height = outputHeight;
        context.fillStyle = "#fff";
        context.fillRect(0, 0, outputWidth, outputHeight);
        context.drawImage(image, 0, 0, outputWidth, outputHeight);
        resolve(canvas.toDataURL("image/jpeg", SCAN_IMAGE_JPEG_QUALITY));
      } catch {
        resolve(dataUrl);
      }
    });

    image.addEventListener("error", () => resolve(dataUrl));
    image.src = dataUrl;
  });
}

async function readJsonResponse(response, fallbackLabel = "API") {
  const bodyText = await response.text();

  if (!bodyText.trim()) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch (error) {
    const bodyPreview = bodyText
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    const message = `${fallbackLabel} returned ${response.status || "a"} ${response.statusText || "non-JSON"} response instead of JSON.${bodyPreview ? ` Response preview: ${bodyPreview}` : ""}`;
    const jsonError = new Error(message);
    jsonError.cause = error;
    jsonError.status = response.status;
    jsonError.bodyPreview = bodyPreview;
    throw jsonError;
  }
}

function isTimeoutLikeError(error) {
  const text = [
    error?.message,
    error?.bodyPreview,
    error?.payload?.message,
    error?.payload?.error,
    ...(error?.payload?.warnings ?? [])
  ].filter(Boolean).join(" ");

  return Number(error?.status) === 504 || /\b(inactivity timeout|timeout|timed out|aborted)\b/i.test(text);
}

function businessCardErrorMessage(error) {
  if (isTimeoutLikeError(error)) {
    return currentScanStoredLocally
      ? "Business-card image extraction timed out on the local backend. Retake a clearer photo, crop closer to the card, or paste the card text and scan again."
      : "Hosted image extraction timed out. Open the local ClearEdge app at http://localhost:4318 and try again, or paste the card text before scanning. The hosted site has a shorter timeout for image-only scans.";
  }

  return error instanceof Error ? error.message : "Business-card extraction failed.";
}

function isLocalPage() {
  return LOCAL_HOSTS.has(window.location.hostname);
}

function apiUrl(path, base = currentScanApiBase) {
  return `${base || ""}${path}`;
}

function existingContactModeKind(mode = cardEntryModeInput?.value || "auto") {
  if (mode === "existing_customer_contact") {
    return "customer";
  }

  if (mode === "existing_supplier_contact") {
    return "supplier";
  }

  return "";
}

function relationshipHintForScan() {
  const kind = existingContactModeKind();

  if (kind === "supplier") {
    return "supplier";
  }

  if (kind === "customer") {
    return "customer_prospect";
  }

  return relationshipHintInput.value;
}

function typedExistingCompanyTarget(kind = "") {
  const label = String(existingCompanyLabelInput?.value || currentScanPayload?.analysis?.fields?.companyName || "").trim();

  if (!kind || !label) {
    return null;
  }

  return {
    kind,
    id: "",
    label,
    confidence: 0.95,
    matchReasons: ["User typed an existing ShelfCycle company name."]
  };
}

async function detectLocalBackend() {
  if (isLocalPage()) {
    return {
      available: true,
      apiBase: "",
      isLocal: true
    };
  }

  try {
    const response = await fetch(`${LOCAL_API_BASE}/health`, {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Local backend health check failed.");
    }

    return {
      available: true,
      apiBase: LOCAL_API_BASE,
      isLocal: true
    };
  } catch {
    return {
      available: false,
      apiBase: "",
      isLocal: false
    };
  }
}

function reviewCredentials(reviewUrl = "") {
  try {
    const url = new URL(reviewUrl, window.location.href);
    return {
      reviewActionId: url.searchParams.get("id") || "",
      token: url.searchParams.get("token") || ""
    };
  } catch {
    return {
      reviewActionId: "",
      token: ""
    };
  }
}

async function postBusinessCardScan(apiBase = "", body = {}) {
  const response = await fetch(apiUrl("/api/business-card/scan", apiBase), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = await readJsonResponse(response, apiBase ? "Local business-card extraction API" : "Business-card extraction API");

  if (!response.ok) {
    const details = (payload.warnings ?? []).join(" ");
    const error = new Error([payload.message || payload.error || "Business-card extraction failed.", details].filter(Boolean).join(" "));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function setCameraButtons({ running = false, captured = false } = {}) {
  startCameraButton.disabled = running;
  captureCardButton.disabled = !running;
  retakeCardButton.disabled = !captured;
  stopCameraButton.disabled = !running;
}

function setCameraStatus(message = "") {
  cameraStatusEl.textContent = message || "Camera access stays in your browser. The captured image is only sent when you click Extract Card Info.";
}

function renderVisionStatus(status = {}) {
  visionStatus = {
    ...visionStatus,
    ...status
  };

  if (!visionStatusPill) {
    return;
  }

  visionStatusPill.textContent = status.visionConfigured ? "Vision ready" : "Vision setup needed";
  visionStatusPill.className = `status-pill ${status.visionConfigured ? "status-ready" : "status-review"}`;

  if (!status.visionConfigured) {
    setCameraStatus("Camera capture works, but image-only extraction needs OpenAI vision configured on the backend. You can still extract fields if you also paste card text.");
  }
}

async function loadVisionStatus() {
  try {
    const backend = await detectLocalBackend();
    const response = await fetch(apiUrl("/api/business-card/status", backend.apiBase));
    const payload = await readJsonResponse(response, "Business-card status API");

    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Vision status endpoint is unavailable.");
    }

    renderVisionStatus({
      ...payload,
      source: backend.isLocal ? "local" : payload.source
    });
  } catch (error) {
    renderVisionStatus({
      visionConfigured: false,
      message: error instanceof Error ? error.message : "Could not verify OpenAI vision configuration."
    });
  }
}

async function stopCamera() {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
  }

  cameraStream = null;
  cameraVideo.srcObject = null;
  setCameraButtons({ running: false, captured: Boolean(capturedImageDataUrl) });
  setCameraStatus(capturedImageDataUrl ? "Photo captured. Click Extract Card Info when ready." : "Camera stopped.");
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraStatus("This browser does not expose camera capture. Use the file upload instead.");
    return;
  }

  if (!window.isSecureContext) {
    setCameraStatus("Camera capture requires HTTPS or localhost. Use the hosted HTTPS page or local app.");
    return;
  }

  await stopCamera();
  capturedImageDataUrl = "";
  cameraPreview.classList.add("hidden");
  cameraVideo.classList.remove("hidden");
  cameraPanel.classList.remove("hidden");
  setCameraStatus("Requesting camera permission...");

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    setCameraButtons({ running: true, captured: false });
    setCameraStatus("Camera is on. Hold the card steady, then click Take Photo.");
  } catch (error) {
    await stopCamera();
    const reason = error instanceof Error ? error.message : "Camera permission was not granted.";
    setCameraStatus(`Could not start camera: ${reason}`);
  }
}

function captureCardPhoto() {
  if (!cameraStream || !cameraVideo.videoWidth || !cameraVideo.videoHeight) {
    setCameraStatus("Camera is not ready yet. Wait a second and try again.");
    return;
  }

  const maxWidth = 1600;
  const scale = cameraVideo.videoWidth > maxWidth ? maxWidth / cameraVideo.videoWidth : 1;
  cameraCanvas.width = Math.round(cameraVideo.videoWidth * scale);
  cameraCanvas.height = Math.round(cameraVideo.videoHeight * scale);
  const context = cameraCanvas.getContext("2d");
  context.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);
  capturedImageDataUrl = cameraCanvas.toDataURL("image/jpeg", 0.92);
  cameraPreview.src = capturedImageDataUrl;
  cameraPreview.classList.remove("hidden");
  cameraVideo.classList.add("hidden");
  imageInput.value = "";
  setCameraButtons({ running: true, captured: true });
  setCameraStatus("Photo captured. Click Extract Card Info, or Retake if the image is not clear.");
}

function retakeCardPhoto() {
  capturedImageDataUrl = "";
  cameraPreview.removeAttribute("src");
  cameraPreview.classList.add("hidden");
  cameraVideo.classList.remove("hidden");
  setCameraButtons({ running: Boolean(cameraStream), captured: false });
  setCameraStatus(cameraStream ? "Camera is ready. Hold the card steady, then click Take Photo." : "Start the camera to retake the photo.");
}

function normalizeWebsiteValue(value = "") {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  return /^https?:\/\//i.test(text) ? text : `https://${text.replace(/^\/+/, "")}`;
}

function field(label, value = "", key = "") {
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <input type="text" value="${escapeHtml(value || "")}" data-card-field="${escapeHtml(key)}" />
    </label>
  `;
}

function collectBusinessCardEdits() {
  const fields = {
    ...(currentScanPayload?.analysis?.fields ?? {})
  };

  for (const input of resultGridEl.querySelectorAll("[data-card-field]")) {
    fields[input.dataset.cardField] = input.value;
  }

  fields.website = normalizeWebsiteValue(fields.website);
  return fields;
}

function actionFieldsFromBusinessCard(action = {}, fields = collectBusinessCardEdits()) {
  const current = action.fieldValues ?? {};

  if (action.actionType === "supplier_create" || action.actionType === "supplier_update") {
    return {
      ...current,
      name: fields.companyName || current.name || "",
      phone: fields.phone || fields.mobilePhone || current.phone || "",
      email: fields.email || current.email || "",
      website: fields.website || "",
      street1: fields.streetAddress || current.street1 || "",
      street2: fields.streetAddress2 || current.street2 || "",
      city: fields.city || current.city || "",
      country: fields.country || current.country || "",
      stateRegion: fields.stateRegion || current.stateRegion || "",
      zip: fields.zip || current.zip || ""
    };
  }

  if (action.actionType === "customer_create") {
    return {
      ...current,
      name: fields.companyName || current.name || "",
      email: current.email || "",
      website: fields.website || "",
      phoneNumber: current.phoneNumber || "",
      streetAddress: fields.streetAddress || current.streetAddress || "",
      streetAddress2: fields.streetAddress2 || current.streetAddress2 || "",
      city: fields.city || current.city || "",
      stateRegion: fields.stateRegion || current.stateRegion || "",
      zip: fields.zip || current.zip || "",
      country: fields.country || current.country || ""
    };
  }

  if (action.actionType === "contact_create" || action.actionType === "contact_update") {
    const companyKind = contactActionCompanyKind(action);
    const phoneForShelfCycle = companyKind === "supplier"
      ? (fields.phone || fields.mobilePhone || current.phone || current.officePhone || "")
      : (fields.phone || current.phone || "");

    return {
      ...current,
      name: fields.personName || current.name || "",
      title: fields.title || current.title || "",
      email: fields.email || current.email || "",
      officePhone: phoneForShelfCycle,
      phone: phoneForShelfCycle,
      mobilePhone: fields.mobilePhone || current.mobilePhone || "",
      faxPhone: fields.faxPhone || current.faxPhone || "",
      documentTypes: current.documentTypes ?? []
    };
  }

  return current;
}

function syncBusinessCardActionFieldValues() {
  if (!currentScanPayload?.action?.proposedActions) {
    return;
  }

  const fields = collectBusinessCardEdits();
  currentScanPayload.analysis = {
    ...(currentScanPayload.analysis ?? {}),
    fields
  };

  for (const action of currentScanPayload.action.proposedActions) {
    action.fieldValues = actionFieldsFromBusinessCard(action, fields);
  }
}

function matchRows(matches = []) {
  if (!matches.length) {
    return '<p class="empty-state">No likely existing ShelfCycle match found.</p>';
  }

  return `
    <div class="match-list">
      ${matches.slice(0, 4).map((entry) => {
        const candidate = entry.candidate ?? entry;
        return `
          <div class="match-row">
            <strong>${escapeHtml(candidate.name || candidate.companyName || candidate.email || "Unnamed")}</strong>
            <span>${Math.round((entry.score ?? entry.confidence ?? 0) * 100)}% match</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function targetFromMatchEntry(entry = {}, kind = "customer") {
  const candidate = entry.candidate ?? entry;
  const label = candidate.name || candidate.label || candidate.companyName || candidate.supplierName || candidate.email || "";
  const id = candidate.id || candidate.customerId || candidate.supplierId || candidate.accountId || "";

  if (!label && !id) {
    return null;
  }

  return {
    kind,
    id,
    label: label || id,
    confidence: Number(entry.score ?? entry.confidence ?? candidate.confidence ?? candidate.score ?? (id ? 0.8 : 0.55)),
    matchReasons: [
      id ? `Known ShelfCycle ${kind} id available.` : `Searchable ${kind} label available.`,
      `${kind === "supplier" ? "Supplier" : "Customer"} match from card scan.`
    ]
  };
}

function targetCandidatesForKind(analysis = {}, kind = "customer") {
  const matches = kind === "supplier"
    ? (analysis.matches?.supplier ?? analysis.matches?.suppliers ?? [])
    : (analysis.matches?.customer ?? analysis.matches?.customers ?? []);

  const candidates = matches
    .map((entry) => targetFromMatchEntry(entry, kind))
    .filter(Boolean);
  const manualTarget = typedExistingCompanyTarget(kind);

  if (manualTarget) {
    candidates.unshift(manualTarget);
  }

  const byKey = new Map();

  for (const candidate of candidates) {
    const key = candidate.id ? `id:${candidate.id}` : `label:${candidate.label.toLowerCase()}`;
    const existing = byKey.get(key);

    if (!existing || candidate.confidence > existing.confidence) {
      byKey.set(key, candidate);
    }
  }

  return [...byKey.values()].sort((left, right) => right.confidence - left.confidence);
}

function renderExistingCompanyContactPanel(analysis = {}, actions = []) {
  const contactActions = actions.filter((action) => action.actionType === "contact_create");
  const requestedKind = existingContactModeKind();
  const actionKind = contactActions[0] ? contactActionCompanyKind(contactActions[0]) : "";
  const kind = requestedKind || actionKind || (relationshipHintInput.value === "supplier" ? "supplier" : "customer");
  const candidates = targetCandidatesForKind(analysis, kind);
  const selectedTarget = approvedBusinessCardTargets[kind] ?? contactActions.find((action) => action.selectedTarget?.label)?.selectedTarget ?? null;
  const modeLabel = kind === "supplier" ? "supplier" : "customer";

  if (!contactActions.length) {
    return `
      <article class="shelfcycle-form-card">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">Existing Company Contact</p>
            <h3>Add contact to existing company</h3>
          </div>
        </div>
        <p class="empty-state">No contact draft was created because the scan did not find a contact name or email.</p>
      </article>
    `;
  }

  return `
    <article class="shelfcycle-form-card">
      <div class="shelfcycle-form-header">
        <div>
          <p class="section-kicker">Existing Company Contact</p>
          <h3>Target existing ${escapeHtml(modeLabel)}</h3>
          <p class="small muted">Choose an existing ${escapeHtml(modeLabel)} for the contact action. This does not create a new company.</p>
        </div>
        <span class="status-pill ${selectedTarget ? "status-ready" : "status-review"}">${selectedTarget ? "Target selected" : "Select target"}</span>
      </div>
      ${selectedTarget ? `
        <p class="small"><strong>Selected:</strong> ${escapeHtml(selectedTarget.label)} ${selectedTarget.id ? `(${escapeHtml(selectedTarget.id)})` : "(search by name)"}</p>
      ` : ""}
      ${candidates.length ? `
        <div class="existing-contact-target-list">
          ${candidates.map((target) => `
            <div class="match-row">
              <div>
                <strong>${escapeHtml(target.label)}</strong>
                <span>${Math.round((target.confidence ?? 0) * 100)}% ${escapeHtml(target.id ? "matched with ShelfCycle id" : "searchable by name")}</span>
              </div>
              <button
                class="ghost mini"
                type="button"
                data-existing-company-target
                data-target-kind="${escapeHtml(target.kind)}"
                data-target-id="${escapeHtml(target.id || "")}"
                data-target-label="${escapeHtml(target.label || "")}"
                data-target-confidence="${escapeHtml(target.confidence ?? 0)}"
              >Use this ${escapeHtml(modeLabel)}</button>
            </div>
          `).join("")}
        </div>
      ` : `
        <p class="empty-state">Type an existing ${escapeHtml(modeLabel)} name above, or confirm the card company exists before approving the contact.</p>
      `}
    </article>
  `;
}

function proposedActionRows(actions = []) {
  if (!actions.length) {
    return '<p class="empty-state">No proposed actions were created.</p>';
  }

  return `
    <div class="match-list">
      ${actions.map((action) => {
        const unavailableReason = actionApprovalUnavailableReason(action);
        const disabled = Boolean(unavailableReason);

        return `
        <div class="match-row">
          <div>
            <strong>${escapeHtml(action.displayLabel || action.actionType)}</strong>
            <span>${disabled ? escapeHtml(unavailableReason) : "Ready to approve from this screen"}</span>
          </div>
          <button
            class="primary mini"
            type="button"
            data-business-card-submit-action
            data-action-id="${escapeHtml(action.id || "")}"
            data-action-type="${escapeHtml(action.actionType || "")}"
            ${disabled ? "disabled" : ""}
          >${escapeHtml(actionApprovalButtonLabel(action))}</button>
        </div>
      `;
      }).join("")}
    </div>
  `;
}

function actionApprovalButtonLabel(action = {}) {
  switch (action.actionType) {
    case "supplier_update":
      return "Approve & Update Supplier";
    case "supplier_create":
      return "Approve & Create Supplier";
    case "customer_create":
      return "Approve & Create Customer";
    case "contact_update":
      return "Approve & Update Contact";
    case "contact_create":
      return "Approve & Create Contact";
    default:
      return "Approve & Add to ShelfCycle";
  }
}

function contactActionCompanyKind(action = {}) {
  const requestedKind = existingContactModeKind();

  if (requestedKind) {
    return requestedKind;
  }

  const companyType = String(action.fieldValues?.companyType || "").toLowerCase();

  return companyType.includes("supplier") ? "supplier" : "customer";
}

function resolvedSubmitTarget(action = {}) {
  if (action.selectedTarget?.label || action.selectedTarget?.id) {
    return action.selectedTarget;
  }

  if (action.actionType === "contact_create") {
    const kind = contactActionCompanyKind(action);
    return approvedBusinessCardTargets[kind] ?? typedExistingCompanyTarget(kind) ?? null;
  }

  return null;
}

function actionApprovalUnavailableReason(action = {}) {
  if (submittedBusinessCardActionIds.has(action.id)) {
    return "Already submitted.";
  }

  if (!currentScanStoredLocally) {
    return "Start the local ClearEdge backend, then extract again so approval can run on this Mac.";
  }

  const resolvedTarget = resolvedSubmitTarget(action);

  if (action.actionType === "contact_create" && resolvedTarget?.label && (action.fieldValues?.name || action.fieldValues?.email)) {
    const blockingWarnings = (action.warnings ?? []).filter((warning) => !/select a shelfcycle (customer|supplier)/i.test(warning));
    return blockingWarnings[0] || "";
  }

  if (["customer_create", "supplier_create"].includes(action.actionType) && !String(action.fieldValues?.name || "").trim()) {
    return "Name is required before approving this ShelfCycle create.";
  }

  if (action.actionType === "contact_create" && !String(action.fieldValues?.name || action.fieldValues?.email || "").trim()) {
    return "Contact name or email is required before approving this contact.";
  }

  if (!action.executable) {
    return (action.warnings ?? [])[0] || "Needs review before it can be submitted.";
  }

  return "";
}

function isSupplierAlreadyExistsError(error) {
  const text = [
    error?.message,
    error?.payload?.message,
    error?.payload?.error?.message,
    error?.payload?.error,
    ...(error?.payload?.warnings ?? [])
  ].filter(Boolean).join(" ");

  return /\bsupplier already exists\b|\balready exists\b/i.test(text);
}

function hasSupplierUpdateValues(fields = {}) {
  return [
    "phone",
    "email",
    "website",
    "street1",
    "streetAddress",
    "street2",
    "streetAddress2",
    "city",
    "country",
    "stateRegion",
    "zip"
  ].some((key) => String(fields[key] || "").trim());
}

function promoteSupplierUpdateFromCreateAction(createAction = {}, fields = collectBusinessCardEdits()) {
  if (!currentScanPayload?.action?.proposedActions || createAction.actionType !== "supplier_create") {
    return false;
  }

  const existing = currentScanPayload.action.proposedActions.some((action) => action.actionType === "supplier_update");

  if (existing) {
    return false;
  }

  const updateFields = actionFieldsFromBusinessCard({
    ...createAction,
    actionType: "supplier_update"
  }, fields);
  const label = String(updateFields.name || fields.companyName || createAction.fieldValues?.name || "").trim();

  if (!label) {
    return false;
  }

  const selectedTarget = {
    kind: "supplier",
    id: "",
    label,
    confidence: 0.7,
    matchReasons: ["ShelfCycle reported this supplier already exists; update by searching the supplier name."]
  };
  const actionId = String(createAction.id || "").endsWith("-supplier_create")
    ? String(createAction.id).replace(/-supplier_create$/, "-supplier_update")
    : `${createAction.id || "business-card"}-supplier_update`;
  const warnings = hasSupplierUpdateValues(updateFields)
    ? []
    : ["Add at least one supplier field before updating this existing supplier."];
  const updateAction = {
    ...createAction,
    id: actionId,
    actionType: "supplier_update",
    displayLabel: "Update existing supplier in ShelfCycle",
    selectedTarget,
    targetCandidates: [selectedTarget],
    requiredFields: ["selectedTarget.label"],
    fieldValues: updateFields,
    warnings,
    executable: !warnings.length
  };
  const createIndex = currentScanPayload.action.proposedActions.findIndex((action) => action.id === createAction.id);

  currentScanPayload.action.proposedActions.splice(Math.max(createIndex + 1, 0), 0, updateAction);
  return true;
}

function parseShelfCycleTargetId(url = "", expectedKind = "customer") {
  const pattern = expectedKind === "supplier"
    ? /\/suppliers\/([^/?#]+)/i
    : /\/customers\/([^/?#]+)/i;
  const match = String(url || "").match(pattern);

  return match ? decodeURIComponent(match[1]) : "";
}

function targetFromSubmitResult(action = {}, payload = {}) {
  const kind = action.actionType === "supplier_create" ? "supplier" : "customer";
  const result = payload.result ?? {};
  const automation = result.automation ?? {};
  const shelfcycleUrl = result.shelfcycleUrl || automation.savedAtUrl || "";
  const id = payload.target?.id || result.target?.id || parseShelfCycleTargetId(shelfcycleUrl, kind);
  const label = payload.target?.label ||
    result.target?.label ||
    automation.customerName ||
    automation.supplierName ||
    result.customerName ||
    result.supplierName ||
    action.fieldValues?.name ||
    "";

  if (!label && !id) {
    return null;
  }

  return {
    kind,
    id,
    label: label || id,
    confidence: 1,
    matchReasons: ["Created from approved business-card action."]
  };
}

function applyApprovedTargetToFollowOnActions(target = null) {
  if (!target || !currentScanPayload?.action?.proposedActions) {
    return;
  }

  approvedBusinessCardTargets[target.kind] = target;

  for (const action of currentScanPayload.action.proposedActions) {
    if (action.actionType !== "contact_create" || contactActionCompanyKind(action) !== target.kind) {
      continue;
    }

    action.selectedTarget = target;
    action.targetCandidates = [
      target,
      ...((action.targetCandidates ?? []).filter((candidate) => candidate.label !== target.label && candidate.id !== target.id))
    ];
    action.requiredFields = [target.id ? "selectedTarget.id" : "selectedTarget.label", "fields.name_or_email"];
    action.warnings = (action.warnings ?? []).filter((warning) => !/select a shelfcycle (customer|supplier)/i.test(warning));
    action.confidence = Math.max(action.confidence ?? 0, 0.99);
    action.executable = Boolean(target.label && (action.fieldValues?.name || action.fieldValues?.email) && !action.warnings.length);
  }
}

function setBusinessCardActionButtonsDisabled(disabled = false) {
  for (const button of resultGridEl.querySelectorAll("[data-business-card-submit-action]")) {
    if (disabled) {
      button.disabled = true;
      continue;
    }

    const action = (currentScanPayload?.action?.proposedActions ?? []).find((item) => item.id === button.dataset.actionId && item.actionType === button.dataset.actionType);
    button.disabled = !action || Boolean(actionApprovalUnavailableReason(action));
  }
}

function warningList(warnings = []) {
  if (!warnings.length) {
    return '<p class="empty-state">No warnings.</p>';
  }

  return `<ul class="compact-list">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`;
}

function sourceList(citations = [], sourceNotes = []) {
  if (!citations.length && !sourceNotes.length) {
    return '<p class="empty-state">No external sources were used.</p>';
  }

  return `
    ${sourceNotes.length ? `<p>${escapeHtml(sourceNotes.join(" "))}</p>` : ""}
    ${citations.length ? `
      <div class="link-row">
        ${citations.slice(0, 5).map((citation) => `<a href="${escapeHtml(citation.url)}" target="_blank" rel="noreferrer">${escapeHtml(citation.title || "Source")}</a>`).join("")}
      </div>
    ` : ""}
  `;
}

function renderResults(payload = {}) {
  const analysis = payload.analysis ?? {};
  const fields = analysis.fields ?? {};
  const action = payload.action ?? {};
  const confidence = Math.round((analysis.confidence ?? 0) * 100);
  currentScanPayload = payload;

  resultsEl.classList.remove("hidden");
  confidenceEl.textContent = confidence ? `${confidence}% confidence` : "Review";
  confidenceEl.className = `status-pill ${confidence >= 75 ? "status-ready" : "status-review"}`;
  resultGridEl.innerHTML = `
    <article class="shelfcycle-form-card">
      <div class="shelfcycle-form-header">
        <div>
          <p class="section-kicker">Extracted Contact</p>
          <h3>${escapeHtml(fields.personName || fields.email || "Contact needs review")}</h3>
          <p class="small muted">Edit these fields before approval. The ShelfCycle action uses the edited values.</p>
        </div>
        <span class="status-pill status-review">${escapeHtml(fields.relationshipType || "review")}</span>
      </div>
      <div class="shelfcycle-field-grid">
        ${field("Name", fields.personName, "personName")}
        ${field("Title", fields.title, "title")}
        ${field("Email", fields.email, "email")}
        ${field("Phone", fields.phone, "phone")}
        ${field("Mobile", fields.mobilePhone, "mobilePhone")}
        ${field("Fax", fields.faxPhone, "faxPhone")}
      </div>
    </article>

    <article class="shelfcycle-form-card">
      <div class="shelfcycle-form-header">
        <div>
          <p class="section-kicker">Extracted Company</p>
          <h3>${escapeHtml(fields.companyName || "Company needs review")}</h3>
        </div>
        <span class="status-pill status-review">Not saved</span>
      </div>
      <div class="shelfcycle-field-grid">
        ${field("Company", fields.companyName, "companyName")}
        ${field("Website", fields.website, "website")}
        ${field("Street Address", fields.streetAddress, "streetAddress")}
        ${field("Street Address 2", fields.streetAddress2, "streetAddress2")}
        ${field("City", fields.city, "city")}
        ${field("State / Region", fields.stateRegion, "stateRegion")}
        ${field("Zip", fields.zip, "zip")}
        ${field("Country", fields.country, "country")}
      </div>
    </article>

    <article class="shelfcycle-form-card">
      <div class="shelfcycle-form-header">
        <div>
          <p class="section-kicker">ShelfCycle Matches</p>
          <h3>Existing records</h3>
        </div>
      </div>
      <h4>Customers</h4>
      ${matchRows(analysis.matches?.customer ?? [])}
      <h4>Suppliers</h4>
      ${matchRows(analysis.matches?.supplier ?? [])}
      <h4>Contacts</h4>
      ${matchRows(analysis.matches?.contacts ?? [])}
    </article>

    ${renderExistingCompanyContactPanel(analysis, action.proposedActions ?? [])}

    <article class="shelfcycle-form-card">
      <div class="shelfcycle-form-header">
      <div>
          <p class="section-kicker">ShelfCycle Approval</p>
          <h3>Approve from this screen</h3>
        </div>
        <span class="status-pill status-ready">${(action.proposedActions ?? []).filter((item) => item.executable).length} executable</span>
      </div>
      ${proposedActionRows(action.proposedActions ?? [])}
      <pre id="business-card-submit-status" class="text-block small"></pre>
    </article>

    <article class="shelfcycle-form-card">
      <div class="shelfcycle-form-header">
        <div>
          <p class="section-kicker">Warnings</p>
          <h3>Review before approval</h3>
        </div>
      </div>
      ${warningList([...(analysis.warnings ?? []), ...(action.warnings ?? [])])}
    </article>

    <article class="shelfcycle-form-card">
      <div class="shelfcycle-form-header">
        <div>
          <p class="section-kicker">Sources</p>
          <h3>Where fields came from</h3>
        </div>
      </div>
      ${sourceList(analysis.citations ?? [], analysis.sourceNotes ?? [])}
    </article>
  `;

  for (const input of resultGridEl.querySelectorAll("[data-card-field]")) {
    input.addEventListener("input", () => {
      syncBusinessCardActionFieldValues();
      setBusinessCardActionButtonsDisabled(false);
    });

    if (input.dataset.cardField === "website") {
      input.addEventListener("blur", () => {
        input.value = normalizeWebsiteValue(input.value);
        syncBusinessCardActionFieldValues();
        setBusinessCardActionButtonsDisabled(false);
      });
    }
  }

  syncBusinessCardActionFieldValues();

  for (const button of resultGridEl.querySelectorAll("[data-existing-company-target]")) {
    button.addEventListener("click", () => {
      const target = {
        kind: button.dataset.targetKind || "customer",
        id: button.dataset.targetId || "",
        label: button.dataset.targetLabel || "",
        confidence: Number(button.dataset.targetConfidence || 0.95),
        matchReasons: ["Selected from the business-card existing-company section."]
      };

      syncBusinessCardActionFieldValues();
      applyApprovedTargetToFollowOnActions(target);
      renderResults(currentScanPayload);
      submitStatus(`${target.label} selected as the existing ${target.kind} for contact creation.`);
    });
  }

  for (const button of resultGridEl.querySelectorAll("[data-business-card-submit-action]")) {
    button.addEventListener("click", () => {
      submitBusinessCardAction({
        actionId: button.dataset.actionId || "",
        actionType: button.dataset.actionType || ""
      }).catch((error) => {
        const submitStatusEl = document.querySelector("#business-card-submit-status");
        if (submitStatusEl) {
          submitStatusEl.textContent = error instanceof Error ? error.message : "ShelfCycle approval failed.";
        }
      });
    });
  }

  setBusinessCardActionButtonsDisabled(false);
}

function submitStatus(message = "") {
  const submitStatusEl = document.querySelector("#business-card-submit-status");

  if (submitStatusEl) {
    submitStatusEl.textContent = message;
  }
}

function formatSubmitResult(payload = {}) {
  if (!payload?.ok) {
    return payload.error?.message || payload.message || payload.error || "ShelfCycle submission failed.";
  }

  const lines = [
    payload.result?.message || "ShelfCycle action submitted.",
    payload.target?.label ? `Target: ${payload.target.label}` : "",
    payload.result?.shelfcycleUrl ? `ShelfCycle: ${payload.result.shelfcycleUrl}` : ""
  ].filter(Boolean);

  const warnings = payload.result?.warnings ?? payload.warnings ?? [];

  if (warnings.length) {
    lines.push(`Warnings: ${warnings.join(" ")}`);
  }

  return lines.join("\n");
}

async function submitBusinessCardAction({ actionId = "", actionType = "" } = {}) {
  const action = (currentScanPayload?.action?.proposedActions ?? []).find((item) => item.id === actionId && item.actionType === actionType);
  const credentials = reviewCredentials(currentScanPayload?.reviewUrl || "");
  let fields = {};

  if (!action) {
    throw new Error("Could not find the selected ShelfCycle action on this card extraction.");
  }

  const unavailableReason = actionApprovalUnavailableReason(action);

  if (unavailableReason) {
    throw new Error(unavailableReason);
  }

  if (!credentials.reviewActionId || !credentials.token) {
    throw new Error("Missing local review token for this business-card extraction. Extract the card again from the local backend.");
  }

  setBusinessCardActionButtonsDisabled(true);
  submitStatus("Approval received. Opening ShelfCycle and submitting the selected action...");

  try {
    syncBusinessCardActionFieldValues();
    const selectedTarget = resolvedSubmitTarget(action);
    fields = actionFieldsFromBusinessCard(action);
    action.fieldValues = fields;
    const response = await fetch(apiUrl(action.submitEndpoint || "/api/shelfcycle/submit-action", currentScanApiBase), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        reviewActionId: credentials.reviewActionId,
        token: credentials.token,
        actionId: action.id,
        actionType: action.actionType,
        selectedTarget,
        fields,
        approvedByUser: true
      })
    });
    const payload = await readJsonResponse(response, "ShelfCycle approval API");

    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error?.message || payload.message || payload.error || "ShelfCycle approval failed.");
    }

    submittedBusinessCardActionIds.add(action.id);
    const createdTarget = ["customer_create", "supplier_create"].includes(action.actionType)
      ? targetFromSubmitResult(action, payload)
      : null;

    if (createdTarget) {
      applyApprovedTargetToFollowOnActions(createdTarget);
      renderResults(currentScanPayload);
      submitStatus(`${formatSubmitResult(payload)}\n\n${createdTarget.label} is now available as the target for the contact action. You can approve the contact without scanning again.`);
    } else {
      setBusinessCardActionButtonsDisabled(false);
      submitStatus(formatSubmitResult(payload));
    }

    statusEl.textContent = "Approved action was sent to the local ShelfCycle agent.";
  } catch (error) {
    setBusinessCardActionButtonsDisabled(false);

    if (action.actionType === "supplier_create" && isSupplierAlreadyExistsError(error)) {
      const promoted = promoteSupplierUpdateFromCreateAction(action, fields);

      if (promoted) {
        renderResults(currentScanPayload);
        submitStatus("ShelfCycle reported that this supplier already exists. Review the extracted fields, then use Approve & Update Supplier instead of creating a duplicate.");
        statusEl.textContent = "Supplier already exists. Update option is now available.";
        return;
      }
    }

    throw error;
  }
}

async function scanBusinessCard() {
  statusEl.textContent = "Preparing business-card image...";
  scanButton.disabled = true;

  try {
    const backend = await detectLocalBackend();
    currentScanApiBase = backend.apiBase;
    currentScanStoredLocally = backend.isLocal;
    const rawImageDataUrl = capturedImageDataUrl || await readImageAsDataUrl(imageInput.files?.[0] ?? null);
    const imageDataUrl = await optimizeImageDataUrl(rawImageDataUrl);
    const hasText = Boolean(textInput.value.trim());

    if (imageDataUrl && !hasText && visionStatus.visionConfigured === false) {
      statusEl.textContent = "Image-only extraction needs OpenAI vision configured. Paste the card text too, or configure OPENAI_API_KEY on the backend.";
      return;
    }

    const requestBody = {
      imageDataUrl,
      text: textInput.value,
      relationshipHint: relationshipHintForScan(),
      entryMode: cardEntryModeInput.value,
      existingCompanyLabel: existingCompanyLabelInput.value,
      useWebResearch: webResearchInput.checked
    };
    let payload = null;

    statusEl.textContent = currentScanStoredLocally
      ? "Extracting visible business-card information locally..."
      : "Extracting visible business-card information...";

    try {
      payload = await postBusinessCardScan(currentScanApiBase, requestBody);
    } catch (error) {
      if (currentScanStoredLocally || !isTimeoutLikeError(error)) {
        throw error;
      }

      statusEl.textContent = "Hosted scan timed out. Checking for the local ClearEdge backend...";
      const localBackend = await detectLocalBackend();

      if (!localBackend.available || !localBackend.isLocal) {
        throw error;
      }

      currentScanApiBase = localBackend.apiBase;
      currentScanStoredLocally = true;
      statusEl.textContent = "Retrying through the local ClearEdge backend...";
      payload = await postBusinessCardScan(currentScanApiBase, requestBody);
    }

    approvedBusinessCardTargets = {
      customer: null,
      supplier: null
    };
    submittedBusinessCardActionIds.clear();
    renderResults(payload);
    statusEl.textContent = currentScanStoredLocally
      ? "Card information extracted locally. You can approve an executable action from this screen."
      : "Card information extracted. Start the local ClearEdge backend and extract again before approving a ShelfCycle action.";
  } finally {
    scanButton.disabled = false;
  }
}

startCameraButton.addEventListener("click", () => {
  startCamera().catch((error) => {
    setCameraStatus(error instanceof Error ? error.message : "Could not start camera.");
  });
});

captureCardButton.addEventListener("click", () => {
  captureCardPhoto();
});

retakeCardButton.addEventListener("click", () => {
  retakeCardPhoto();
});

stopCameraButton.addEventListener("click", () => {
  stopCamera().catch((error) => {
    setCameraStatus(error instanceof Error ? error.message : "Could not stop camera.");
  });
});

imageInput.addEventListener("change", () => {
  if (imageInput.files?.length) {
    capturedImageDataUrl = "";
    cameraPreview.removeAttribute("src");
    cameraPreview.classList.add("hidden");
    if (!cameraStream) {
      cameraPanel.classList.add("hidden");
    }
    setCameraButtons({ running: Boolean(cameraStream), captured: false });
    setCameraStatus("Uploaded image selected. Click Extract Card Info when ready.");
  }
});

scanButton.addEventListener("click", () => {
  scanBusinessCard().catch((error) => {
    statusEl.textContent = businessCardErrorMessage(error);
  });
});

clearButton.addEventListener("click", () => {
  stopCamera().catch(() => {});
  capturedImageDataUrl = "";
  currentScanPayload = null;
  currentScanApiBase = "";
  currentScanStoredLocally = false;
  approvedBusinessCardTargets = {
    customer: null,
    supplier: null
  };
  submittedBusinessCardActionIds.clear();
  cameraPreview.removeAttribute("src");
  cameraPreview.classList.add("hidden");
  cameraVideo.classList.remove("hidden");
  cameraPanel.classList.add("hidden");
  imageInput.value = "";
  textInput.value = "";
  relationshipHintInput.value = "auto";
  cardEntryModeInput.value = "auto";
  existingCompanyLabelInput.value = "";
  webResearchInput.checked = false;
  setCameraButtons({ running: false, captured: false });
  setCameraStatus();
  statusEl.textContent = "";
  resultsEl.classList.add("hidden");
  resultGridEl.innerHTML = "";
});

cardEntryModeInput.addEventListener("change", () => {
  const kind = existingContactModeKind();

  if (kind === "supplier") {
    relationshipHintInput.value = "supplier";
  } else if (kind === "customer") {
    relationshipHintInput.value = "customer_prospect";
  }

  if (currentScanPayload) {
    syncBusinessCardActionFieldValues();
    renderResults(currentScanPayload);
  }
});

existingCompanyLabelInput.addEventListener("input", () => {
  if (currentScanPayload) {
    syncBusinessCardActionFieldValues();
    setBusinessCardActionButtonsDisabled(false);
  }
});

window.addEventListener("pagehide", () => {
  stopCamera().catch(() => {});
});

loadVisionStatus();
