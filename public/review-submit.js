const reviewUrlEl = document.querySelector("#review-url");
const loadReviewButton = document.querySelector("#load-review");
const openSessionButton = document.querySelector("#open-session");
const submitNoteButton = document.querySelector("#submit-note");
const submitTitleEl = document.querySelector("#submit-title");
const submitLedeEl = document.querySelector("#submit-lede");
const submitStatusEl = document.querySelector("#submit-status");
const actionSummaryEl = document.querySelector("#action-summary");
const executableActionsEl = document.querySelector("#executable-actions");
const actionFieldsEl = document.querySelector("#action-fields");
const noteTargetEl = document.querySelector("#note-target");
const noteTargetCardEl = document.querySelector("#note-target-card");
const shelfCycleFormPreviewEl = document.querySelector("#shelfcycle-form-preview");
const submitWritePlanEl = document.querySelector("#submit-write-plan");
const submitDraftNoteEl = document.querySelector("#submit-draft-note");
const submitWarningsEl = document.querySelector("#submit-warnings");
const submitResultEl = document.querySelector("#submit-result");

let currentAction = null;
let currentSubmission = null;
let currentSection = new URL(window.location.href).searchParams.get("section") || "packet";
let currentProposedAction = null;
let selectedTarget = null;
let latestCustomerResearch = null;
let latestSupplierResearch = null;
const submittedActionIds = new Set();
const LOCAL_MVP_API_BASE = "http://localhost:4318";

function isLocalMvpHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function localOnlyApiUrl(path = "") {
  return isLocalMvpHost() ? path : `${LOCAL_MVP_API_BASE}${path}`;
}

async function parseJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: text
    };
  }
}

async function fetchJson(url, options = {}, { localOnly = false } = {}) {
  try {
    const response = await fetch(url, options);
    const payload = await parseJsonResponse(response);

    if (!response.ok) {
      throw new Error(payload.error?.message || payload.message || payload.error || `Request failed with status ${response.status}.`);
    }

    return payload;
  } catch (error) {
    if (localOnly && !isLocalMvpHost()) {
      throw new Error("This action requires the local ClearEdge backend running at http://localhost:4318. Open this page on the Mac or start the local app, then retry.");
    }

    throw error;
  }
}

function setOutput(element, value) {
  element.textContent = value || "None";
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeActionParam(value = "") {
  if (!value) {
    return null;
  }

  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = window.atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function encodeActionParam(action = {}) {
  const json = JSON.stringify(action);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function candidateName(candidate = {}) {
  return candidate.code || candidate.sku || candidate.name || candidate.customerName || candidate.supplierName || candidate.companyName || candidate.email || "";
}

function candidateKind(candidate = {}, fallback = "record") {
  const raw = String(candidate.companyType || candidate.type || candidate.kind || candidate.raw?.company_type || fallback).toLowerCase();

  if (raw.includes("supplier")) {
    return "supplier contact";
  }

  if (raw.includes("customer") || raw.includes("prospect")) {
    return "customer contact";
  }

  return fallback;
}

function matchLines(action = {}) {
  const matches = action.matches ?? {};
  const lines = [];
  const collect = (keys = [], label = "record") => {
    for (const key of keys) {
      for (const entry of asArray(matches[key])) {
        const candidate = entry?.candidate ?? entry;
        const name = candidateName(candidate);

        if (!name) {
          continue;
        }

        const score = Math.round(Number(entry?.score ?? entry?.confidence ?? candidate?.score ?? candidate?.confidence ?? 0) * 100);
        lines.push(`Already in ShelfCycle - ${label}: ${name}${score ? ` (${score}% match)` : ""}`);
      }
    }
  };

  collect(["customer", "customers"], "customer");
  collect(["supplier", "suppliers"], "supplier");

  for (const key of ["contact", "contacts"]) {
    for (const entry of asArray(matches[key])) {
      const candidate = entry?.candidate ?? entry;
      const name = candidateName(candidate);

      if (name) {
        lines.push(`Already in ShelfCycle - ${candidateKind(candidate, "contact")}: ${name}`);
      }
    }
  }

  collect(["product", "products"], "product");
  return [...new Set(lines)].slice(0, 8);
}

function formatActionSummary(action = {}) {
  const existing = matchLines(action);

  return [
    `Focus Section: ${currentSection}`,
    `Subject: ${action.subject || "-"}`,
    `Relationship: ${action.relationship?.relationship || "-"}`,
    `Silo: ${action.silo?.name || "-"}`,
    `State: ${action.state?.state || "-"}`,
    "",
    "Existing ShelfCycle matches:",
    existing.length ? existing.map((line) => `- ${line}`).join("\n") : "- None confirmed",
    "",
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

  const customerIdentity = submission.customerId
    ? `${submission.customerName || "-"} (${submission.customerId})`
    : `${submission.customerName || "-"} (resolved by ShelfCycle search)`;

  return [
    `Customer: ${customerIdentity}`,
    `ShelfCycle URL: ${submission.url || "-"}`,
    `Date: ${submission.fields?.date || "-"}`,
    `Type: ${submission.fields?.type || "-"}`,
    `Title: ${submission.fields?.title || "-"}`,
    "",
    "Summary to enter:",
    submission.fields?.summary || "-"
  ].join("\n");
}

function shelfField(label, value = "", { multiline = false } = {}) {
  const text = value || "";
  const control = multiline
    ? `<textarea readonly>${escapeHtml(text)}</textarea>`
    : `<input type="text" readonly value="${escapeHtml(text)}" />`;

  return `
    <label>
      <span>${escapeHtml(label)}</span>
      ${control}
    </label>
  `;
}

function uniqueMentions(mentions = []) {
  const seen = new Set();
  const ordered = [];

  for (const mention of mentions) {
    const label = String(mention?.label || mention?.name || mention?.code || "").trim();

    if (!label) {
      continue;
    }

    const kind = String(mention?.kind || mention?.type || "record").trim().toLowerCase();
    const key = `${kind}:${label.toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    ordered.push({
      ...mention,
      kind,
      label
    });
  }

  return ordered;
}

function asArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function collectPreviewMentions(action = {}, proposedAction = null, customer = null) {
  const mentions = [];

  if (customer?.name) {
    mentions.push({
      kind: "customer",
      id: customer.id || "",
      label: customer.name,
      source: "selectedTarget"
    });
  }

  mentions.push(...(proposedAction?.fieldValues?.mentions ?? []));

  for (const item of action.proposedActions ?? []) {
    mentions.push(...(item.fieldValues?.mentions ?? []));
  }

  for (const item of [...asArray(action.matches?.contacts), ...asArray(action.matches?.contact)]) {
    const candidate = item?.candidate ?? item;
    mentions.push({
      kind: "contact",
      id: candidate?.id || candidate?.contactId || "",
      label: candidate?.name || candidate?.fullName || candidate?.email || "",
      source: "matches.contacts"
    });
  }

  for (const item of [...asArray(action.matches?.products), ...asArray(action.matches?.product)]) {
    const candidate = item?.candidate ?? item;
    mentions.push({
      kind: "product",
      id: candidate?.id || candidate?.productId || "",
      label: candidate?.code || candidate?.sku || candidate?.name || "",
      source: "matches.products"
    });
  }

  return uniqueMentions(mentions);
}

function duplicateCandidatesHtml(proposedAction = null) {
  const duplicates = proposedAction?.duplicateCandidates ?? [];

  if (!duplicates.length) {
    return "";
  }

  return `
    <div class="shelfcycle-duplicate-panel">
      <p class="section-kicker">Already in ShelfCycle</p>
      <ul class="compact-list">
        ${duplicates.slice(0, 5).map((candidate) => {
          const label = candidate.label || candidate.name || candidate.companyName || candidate.email || candidate.id || "Matched record";
          const reasons = (candidate.matchReasons ?? []).join("; ");
          return `<li><strong>${escapeHtml(label)}</strong>${reasons ? ` <span>${escapeHtml(reasons)}</span>` : ""}</li>`;
        }).join("")}
      </ul>
      <p class="small muted">This create action is blocked until the existing ShelfCycle record is reviewed.</p>
    </div>
  `;
}

function targetPreviewHtml(targetUrl = "") {
  if (!targetUrl) {
    return '<span class="shelfcycle-target-muted">No validated customer notes URL</span>';
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    return `<span class="shelfcycle-target-muted">${escapeHtml(targetUrl)}</span>`;
  }

  return `<a href="${escapeHtml(targetUrl)}" target="_blank" rel="noreferrer">Open ShelfCycle target</a>`;
}

function richTextToolbarHtml() {
  const primary = ["B", "I", "U", "S", "Tx", "pen", "&lt;/&gt;", "H1", "H2", "H3", "H4", "quote", "list", "1.", "x2", "x^2", "link", "unlink", "left", "center", "right", "justify"];

  return `
    <div class="shelfcycle-toolbar-row" aria-hidden="true">
      ${primary.map((item) => `<span class="shelfcycle-tool">${item}</span>`).join("")}
    </div>
    <div class="shelfcycle-toolbar-row shelfcycle-toolbar-secondary" aria-hidden="true">
      <span class="shelfcycle-table-tool">Table Commands</span>
      <span class="shelfcycle-image-tool">Insert Image</span>
    </div>
  `;
}

function noteBodyHtml(text = "") {
  const normalized = String(text || "").trim() || "No note body was generated.";

  return escapeHtml(normalized).replace(/\n/g, "<br />");
}

function mentionPillsHtml(mentions = []) {
  if (!mentions.length) {
    return `
      <div class="shelfcycle-related-records empty">
        <span>Related records</span>
        <p>No matched customer, contact, or product mentions were detected.</p>
      </div>
    `;
  }

  return `
    <div class="shelfcycle-related-records">
      <span>Related records</span>
      <div class="shelfcycle-mention-list">
        ${mentions.map((mention) => `
          <span class="shelfcycle-mention-pill" data-kind="${escapeHtml(mention.kind)}">
            @${escapeHtml(mention.label)}
            <small>${escapeHtml(mention.kind)}</small>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function shelfCycleNotePreviewHtml({ customer = null, targetUrl = "", note = {}, mentions = [], hasTarget = false } = {}) {
  return `
    <article class="shelfcycle-note-modal-preview">
      <div class="shelfcycle-modal-title-row">
        <h3>New Note</h3>
        <span class="status-pill ${hasTarget ? "status-ready" : "status-review"}">${hasTarget ? "Target selected" : "Needs target"}</span>
      </div>

      <div class="shelfcycle-top-fields">
        ${shelfField("Date", note.date || "")}
        ${shelfField("Type", note.type || "")}
        ${shelfField("Title", note.title || "")}
      </div>

      <div class="shelfcycle-relation-row">
        <div>
          <strong>Customer: ${escapeHtml(customer?.name || "No matched ShelfCycle customer")}</strong>
          ${targetPreviewHtml(targetUrl)}
        </div>
        <div class="shelfcycle-relation-actions" aria-hidden="true">
          <button type="button" disabled>Create Contact</button>
          <button type="button" disabled>Create Address</button>
        </div>
      </div>

      <div class="shelfcycle-summary-block">
        <h4>Summary</h4>
        <div class="shelfcycle-richtext-preview">
          ${richTextToolbarHtml()}
          <div class="shelfcycle-editor-pane">
            <div class="shelfcycle-editor-text">${noteBodyHtml(note.summary || note.note || "")}</div>
            ${mentionPillsHtml(mentions)}
          </div>
        </div>
      </div>
    </article>
  `;
}

function fieldLabel(key = "") {
  return String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDraftNoteDisplay(draftNote = null) {
  if (!draftNote) {
    return "No note draft was created for this packet.";
  }

  return [
    draftNote.title ? `Title: ${draftNote.title}` : "",
    draftNote.type ? `Type: ${draftNote.type}` : "",
    draftNote.customerName ? `Customer: ${draftNote.customerName}` : "",
    draftNote.summary ? `Note:\n${draftNote.summary}` : ""
  ].filter(Boolean).join("\n\n") || "No note draft was created for this packet.";
}

function formatWritePlanDisplay(writePlan = null) {
  if (!writePlan) {
    return "No ShelfCycle write plan was created for this packet.";
  }

  const fields = writePlan.fields ?? {};
  const fieldLines = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
    .map(([key, value]) => `- ${fieldLabel(key)}: ${value}`);

  return [
    writePlan.action ? `Action: ${writePlan.action}` : "",
    writePlan.recordType ? `Record type: ${writePlan.recordType}` : "",
    fieldLines.length ? `Fields to review:\n${fieldLines.join("\n")}` : "",
    writePlan.warning ? `Warning: ${writePlan.warning}` : ""
  ].filter(Boolean).join("\n\n") || "No ShelfCycle write plan was created for this packet.";
}

function formatSubmitResult(payload = {}) {
  if (!payload?.ok) {
    return payload.error?.message || payload.error || "ShelfCycle submission failed.";
  }

  const target = payload.target?.label || payload.result?.target?.label || "ShelfCycle";
  const lines = [
    `${payload.result?.message || "ShelfCycle action submitted."}`,
    `Action: ${fieldLabel(payload.actionType || "ShelfCycle action")}`,
    `Target: ${target}`,
    payload.result?.shelfcycleUrl ? `ShelfCycle: ${payload.result.shelfcycleUrl}` : "",
    "Verification: Open ShelfCycle and confirm the saved record, note, contact, or document looks correct."
  ];

  const mentionResults = payload.result?.mentionResults ?? payload.mentionResults ?? [];

  if (mentionResults.length) {
    lines.push("");
    lines.push("Mentions:");
    lines.push(...mentionResults.map((item) => `- @${item.label}: ${item.status}${item.warning ? ` (${item.warning})` : ""}`));
  }

  return lines.filter(Boolean).join("\n");
}

function renderActionFields(action = null) {
  if (!actionFieldsEl) {
    return;
  }

  const fields = action?.fieldValues ?? {};
  const mentions = Array.isArray(fields.mentions) ? fields.mentions : [];
  const entries = Object.entries(fields).filter(([, value]) => {
    return !Array.isArray(value) && (value === null || typeof value !== "object");
  });

  if (!entries.length && !mentions.length) {
    actionFieldsEl.innerHTML = '<p class="empty-state">No editable fields are available for this action.</p>';
    return;
  }

  const fieldHtml = entries.map(([key, value]) => {
    const multiline = key === "note" || key === "summary" || String(value).length > 90;
    const control = multiline
      ? `<textarea data-action-field="${escapeHtml(key)}">${escapeHtml(value || "")}</textarea>`
      : `<input type="text" data-action-field="${escapeHtml(key)}" value="${escapeHtml(value || "")}" />`;

    return `
      <label>
        <span>${escapeHtml(fieldLabel(key))}</span>
        ${control}
      </label>
    `;
  }).join("");
  const mentionHtml = mentions.length
    ? `
      <div class="shelfcycle-form-card">
        <p class="section-kicker">Mention Candidates</p>
        <p class="small muted">${mentions.map((mention) => `@${escapeHtml(mention.label)} (${escapeHtml(mention.kind)})`).join(" · ")}</p>
      </div>
    `
    : "";

  actionFieldsEl.innerHTML = `${fieldHtml}${mentionHtml}`;

  for (const element of actionFieldsEl.querySelectorAll("[data-action-field]")) {
    element.addEventListener("input", () => {
      setSubmitEnabled(requiredFieldsSatisfied());
    });
  }
}

function collectEditedFields() {
  const fields = {};

  for (const element of actionFieldsEl?.querySelectorAll("[data-action-field]") ?? []) {
    fields[element.dataset.actionField] = element.value;
  }

  return fields;
}

function mergedActionFields(action = currentProposedAction) {
  return {
    ...(action?.fieldValues ?? {}),
    ...collectEditedFields()
  };
}

function parseCandidateFields(fields = []) {
  const parsed = {};

  for (const field of fields) {
    const [rawKey, ...rest] = String(field).split(":");

    if (!rawKey || !rest.length) {
      continue;
    }

    parsed[rawKey.trim()] = rest.join(":").trim();
  }

  return parsed;
}

function topCustomerMatch(action = {}) {
  return action.matches?.customer?.[0]?.candidate ?? null;
}

function reviewUrlParams() {
  const raw = reviewUrlEl.value.trim() || new URL(window.location.href).searchParams.get("reviewUrl") || "";

  if (!raw) {
    return { id: "", token: "" };
  }

  try {
    const url = new URL(raw);
    return {
      id: url.searchParams.get("id") || "",
      token: url.searchParams.get("token") || ""
    };
  } catch {
    return { id: "", token: "" };
  }
}

function requestedActionParams() {
  const params = new URL(window.location.href).searchParams;
  return {
    actionId: params.get("actionId") || "",
    actionType: params.get("actionType") || ""
  };
}

function chooseProposedAction(action = {}) {
  const requested = requestedActionParams();
  const proposed = action.proposedActions ?? [];

  return proposed.find((item) => requested.actionId && item.id === requested.actionId) ||
    proposed.find((item) => requested.actionType && item.actionType === requested.actionType) ||
    proposed.find((item) => item.executable) ||
    proposed.find((item) => item.actionType === "customer_note") ||
    proposed[0] ||
    null;
}

function notePreviewFromAction(action = {}) {
  const draftNote = action.draftNote ?? {};
  const fields = action.writePlan?.fields ?? {};
  const aiCandidate = action.briefAi?.shelfCycleCandidate ?? null;
  const readyNote = action.shelfCycleReadyNote ?? {};
  const summary = [
    readyNote.summary || "",
    draftNote.summary || fields.summary || action.summary || ""
  ].filter(Boolean)[0] || "";

  return {
    date: fields.date || new Date().toISOString().slice(0, 10),
    type: draftNote.type || fields.type || "Email",
    title: readyNote.title || aiCandidate?.title || draftNote.title || fields.title || action.subject || "ClearEdge note",
    summary
  };
}

function suggestedCreateCards(action = {}) {
  return (action.suggestedCreates ?? []).map((item, index) => {
    const type = item.type || "record";

    if (type === "contact") {
      const companyType = /supplier/i.test(item.companyType || "") ? "Supplier" : "Customer";
      return `
        <article class="shelfcycle-form-card">
          <div class="shelfcycle-form-header">
            <div>
              <p class="section-kicker">Suggested Contact</p>
              <h3>New Contact Preview</h3>
            </div>
            <span class="status-pill status-review">Manual create</span>
          </div>
          <div class="shelfcycle-field-grid">
            ${shelfField("First / Full Name", item.name || "")}
            ${shelfField("Title", item.title || "")}
            ${shelfField("Email", item.email || "")}
            ${shelfField(companyType, item.companyName || "")}
            ${shelfField("Phone", item.phone || "")}
            ${shelfField("Document Types", Array.isArray(item.documentTypes) ? item.documentTypes.join(", ") : "")}
          </div>
        </article>
      `;
    }

    if (type === "customer") {
      return `
        <article class="shelfcycle-form-card">
          <div class="shelfcycle-form-header">
            <div>
              <p class="section-kicker">Suggested Customer</p>
              <h3>New Customer Prospect Preview</h3>
            </div>
            <span class="status-pill status-review">Approval required</span>
          </div>
          <div class="shelfcycle-field-grid">
            ${genericFieldsHtml(item, ["name", "email", "website", "phoneNumber", "streetAddress", "streetAddress2", "city", "stateRegion", "zip", "country", "prospect"])}
          </div>
        </article>
      `;
    }

    if (type === "supplier") {
      return `
        <article class="shelfcycle-form-card">
          <div class="shelfcycle-form-header">
            <div>
              <p class="section-kicker">Suggested Supplier</p>
              <h3>New Supplier Preview</h3>
            </div>
            <span class="status-pill status-review">Approval required</span>
          </div>
          <div class="shelfcycle-field-grid">
            ${genericFieldsHtml(item, ["name", "phone", "email", "website", "street1", "street2", "city", "country", "stateRegion", "zip"])}
          </div>
        </article>
      `;
    }

    return `
      <article class="shelfcycle-form-card">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">Suggested ${escapeHtml(type)}</p>
            <h3>New Record Preview ${index + 1}</h3>
          </div>
          <span class="status-pill status-review">Manual create</span>
        </div>
        <div class="shelfcycle-field-grid">
          ${genericFieldsHtml(item)}
        </div>
      </article>
    `;
  });
}

function aiCandidateCard(action = {}) {
  const candidate = action.briefAi?.shelfCycleCandidate ?? null;

  if (!candidate?.shouldConsider) {
    return "";
  }

  const fields = parseCandidateFields(candidate.fields ?? []);

  return `
    <article class="shelfcycle-form-card">
      <div class="shelfcycle-form-header">
        <div>
          <p class="section-kicker">ShelfCycle Candidate</p>
          <h3>${escapeHtml(candidate.recordType || "Record")} Preview</h3>
        </div>
        <span class="status-pill status-review">Review before save</span>
      </div>
      <div class="shelfcycle-field-grid">
        ${shelfField("Record Type", candidate.recordType || "")}
        ${shelfField("Title", candidate.title || "")}
        ${shelfField("Supplier", fields.supplier || "")}
        ${shelfField("Product", fields.product || "")}
        ${shelfField("FOB Location", fields.FOB_location || fields.fob_location || "")}
        ${shelfField("Action", fields.action || action.briefAi?.action || "", { multiline: true })}
        ${shelfField("Summary", candidate.summary || "", { multiline: true })}
      </div>
    </article>
  `;
}

function noteCardHtml({ action = {}, submission = null, proposedAction = null } = {}) {
  const proposedTarget = selectedTarget ?? proposedAction?.selectedTarget ?? null;
  const customer = submission
    ? { id: submission.customerId, name: submission.customerName }
    : (proposedTarget ? { id: proposedTarget.id, name: proposedTarget.label } : topCustomerMatch(action));
  const note = submission?.fields ?? {
    ...notePreviewFromAction(action),
    summary: proposedAction?.fieldValues?.note || notePreviewFromAction(action).summary
  };
  const targetUrl = submission?.url || (customer?.id
    ? `https://app.shelfcycle.com/org-clearedge/customers/${customer.id}/notes`
    : (customer?.name ? "Resolved by ShelfCycle customer search when approved." : ""));
  const hasTarget = Boolean(customer?.id || customer?.name);
  const mentions = collectPreviewMentions(action, proposedAction, customer);

  return shelfCycleNotePreviewHtml({
    customer,
    targetUrl,
    note,
    mentions,
    hasTarget
  });
}

function actionTargetLabel(proposedAction = null) {
  const target = selectedTarget ?? proposedAction?.selectedTarget ?? null;
  return target?.label || proposedAction?.fieldValues?.customerName || "No ShelfCycle target selected";
}

function actionTargetKind(proposedAction = null) {
  const target = selectedTarget ?? proposedAction?.selectedTarget ?? proposedAction?.targetCandidates?.[0] ?? null;
  const companyType = proposedAction?.fieldValues?.companyType || "";

  if (target?.kind === "contact" || proposedAction?.actionType === "contact_update") {
    return "contact";
  }

  if (target?.kind === "supplier" || /supplier/i.test(companyType)) {
    return "supplier";
  }

  return "customer";
}

function genericFieldsHtml(fields = {}, labels = []) {
  const items = labels.length
    ? labels
    : Object.keys(fields).filter((key) => !Array.isArray(fields[key]) && fields[key] !== null && typeof fields[key] !== "object");

  return items
    .map((key) => shelfField(fieldLabel(key), fields[key] || "", { multiline: key === "note" || String(fields[key] || "").length > 90 }))
    .join("");
}

function warningsHtml(warnings = []) {
  const items = (warnings ?? []).filter(Boolean);

  if (!items.length) {
    return "";
  }

  return `
    <div class="shelfcycle-warning-box">
      <strong>Review required</strong>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

const CUSTOMER_REQUIREMENT_LABELS = {
  name: "Name",
  email: "Email",
  website: "Website",
  phoneNumber: "Phone Number",
  streetAddress: "Street Address",
  streetAddress2: "Street Address 2",
  city: "City",
  stateRegion: "State / Region",
  zip: "Zip",
  country: "Country",
  creditLimit: "Credit Limit",
  paymentTerm: "Payment Term",
  defaultSalesPerson: "Default Sales Person",
  defaultCsr: "Default CSR",
  prospect: "Create as Prospect"
};

const SUPPLIER_REQUIREMENT_LABELS = {
  name: "Name",
  phone: "Phone",
  email: "Email",
  website: "Website",
  street1: "Street 1",
  street2: "Street 2",
  city: "City",
  country: "Country",
  stateRegion: "State / Region",
  zip: "Zip",
  paymentTerms: "Payment Terms",
  creditLimit: "Credit Limit",
  achRoutingNumber: "ACH Routing No.",
  achAccountNumber: "ACH Account No.",
  costAccount: "Cost Account",
  preferredUnitOfMeasure: "Preferred Unit of Measure",
  defaultSupplierRep: "Default Supplier Rep"
};

function requirementsHtml(proposedAction = {}, fields = {}, { title = "ShelfCycle Form Requirements", labels = {} } = {}) {
  const requirements = proposedAction.fieldValues?.requirements ?? [];

  if (!requirements.length) {
    return "";
  }

  return `
    <div class="shelfcycle-requirements">
      <h4>${escapeHtml(title)}</h4>
      <ul>
        ${requirements.map((requirement) => {
          const value = fields[requirement.key] ?? requirement.value ?? "";
          const present = requirement.key === "prospect" ? Boolean(value) : Boolean(String(value || "").trim());
          const level = requirement.level === "required" ? "Required" : requirement.level === "recommended" ? "Recommended" : requirement.level === "internal" ? "Internal decision" : "Optional";
          return `
            <li class="${present ? "requirement-present" : "requirement-missing"}">
              <span>${present ? "Ready" : "Missing"}</span>
              <strong>${escapeHtml(requirement.label || labels[requirement.key] || fieldLabel(requirement.key))}</strong>
              <small>${escapeHtml(level)}</small>
            </li>
          `;
        }).join("")}
      </ul>
    </div>
  `;
}

function customerRequirementsHtml(proposedAction = {}, fields = {}) {
  return requirementsHtml(proposedAction, fields, {
    title: "ShelfCycle Customer Form Requirements",
    labels: CUSTOMER_REQUIREMENT_LABELS
  });
}

function supplierRequirementsHtml(proposedAction = {}, fields = {}) {
  return requirementsHtml(proposedAction, fields, {
    title: "ShelfCycle Supplier Form Requirements",
    labels: SUPPLIER_REQUIREMENT_LABELS
  });
}

function customerResearchSummaryHtml(fields = {}) {
  const research = fields.customerResearch ?? latestCustomerResearch;

  if (!research) {
    return `
      <div class="shelfcycle-research-panel">
        <p class="small muted">If public information is missing, use ChatGPT web research to look for company website, public phone, email, and address. Nothing is saved to ShelfCycle from this step.</p>
      </div>
    `;
  }

  const citations = research.citations ?? [];

  return `
    <div class="shelfcycle-research-panel">
      <p><strong>Research confidence:</strong> ${Math.round((research.confidence ?? 0) * 100)}%</p>
      ${(research.sourceNotes ?? []).length ? `<p>${escapeHtml(research.sourceNotes.join(" "))}</p>` : ""}
      ${citations.length ? `
        <p><strong>Sources:</strong> ${citations.slice(0, 4).map((citation) => `<a href="${escapeHtml(citation.url)}" target="_blank" rel="noreferrer">${escapeHtml(citation.title || "Source")}</a>`).join(" · ")}</p>
      ` : ""}
      ${(research.warnings ?? []).length ? `<p class="small muted">${escapeHtml(research.warnings.join(" "))}</p>` : ""}
    </div>
  `;
}

function supplierResearchSummaryHtml(fields = {}) {
  const research = fields.supplierResearch ?? latestSupplierResearch;

  if (!research) {
    return `
      <div class="shelfcycle-research-panel">
        <p class="small muted">Use ChatGPT web research to look for public supplier name, website, phone, email, and address. Internal payment, banking, accounting, UOM, and rep fields stay blank unless ClearEdge provides them.</p>
      </div>
    `;
  }

  const citations = research.citations ?? [];

  return `
    <div class="shelfcycle-research-panel">
      <p><strong>Research confidence:</strong> ${Math.round((research.confidence ?? 0) * 100)}%</p>
      ${(research.sourceNotes ?? []).length ? `<p>${escapeHtml(research.sourceNotes.join(" "))}</p>` : ""}
      ${citations.length ? `
        <p><strong>Sources:</strong> ${citations.slice(0, 4).map((citation) => `<a href="${escapeHtml(citation.url)}" target="_blank" rel="noreferrer">${escapeHtml(citation.title || "Source")}</a>`).join(" · ")}</p>
      ` : ""}
      ${(research.warnings ?? []).length ? `<p class="small muted">${escapeHtml(research.warnings.join(" "))}</p>` : ""}
    </div>
  `;
}

function actionPreviewCardHtml(proposedAction = null) {
  if (!proposedAction) {
    return "";
  }

  const fields = {
    ...(proposedAction.fieldValues ?? {}),
    ...collectEditedFields()
  };
  const targetLabel = actionTargetLabel(proposedAction);

  if (proposedAction.actionType === "customer_create") {
    return `
      <article class="shelfcycle-form-card shelfcycle-record-preview">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">ShelfCycle Customer</p>
            <h3>New Customer Preview</h3>
          </div>
          <span class="status-pill ${proposedAction.executable ? "status-ready" : "status-review"}">${proposedAction.executable ? "Ready for approval" : "Needs review"}</span>
        </div>
        <div class="shelfcycle-field-grid">
          ${genericFieldsHtml(fields, ["name", "email", "website", "phoneNumber", "streetAddress", "streetAddress2", "city", "stateRegion", "zip", "country", "creditLimit", "paymentTerm", "defaultSalesPerson", "defaultCsr", "prospect"])}
        </div>
        ${duplicateCandidatesHtml(proposedAction)}
        ${customerRequirementsHtml(proposedAction, fields)}
        ${customerResearchSummaryHtml(fields)}
        <div class="shelfcycle-form-actions">
          <button type="button" class="button-link mini ghost" data-customer-research>Research missing public info with ChatGPT</button>
        </div>
      </article>
    `;
  }

  if (proposedAction.actionType === "supplier_create") {
    return `
      <article class="shelfcycle-form-card shelfcycle-record-preview">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">ShelfCycle Supplier</p>
            <h3>New Supplier Preview</h3>
          </div>
          <span class="status-pill ${proposedAction.executable ? "status-ready" : "status-review"}">${proposedAction.executable ? "Ready for approval" : "Needs review"}</span>
        </div>
        <div class="shelfcycle-field-grid">
          ${genericFieldsHtml(fields, ["name", "phone", "email", "website", "street1", "street2", "city", "country", "stateRegion", "zip", "paymentTerms", "creditLimit", "achRoutingNumber", "achAccountNumber", "costAccount", "preferredUnitOfMeasure", "defaultSupplierRep"])}
        </div>
        ${duplicateCandidatesHtml(proposedAction)}
        ${supplierRequirementsHtml(proposedAction, fields)}
        ${supplierResearchSummaryHtml(fields)}
        <div class="shelfcycle-form-actions">
          <button type="button" class="button-link mini ghost" data-supplier-research>Research missing public supplier info with ChatGPT</button>
        </div>
      </article>
    `;
  }

  if (proposedAction.actionType === "supplier_update") {
    return `
      <article class="shelfcycle-form-card shelfcycle-record-preview">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">ShelfCycle Supplier</p>
            <h3>Update Existing Supplier Preview</h3>
          </div>
          <span class="status-pill ${proposedAction.executable || selectedTarget?.label ? "status-ready" : "status-review"}">${selectedTarget?.label || proposedAction.selectedTarget?.label ? "Target selected" : "Needs supplier"}</span>
        </div>
        <div class="shelfcycle-field-grid">
          ${shelfField("Supplier", targetLabel)}
          ${genericFieldsHtml(fields, ["name", "phone", "email", "website", "street1", "street2", "city", "country", "stateRegion", "zip", "paymentTerms", "creditLimit", "achRoutingNumber", "achAccountNumber", "costAccount", "preferredUnitOfMeasure", "defaultSupplierRep"])}
        </div>
        ${duplicateCandidatesHtml(proposedAction)}
        ${supplierRequirementsHtml(proposedAction, fields)}
      </article>
    `;
  }

  if (proposedAction.actionType === "contact_create") {
    const companyType = fields.companyType === "supplier" ? "Supplier" : "Customer";
    const phoneLabel = fields.companyType === "supplier" ? "Phone" : "Office Phone";
    return `
      <article class="shelfcycle-form-card shelfcycle-record-preview">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">ShelfCycle Contact</p>
            <h3>New Contact Preview</h3>
          </div>
          <span class="status-pill ${proposedAction.executable || selectedTarget?.label ? "status-ready" : "status-review"}">${selectedTarget?.label || proposedAction.selectedTarget?.label ? "Target selected" : `Needs ${companyType.toLowerCase()}`}</span>
        </div>
        <div class="shelfcycle-field-grid">
          ${shelfField(companyType, targetLabel)}
          ${shelfField("Name", fields.name || "")}
          ${shelfField("Title", fields.title || "")}
          ${shelfField("Email", fields.email || "")}
          ${shelfField(phoneLabel, fields.phone || fields.officePhone || "")}
          ${shelfField("Mobile Phone", fields.mobilePhone || "")}
          ${shelfField("Document Types", Array.isArray(fields.documentTypes) ? fields.documentTypes.join(", ") : "")}
        </div>
        ${duplicateCandidatesHtml(proposedAction)}
      </article>
    `;
  }

  if (proposedAction.actionType === "contact_update") {
    const companyType = fields.companyType === "supplier" ? "Supplier" : "Customer";
    const phoneLabel = fields.companyType === "supplier" ? "Phone" : "Office Phone";
    return `
      <article class="shelfcycle-form-card shelfcycle-record-preview">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">ShelfCycle Contact</p>
            <h3>Update Existing Contact Preview</h3>
          </div>
          <span class="status-pill ${proposedAction.executable || selectedTarget?.label ? "status-ready" : "status-review"}">${selectedTarget?.label || proposedAction.selectedTarget?.label ? "Contact selected" : "Needs contact"}</span>
        </div>
        <div class="shelfcycle-field-grid">
          ${shelfField("Contact", targetLabel)}
          ${shelfField(companyType, fields.companyTarget?.label || "")}
          ${shelfField("Name", fields.name || "")}
          ${shelfField("Title", fields.title || "")}
          ${shelfField("Email", fields.email || "")}
          ${shelfField(phoneLabel, fields.phone || fields.officePhone || "")}
          ${shelfField("Mobile Phone", fields.mobilePhone || "")}
        </div>
        ${duplicateCandidatesHtml(proposedAction)}
      </article>
    `;
  }

  if (proposedAction.actionType === "product_family_create_or_update") {
    return `
      <article class="shelfcycle-form-card shelfcycle-record-preview">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">ShelfCycle Product Family</p>
            <h3>Product Family Preview</h3>
          </div>
          <span class="status-pill status-review">Review family before product code</span>
        </div>
        <p class="muted">Product Family is the chemical/material grouping used by ShelfCycle. Product-code automation can safely select an existing family, but new family creation still requires manual verification.</p>
        <div class="shelfcycle-field-grid">
          ${genericFieldsHtml(fields, ["productFamily", "chemicalName", "productFamilyDescription", "aliases", "casNumber", "unNumber", "packingGroup", "hazardClass", "specialDesignation", "properShippingName", "signalWord", "hazardSymbols"])}
        </div>
        ${warningsHtml(proposedAction.warnings)}
      </article>
    `;
  }

  if (proposedAction.actionType === "product_create_or_update") {
    return `
      <article class="shelfcycle-form-card shelfcycle-record-preview">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">ShelfCycle Product</p>
            <h3>Product Code Preview</h3>
          </div>
          <span class="status-pill ${proposedAction.executable ? "status-ready" : "status-review"}">${proposedAction.executable ? "Ready for approval" : "Needs fields"}</span>
        </div>
        <div class="shelfcycle-field-grid">
          ${genericFieldsHtml(fields, ["code", "productName", "productFamily", "packagingType", "packaging", "quantityPerPackage", "unitOfMeasure", "supplierType", "supplier", "casNumber", "sdsPath", "nmfcCode", "freightClass", "pallet", "packagesPerPallet", "unNumber", "packingGroup", "hazardClass", "specialDesignation", "properShippingName", "signalWord", "hazardSymbols", "reuseGuidance"])}
        </div>
        ${duplicateCandidatesHtml(proposedAction)}
      </article>
    `;
  }

  if (proposedAction.actionType === "pricing_record") {
    return `
      <article class="shelfcycle-form-card shelfcycle-record-preview">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">ShelfCycle Pricing</p>
            <h3>Price Record Preview</h3>
          </div>
          <span class="status-pill ${proposedAction.executable ? "status-ready" : "status-review"}">${proposedAction.executable ? "Ready for approval" : "Needs review"}</span>
        </div>
        <div class="shelfcycle-field-grid">
          ${genericFieldsHtml(fields, ["customerName", "productCode", "productName", "pricePerUnit", "pricePerPackage", "dateFrom", "dateTo", "note"])}
        </div>
      </article>
    `;
  }

  if (proposedAction.actionType === "product_document_followup") {
    return `
      <article class="shelfcycle-form-card shelfcycle-record-preview">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">ShelfCycle Document</p>
            <h3>Product Document Upload Preview</h3>
          </div>
          <span class="status-pill ${proposedAction.executable ? "status-ready" : "status-review"}">${proposedAction.executable ? "Ready for approval" : "Needs file or product"}</span>
        </div>
        <div class="shelfcycle-field-grid">
          ${shelfField("Product", proposedAction.selectedTarget?.label || "No product selected")}
          ${genericFieldsHtml(fields, ["documentType", "filePath"])}
        </div>
      </article>
    `;
  }

  if (proposedAction.actionType === "review_only") {
    return `
      <article class="shelfcycle-form-card shelfcycle-record-preview">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">Review Only</p>
            <h3>No Safe ShelfCycle Write Yet</h3>
          </div>
          <span class="status-pill status-review">Preview only</span>
        </div>
        <p class="empty-state">${escapeHtml((proposedAction.warnings ?? [])[0] || "This item should be reviewed manually before any ShelfCycle update.")}</p>
      </article>
    `;
  }

  return `
    <article class="shelfcycle-form-card shelfcycle-record-preview">
      <div class="shelfcycle-form-header">
        <div>
          <p class="section-kicker">ShelfCycle Action</p>
          <h3>${escapeHtml(proposedAction.displayLabel || fieldLabel(proposedAction.actionType || "Action"))}</h3>
        </div>
        <span class="status-pill ${proposedAction.executable ? "status-ready" : "status-review"}">${proposedAction.executable ? "Ready for approval" : "Needs review"}</span>
      </div>
      <div class="shelfcycle-field-grid">
        ${genericFieldsHtml(fields)}
      </div>
    </article>
  `;
}

function renderShelfCycleFormPreview(action = {}, submission = null) {
  if (!shelfCycleFormPreviewEl) {
    return;
  }

  const noteTypes = new Set(["customer_note", "supplier_note", "order_or_logistics_note"]);
  const primaryCard = noteTypes.has(currentProposedAction?.actionType)
    ? noteCardHtml({ action, submission, proposedAction: currentProposedAction })
    : actionPreviewCardHtml(currentProposedAction);
  const cards = [
    primaryCard || noteCardHtml({ action, submission, proposedAction: currentProposedAction }),
    aiCandidateCard(action),
    ...suggestedCreateCards(action)
  ].filter(Boolean);

  shelfCycleFormPreviewEl.innerHTML = cards.join("") || `
    <article class="shelfcycle-form-card">
      <p class="empty-state">No ShelfCycle-ready fields were found for this packet.</p>
    </article>
  `;

  const researchButton = shelfCycleFormPreviewEl.querySelector("[data-customer-research]");
  if (researchButton) {
    researchButton.addEventListener("click", () => {
      researchCompanyInfo("customer").catch((error) => {
        submitStatusEl.textContent = error instanceof Error ? error.message : "Customer research failed.";
      });
    });
  }

  const supplierResearchButton = shelfCycleFormPreviewEl.querySelector("[data-supplier-research]");
  if (supplierResearchButton) {
    supplierResearchButton.addEventListener("click", () => {
      researchCompanyInfo("supplier").catch((error) => {
        submitStatusEl.textContent = error instanceof Error ? error.message : "Supplier research failed.";
      });
    });
  }
}

function renderNoteTargetCard(action = {}, submission = null) {
  if (!noteTargetCardEl) {
    return;
  }

  const noteTypes = new Set(["customer_note", "supplier_note", "order_or_logistics_note"]);
  const candidates = currentProposedAction?.targetCandidates ?? [];
  const targetKind = actionTargetKind(currentProposedAction);
  const targetLabel = targetKind === "contact" ? "Contact" : targetKind === "supplier" ? "Supplier" : "Customer";
  const requiresCustomerLabel = currentProposedAction?.requiredFields?.includes("selectedTarget.label");
  const picker = !currentProposedAction?.selectedTarget && candidates.length
    ? `
      <article class="shelfcycle-form-card">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">Target Selection Required</p>
            <h3>Choose ShelfCycle ${targetLabel}</h3>
          </div>
          <span class="status-pill status-review">Manual target</span>
        </div>
        <label>
          <span>${targetLabel} target</span>
          <select id="target-picker">
            <option value="">Select ${targetKind}...</option>
            ${candidates.map((candidate, index) => `<option value="${index}">${escapeHtml(candidate.label)} (${Math.round((candidate.confidence ?? 0) * 100)}%)</option>`).join("")}
          </select>
        </label>
      </article>
    `
    : "";
  const manualTarget = !currentProposedAction?.selectedTarget && requiresCustomerLabel
    ? `
      <article class="shelfcycle-form-card">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">Manual Target</p>
            <h3>Type ShelfCycle ${targetLabel} Name</h3>
          </div>
          <span class="status-pill status-review">Human required</span>
        </div>
        <label>
          <span>${targetLabel} name exactly as it appears in ShelfCycle</span>
          <input type="text" id="manual-target-name" placeholder="Example: MAK Chemicals" />
        </label>
        <p class="small muted">The local browser agent will search ShelfCycle for this company before saving anything.</p>
      </article>
    `
    : "";

  const noTargetRequired = !picker && !manualTarget && !noteTypes.has(currentProposedAction?.actionType)
    ? `
      <article class="shelfcycle-form-card">
        <div class="shelfcycle-form-header">
          <div>
            <p class="section-kicker">Target</p>
            <h3>No existing target required</h3>
          </div>
          <span class="status-pill status-ready">Form action</span>
        </div>
        <p class="empty-state">This action creates a new ShelfCycle record after approval. Review the form preview and approved fields before running the agent.</p>
      </article>
    `
    : "";
  const notePreview = noteTypes.has(currentProposedAction?.actionType)
    ? noteCardHtml({ action, submission, proposedAction: currentProposedAction })
    : "";

  noteTargetCardEl.innerHTML = `${picker}${manualTarget}${noTargetRequired}${notePreview}`;

  const pickerEl = noteTargetCardEl.querySelector("#target-picker");
  const manualTargetEl = noteTargetCardEl.querySelector("#manual-target-name");

  const updateSelectedTargetOutput = () => {
    if (selectedTarget) {
      const identity = selectedTarget.id ? `${selectedTarget.label} (${selectedTarget.id})` : `${selectedTarget.label} (resolved by ShelfCycle search)`;
      setOutput(noteTargetEl, `Selected ${targetKind}: ${identity}`);
      return;
    }

    setOutput(noteTargetEl, (currentProposedAction?.warnings ?? []).join("\n"));
  };

  if (pickerEl) {
    pickerEl.addEventListener("change", () => {
      selectedTarget = candidates[Number(pickerEl.value)] ?? null;
      if (manualTargetEl && selectedTarget) {
        manualTargetEl.value = "";
      }
      setSubmitEnabled(requiredFieldsSatisfied(currentProposedAction, selectedTarget));
      renderShelfCycleFormPreview(currentAction ?? {}, currentSubmission);
      updateSelectedTargetOutput();
    });
  }

  if (manualTargetEl) {
    manualTargetEl.addEventListener("input", () => {
      const label = manualTargetEl.value.trim();
      selectedTarget = label
        ? {
          kind: targetKind,
          id: "",
          label,
          confidence: 1,
          matchReasons: [`user entered searchable ${targetKind} label`]
        }
        : null;
      if (pickerEl && selectedTarget) {
        pickerEl.value = "";
      }
      setSubmitEnabled(requiredFieldsSatisfied(currentProposedAction, selectedTarget));
      renderShelfCycleFormPreview(currentAction ?? {}, currentSubmission);
      updateSelectedTargetOutput();
    });
  }
}

function hasCreateNoteAction(action = {}) {
  return Boolean(currentProposedAction);
}

function submitButtonLabel(enabled) {
  if (!currentProposedAction) {
    return "Load Review Packet First";
  }

  if (submittedActionIds.has(currentProposedAction.id)) {
    return "Verify in ShelfCycle";
  }

  if (!currentProposedAction.executable && !(currentProposedAction.requiredFields ?? []).length) {
    return "Preview Only - Manual Entry Required";
  }

  if (!enabled) {
    return "Complete Required Fields";
  }

  return "Approve & Run ShelfCycle Entry";
}

function setSubmitEnabled(enabled) {
  submitNoteButton.disabled = !enabled;
  submitNoteButton.textContent = submitButtonLabel(enabled);
  submitNoteButton.title = enabled
    ? "This will start local ShelfCycle browser automation after you confirm approval."
    : "This packet does not yet have a validated executable ShelfCycle action.";
}

function requiredFieldsSatisfied(action = currentProposedAction, target = selectedTarget ?? currentProposedAction?.selectedTarget) {
  if (!action) {
    return false;
  }

  if (action.executable) {
    return true;
  }

  const required = action.requiredFields ?? [];
  const fields = mergedActionFields(action);

  if (required.includes("selectedTarget.id") && !target?.id) {
    return false;
  }

  if (required.includes("selectedTarget.label") && !target?.label) {
    return false;
  }

  if (required.includes("fields.note") && !fields.note) {
    return false;
  }

  if (required.includes("fields.name") && !fields.name) {
    return false;
  }

  if (required.includes("fields.title") && !fields.title) {
    return false;
  }

  if (required.includes("fields.name_or_email") && !fields.name && !fields.email) {
    return false;
  }

  if (required.includes("fields.customerName") && !fields.customerName) {
    return false;
  }

  if (required.includes("fields.productCode_or_productName") && !fields.productCode && !fields.productName) {
    return false;
  }

  if (required.includes("fields.price") && !fields.pricePerUnit && !fields.pricePerPackage) {
    return false;
  }

  if (required.includes("fields.code") && !fields.code) {
    return false;
  }

  if (required.includes("fields.productFamily") && !fields.productFamily) {
    return false;
  }

  if (required.includes("fields.packaging") && !fields.packaging) {
    return false;
  }

  if (required.includes("fields.quantityPerPackage") && !fields.quantityPerPackage) {
    return false;
  }

  if (required.includes("fields.filePath") && !fields.filePath) {
    return false;
  }

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
  if (!["customer_create", "supplier_create"].includes(action.actionType)) {
    return null;
  }

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
    matchReasons: ["Created from approved daily-brief review action."]
  };
}

function contactActionCompanyKind(action = {}) {
  const companyType = String(action.fieldValues?.companyType || "").toLowerCase();

  return companyType.includes("supplier") ? "supplier" : "customer";
}

function applyApprovedTargetToFollowOnActions(target = null) {
  if (!target || !currentAction?.proposedActions) {
    return null;
  }

  let nextContactAction = null;

  for (const action of currentAction.proposedActions) {
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
    nextContactAction = nextContactAction ?? action;
  }

  return nextContactAction;
}

function mergeNonEmptyFields(target = {}, source = {}) {
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value) || (value && typeof value === "object")) {
      continue;
    }

    if (String(value ?? "").trim()) {
      target[key] = value;
    }
  }
}

async function researchCompanyInfo(recordType = "customer") {
  const expectedActionType = recordType === "supplier" ? "supplier_create" : "customer_create";
  const label = recordType === "supplier" ? "supplier" : "customer";

  if (!currentAction || !currentProposedAction || currentProposedAction.actionType !== expectedActionType) {
    submitStatusEl.textContent = `Load a new-${label} review action before researching ${label} info.`;
    return;
  }

  submitStatusEl.textContent = `Researching public ${label} information with ChatGPT...`;
  const { id, token } = reviewUrlParams();
  const payload = await fetchJson(localOnlyApiUrl("/api/company/research"), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      reviewActionId: id || currentAction.id || "",
      token,
      actionId: currentProposedAction.id,
      actionType: currentProposedAction.actionType,
      recordType,
      action: currentAction,
      fields: mergedActionFields()
    })
  }, {
    localOnly: true
  });

  const latestResearch = {
    confidence: payload.research?.confidence ?? 0,
    citations: payload.research?.citations ?? [],
    sourceNotes: payload.research?.sourceNotes ?? [],
    warnings: payload.research?.warnings ?? []
  };

  if (recordType === "supplier") {
    latestSupplierResearch = latestResearch;
  } else {
    latestCustomerResearch = latestResearch;
  }

  mergeNonEmptyFields(currentProposedAction.fieldValues, payload.research?.fields ?? {});
  currentProposedAction.fieldValues[recordType === "supplier" ? "supplierResearch" : "customerResearch"] = latestResearch;
  currentProposedAction.fieldValues.requirements = payload.requirements?.requirements ?? currentProposedAction.fieldValues.requirements;
  currentProposedAction.fieldValues.missingRequiredFields = payload.requirements?.missingRequiredFields ?? [];
  currentProposedAction.fieldValues.missingRecommendedFields = payload.requirements?.missingRecommendedFields ?? [];
  currentProposedAction.executable = Boolean(requiredFieldsSatisfied(currentProposedAction, selectedTarget) && !(currentProposedAction.warnings ?? []).length);

  renderActionFields(currentProposedAction);
  renderShelfCycleFormPreview(currentAction, currentSubmission);
  setSubmitEnabled(requiredFieldsSatisfied());
  submitStatusEl.textContent = `${fieldLabel(label)} research applied. Review the fields before approving ShelfCycle creation.`;
}

async function loadNoteTarget(action = {}) {
  if (!hasCreateNoteAction(action)) {
    currentSubmission = null;
    setOutput(noteTargetEl, "No direct note creation action is available. This usually means no single matched ShelfCycle customer id was found.");
    renderNoteTargetCard(action, null);
    renderShelfCycleFormPreview(action, null);
    setSubmitEnabled(false);
    return;
  }

  currentSubmission = currentProposedAction?.selectedTarget ? {
    customerId: currentProposedAction.selectedTarget.id,
    customerName: currentProposedAction.selectedTarget.label,
    url: currentProposedAction.selectedTarget.id
      ? `https://app.shelfcycle.com/org-clearedge/customers/${currentProposedAction.selectedTarget.id}/notes`
      : "https://app.shelfcycle.com/org-clearedge/contacts",
    fields: {
      date: currentProposedAction.fieldValues?.date || "",
      type: currentProposedAction.fieldValues?.type || "",
      title: currentProposedAction.fieldValues?.title || "",
      summary: currentProposedAction.fieldValues?.note || ""
    }
  } : null;
  selectedTarget = currentProposedAction?.selectedTarget ?? null;
  setOutput(noteTargetEl, currentSubmission ? formatNoteTarget(currentSubmission) : (currentProposedAction?.warnings ?? []).join("\n"));
  renderNoteTargetCard(action, currentSubmission);
  renderShelfCycleFormPreview(action, currentSubmission);
  renderActionFields(currentProposedAction);
  setSubmitEnabled(requiredFieldsSatisfied());
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

  if (currentSection) {
    url.searchParams.set("section", currentSection);
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

  const payload = await fetchJson("/api/load-review-action", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ reviewUrl })
  });

  latestCustomerResearch = null;
  latestSupplierResearch = null;
  submittedActionIds.clear();
  currentAction = payload.action;
  currentProposedAction = chooseProposedAction(currentAction);
  syncQueryParam();
  submitTitleEl.textContent = currentAction.subject || "Ready to review";
  submitLedeEl.textContent = `Verify the ${currentSection} section below, then explicitly approve the local ShelfCycle action.`;
  setOutput(actionSummaryEl, formatActionSummary(currentAction));
  setOutput(executableActionsEl, formatExecutableActions((currentAction.proposedActions ?? []).filter((item) => item.executable).map((item) => ({
    label: item.displayLabel,
    description: item.selectedTarget?.label ? `Target: ${item.selectedTarget.label}` : "Ready for approval"
  }))));
  setOutput(submitWritePlanEl, formatWritePlanDisplay(currentAction.writePlan));
  setOutput(submitDraftNoteEl, formatDraftNoteDisplay(currentAction.draftNote));
  setOutput(submitWarningsEl, (currentAction.warnings ?? []).join("\n"));
  setOutput(submitResultEl, "");
  renderShelfCycleFormPreview(currentAction, null);
  submitStatusEl.textContent = currentProposedAction?.executable
    ? "Review packet loaded. This action can run locally after approval."
    : "Review packet loaded. This action is preview-only until required ShelfCycle target or action support exists.";
  await loadNoteTarget(currentAction);
}

async function openShelfCycleSession() {
  submitStatusEl.textContent = "Opening local ShelfCycle browser session...";
  const payload = await fetchJson(localOnlyApiUrl("/api/shelfcycle/open-session"), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(currentAction ? { action: currentAction } : {})
  }, {
    localOnly: true
  });
  submitStatusEl.textContent = payload.message || "ShelfCycle browser session opened.";

  if (payload.submission) {
    currentSubmission = payload.submission;
    setOutput(noteTargetEl, formatNoteTarget(currentSubmission));
    renderNoteTargetCard(currentAction ?? {}, currentSubmission);
    renderShelfCycleFormPreview(currentAction ?? {}, currentSubmission);
    setSubmitEnabled(true);
  }
}

async function submitNote() {
  if (!currentAction) {
    submitStatusEl.textContent = "Load a review packet before submitting.";
    return;
  }

  if (!currentProposedAction) {
    submitStatusEl.textContent = "No proposed ShelfCycle action is available for this packet.";
    return;
  }

  if (!requiredFieldsSatisfied()) {
    submitStatusEl.textContent = "This action is missing a required ShelfCycle target or field.";
    return;
  }

  const targetForSubmit = selectedTarget ?? currentProposedAction.selectedTarget;
  const editedFields = mergedActionFields();
  const confirmed = window.confirm(
    `Run this approved ShelfCycle action?\n\nAction: ${currentProposedAction.displayLabel || currentProposedAction.actionType}\nTarget: ${targetForSubmit?.label || editedFields.customerName || editedFields.productCode || "-"}\nTitle: ${editedFields.title || editedFields.name || editedFields.productCode || "-"}\n\nThis will write to ShelfCycle.`
  );

  if (!confirmed) {
    submitStatusEl.textContent = "Submission cancelled.";
    return;
  }

  submitStatusEl.textContent = `Submitted to local runner: ${currentProposedAction.displayLabel || currentProposedAction.actionType}. Watch ShelfCycle, then verify the result.`;
  submitResultEl.textContent = "";
  setSubmitEnabled(false);

  try {
    const { id, token } = reviewUrlParams();
    const payload = await fetchJson(localOnlyApiUrl("/api/shelfcycle/submit-action"), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        reviewActionId: id || currentAction.id,
        token,
        actionId: currentProposedAction.id,
        actionType: currentProposedAction.actionType,
        selectedTarget: targetForSubmit,
        fields: editedFields,
        approvedByUser: true
      })
    }, {
      localOnly: true
    });

    submittedActionIds.add(currentProposedAction.id);
    submitResultEl.textContent = formatSubmitResult(payload);
    const createdTarget = targetFromSubmitResult(currentProposedAction, payload);
    const followOnContact = createdTarget ? applyApprovedTargetToFollowOnActions(createdTarget) : null;

    if (followOnContact) {
      currentProposedAction = followOnContact;
      selectedTarget = createdTarget;
      currentSubmission = null;
      renderActionFields(currentProposedAction);
      renderNoteTargetCard(currentAction, null);
      renderShelfCycleFormPreview(currentAction, null);
      setSubmitEnabled(requiredFieldsSatisfied(currentProposedAction, selectedTarget) && !submittedActionIds.has(currentProposedAction.id));
      submitStatusEl.textContent = `${createdTarget.label} was submitted to ShelfCycle. The contact action is now loaded with that ${createdTarget.kind} as the target; review it and approve if you want to add the contact too.`;
      return;
    }

    submitStatusEl.textContent = payload.ok
      ? "ShelfCycle action submitted. Verify the saved record in ShelfCycle."
      : "ShelfCycle submission failed.";
  } finally {
    setSubmitEnabled(requiredFieldsSatisfied() && !submittedActionIds.has(currentProposedAction?.id));
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
    submitStatusEl.textContent = error instanceof Error ? error.message : "ShelfCycle submission failed.";
  });
});

const initialReviewUrl = new URL(window.location.href).searchParams.get("reviewUrl") || "";
const initialAction = decodeActionParam(new URL(window.location.href).searchParams.get("action") || "");

if (initialAction) {
  currentAction = initialAction;
  currentProposedAction = chooseProposedAction(currentAction);
  submitTitleEl.textContent = currentAction.subject || "Ready to review";
  submitLedeEl.textContent = `Verify the ${currentSection} section below, then explicitly approve the local ShelfCycle action.`;
  setOutput(actionSummaryEl, formatActionSummary(currentAction));
  setOutput(executableActionsEl, formatExecutableActions((currentAction.proposedActions ?? []).filter((item) => item.executable).map((item) => ({
    label: item.displayLabel,
    description: item.selectedTarget?.label ? `Target: ${item.selectedTarget.label}` : "Ready for approval"
  }))));
  setOutput(submitWritePlanEl, formatWritePlanDisplay(currentAction.writePlan));
  setOutput(submitDraftNoteEl, formatDraftNoteDisplay(currentAction.draftNote));
  setOutput(submitWarningsEl, (currentAction.warnings ?? []).join("\n"));
  setOutput(submitResultEl, "");
  renderShelfCycleFormPreview(currentAction, null);
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
