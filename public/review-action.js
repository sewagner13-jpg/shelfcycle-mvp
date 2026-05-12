const titleEl = document.querySelector("#review-title");
const ledeEl = document.querySelector("#review-lede");
const relationshipChipEl = document.querySelector("#relationship-chip");
const stateChipEl = document.querySelector("#state-chip");
const createdAtEl = document.querySelector("#created-at");
const availableActionsEl = document.querySelector("#available-actions");
const participantsEl = document.querySelector("#participants");
const summaryEl = document.querySelector("#summary");
const ownerReadEl = document.querySelector("#owner-read");
const roleWorklistsEl = document.querySelector("#role-worklists");
const warningsEl = document.querySelector("#warnings");
const draftNoteEl = document.querySelector("#draft-note");
const writePlanEl = document.querySelector("#write-plan");
const suggestedCreatesEl = document.querySelector("#suggested-creates");
const documentsEl = document.querySelector("#documents");
const openLocalSubmitEl = document.querySelector("#open-local-submit");
const openChatGptEl = document.querySelector("#open-chatgpt");
const addPacketToShelfCycleEl = document.querySelector("#add-packet-to-shelfcycle");
const sectionShelfCycleLinks = document.querySelectorAll(".add-shelfcycle-section");
const reviewShelfCyclePreviewEl = document.querySelector("#review-shelfcycle-preview");
const operatorPacketEl = document.querySelector("#operator-packet");
const operatorNextStepEl = document.querySelector("#operator-next-step");
const operatorWhyEl = document.querySelector("#operator-why");
const shelfCycleStatusChipEl = document.querySelector("#shelfcycle-status-chip");

const LOCAL_MVP_API_BASE = "http://localhost:4318";
let currentAction = null;

function isLocalMvpHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

async function fetchReviewActionPayload(id = "", token = "") {
  const path = `/api/review-action?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
  const attempts = [path];

  if (!isLocalMvpHost()) {
    attempts.push(`${LOCAL_MVP_API_BASE}${path}`);
  }

  let lastResponse = null;

  for (const url of attempts) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      lastResponse = response;

      if (response.ok) {
        return response.json();
      }

      // Hosted Netlify and the local MVP own different review-packet stores.
      // If the first store misses, try the other one before reporting failure.
      if (![404, 405, 500].includes(response.status)) {
        break;
      }
    } catch {
      // Try the next API base.
    }
  }

  const message = lastResponse ? await lastResponse.text() : "Could not reach the local ClearEdge backend.";
  throw new Error(message || "Review packet unavailable.");
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

function compactText(value = "") {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripRawExtractionNoise(value = "") {
  return compactText(value)
    .replace(/^\s*#{1,6}\s*ClearEdge Intelligence Brief[\s\S]*?(?=\n\s*Thread Summary:|\n\s*Interaction Type:|$)/i, "")
    .replace(/\sAll the best,?[\s\S]*$/i, "")
    .replace(/\sBest regards,?[\s\S]*$/i, "")
    .replace(/\sThanks,?[\s\S]*$/i, "")
    .replace(/\b(?:old school crm|who needs ai|extracted gmail signatures)[\s\S]*$/i, "")
    .trim();
}

function splitReadyNoteSections(summary = "") {
  const sections = {};
  let current = "";

  for (const line of compactText(summary).split("\n")) {
    const header = line.match(/^([A-Za-z][A-Za-z /-]{1,40}):\s*$/);

    if (header) {
      current = header[1].trim();
      sections[current] = [];
      continue;
    }

    if (!current) {
      continue;
    }

    const item = line.replace(/^\s*-\s*/, "").trim();

    if (item) {
      sections[current].push(stripRawExtractionNoise(item));
    }
  }

  return sections;
}

function firstSectionItem(sections = {}, label = "") {
  return (sections[label] ?? []).find(Boolean) || "";
}

function sentence(value = "", fallback = "") {
  const text = stripRawExtractionNoise(value || fallback);

  if (!text) {
    return fallback;
  }

  return text.length > 260 ? `${text.slice(0, 257).trim()}...` : text;
}

function operatorLede(action = {}) {
  const note = notePreviewFromAction(action);
  const sections = splitReadyNoteSections(note.summary);
  const summary = firstSectionItem(sections, "Summary") || action.briefAi?.why || action.subject;
  const nextStep = firstSectionItem(sections, "Next step") || action.briefAi?.action;
  const parts = [
    sentence(summary, "Review this packet manually before updating ShelfCycle or following up."),
    nextStep ? `Next: ${sentence(nextStep)}` : ""
  ].filter(Boolean);

  return parts.join(" ");
}

function operatorCardHtml(title = "", value = "", tone = "") {
  return `
    <article class="operator-card ${tone ? `operator-card-${escapeHtml(tone)}` : ""}">
      <span>${escapeHtml(title)}</span>
      <p>${escapeHtml(sentence(value, "No clear detail found."))}</p>
    </article>
  `;
}

function listCardHtml(title = "", items = [], tone = "") {
  const cleanItems = items.map((item) => sentence(item)).filter(Boolean).slice(0, 5);

  return `
    <article class="operator-card ${tone ? `operator-card-${escapeHtml(tone)}` : ""}">
      <span>${escapeHtml(title)}</span>
      ${
        cleanItems.length
          ? `<ul>${cleanItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
          : "<p>No clear detail found.</p>"
      }
    </article>
  `;
}

function actionLabels(action = {}) {
  return (action.proposedActions ?? [])
    .map((item) => {
      const status = item.executable ? "ready for approval" : "preview only";
      return `${item.displayLabel || actionButtonLabel(item)} (${status})`;
    })
    .slice(0, 4);
}

function matchCandidates(matches = {}, keys = []) {
  return keys.flatMap((key) =>
    (matches[key] ?? []).map((entry) => ({
      ...(entry?.candidate ?? entry),
      score: entry?.score
    }))
  );
}

function candidateLabel(candidate = {}) {
  return candidate.name || candidate.customerName || candidate.supplierName || candidate.companyName || candidate.email || "";
}

function candidateRelationship(candidate = {}) {
  return String(candidate.companyType || candidate.type || candidate.raw?.company_type || "").trim().toLowerCase();
}

function shelfCycleStatusLabel(action = {}) {
  const matches = action.matches ?? action.analysis?.matches ?? {};
  const customer = matchCandidates(matches, ["customer", "customers"]).find((candidate) => candidateLabel(candidate));
  const supplier = matchCandidates(matches, ["supplier", "suppliers"]).find((candidate) => candidateLabel(candidate));
  const contacts = matchCandidates(matches, ["contact", "contacts"]);
  const customerContact = contacts.find((candidate) => candidateRelationship(candidate) === "customer" && candidateLabel(candidate));
  const supplierContact = contacts.find((candidate) => candidateRelationship(candidate) === "supplier" && candidateLabel(candidate));
  const creates = action.suggestedCreates ?? action.analysis?.suggestedCreates ?? [];

  if (customer) {
    return `Existing customer: ${candidateLabel(customer)}`;
  }

  if (supplier) {
    return `Existing supplier: ${candidateLabel(supplier)}`;
  }

  if (customerContact) {
    return `Existing customer contact: ${candidateLabel(customerContact)}`;
  }

  if (supplierContact) {
    return `Existing supplier contact: ${candidateLabel(supplierContact)}`;
  }

  if (creates.some((item) => item.type === "customer")) {
    return "No existing customer found; create candidate available.";
  }

  if (creates.some((item) => item.type === "supplier")) {
    return "No existing supplier found; create candidate available.";
  }

  return "No confirmed ShelfCycle match.";
}

function renderOperatorPacket(action = {}) {
  if (!operatorPacketEl) {
    return;
  }

  const note = notePreviewFromAction(action);
  const sections = splitReadyNoteSections(note.summary);
  const summary = firstSectionItem(sections, "Summary") || action.summary || action.subject;
  const status = firstSectionItem(sections, "Decision / status") || "No final decision was identified in this packet.";
  const nextStep = firstSectionItem(sections, "Next step") || action.briefAi?.action || "Review and decide whether this belongs in ShelfCycle.";
  const variables = sections["Key variables"] ?? [];
  const documents = sections["Documents referenced"] ?? [];
  const source = sections.Source ?? [];
  const actions = actionLabels(action);
  const shelfCycleStatus = shelfCycleStatusLabel(action);

  if (operatorNextStepEl) {
    operatorNextStepEl.textContent = sentence(nextStep, "Review and decide whether this belongs in ShelfCycle.");
  }

  if (operatorWhyEl) {
    operatorWhyEl.textContent = sentence(summary, "No clear summary was generated for this packet.");
  }

  if (shelfCycleStatusChipEl) {
    shelfCycleStatusChipEl.textContent = shelfCycleStatus;
  }

  operatorPacketEl.innerHTML = [
    operatorCardHtml("What happened", summary, "primary"),
    operatorCardHtml("Decision / status", status),
    operatorCardHtml("Next step", nextStep, "accent"),
    operatorCardHtml("ShelfCycle status", shelfCycleStatus),
    listCardHtml("ShelfCycle options", actions, actions.length ? "" : "muted"),
    listCardHtml("Key variables", variables, "muted"),
    listCardHtml("Documents", documents, documents.length ? "" : "muted"),
    listCardHtml("Source", source, "muted")
  ].join("");
}

function formatReadyNoteDisplay(action = {}) {
  const note = notePreviewFromAction(action);

  return note.summary || "No clean ShelfCycle note was generated for this packet.";
}

function isPdfDocument(item = {}) {
  const name = String(item.filename || item.name || "").toLowerCase();
  const mime = String(item.mimeType || "").toLowerCase();

  return name.endsWith(".pdf") || mime === "application/pdf";
}

function formatDocumentsHtml(workspaceArtifacts = {}) {
  const blocks = [];
  const attachments = workspaceArtifacts.attachments ?? [];
  const driveFiles = workspaceArtifacts.driveFiles ?? [];
  const pdfCount = [...attachments, ...driveFiles].filter(isPdfDocument).length;

  if (attachments.length) {
    blocks.push(`
      <div class="document-block">
        <strong>Attachments</strong>
        <ul>
          ${attachments.map((item) => `<li>${escapeHtml(item.filename || "Unnamed file")}${item.mimeType ? ` <span class="muted">(${escapeHtml(item.mimeType)})</span>` : ""}</li>`).join("")}
        </ul>
      </div>
    `);
  }

  if (driveFiles.length) {
    blocks.push(`
      <div class="document-block">
        <strong>Google Drive Files</strong>
        <ul>
          ${driveFiles.map((item) => `
            <li>
              ${item.webViewLink ? `<a href="${escapeHtml(item.webViewLink)}" target="_blank" rel="noreferrer">${escapeHtml(item.name || item.id || "Unnamed file")}</a>` : escapeHtml(item.name || item.id || "Unnamed file")}
              ${item.mimeType ? ` <span class="muted">(${escapeHtml(item.mimeType)})</span>` : ""}
            </li>
          `).join("")}
        </ul>
      </div>
    `);
  }

  if (workspaceArtifacts.driveFileIds?.length && !driveFiles.length && workspaceArtifacts.driveScopeAvailable === false) {
    blocks.push("<p class=\"small muted\">Google Drive files were linked in the thread, but metadata was not available.</p>");
  }

  if (!blocks.length) {
    return "<p>None</p>";
  }

  return `
    ${blocks.join("")}
    <div class="document-actions">
      <button type="button" class="button-link mini ghost" data-copy-pdfs ${pdfCount ? "" : "disabled"}>Copy PDFs to Desktop folder</button>
      <span class="small muted">${pdfCount ? `${pdfCount} PDF reference${pdfCount === 1 ? "" : "s"} detected.` : "No PDF attachments detected."}</span>
    </div>
    <p class="small muted" data-document-copy-status></p>
  `;
}

function fieldLabel(key = "") {
  return String(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatOwnerRead(briefAi = null) {
  if (!briefAi) {
    return "No AI owner read was attached to this review packet.";
  }

  const shelfCycle = briefAi.shelfCycleCandidate ?? {};
  const lines = [
    `Action: ${briefAi.action || "-"}`,
    `Why: ${briefAi.why || "-"}`,
    briefAi.ownerLens ? `Owner lens: ${briefAi.ownerLens}` : "",
    briefAi.priorityReason ? `Priority reason: ${briefAi.priorityReason}` : "",
    briefAi.riskNote ? `Risk: ${briefAi.riskNote}` : "",
    "",
    "Key details:",
    ...((briefAi.keyDetails ?? []).length ? briefAi.keyDetails.map((item) => `- ${item}`) : ["- None"]),
    "",
    "ShelfCycle candidate:",
    `- Consider: ${shelfCycle.shouldConsider ? "Yes" : "No"}`,
    `- Record type: ${shelfCycle.recordType || "-"}`,
    `- Title: ${shelfCycle.title || "-"}`,
    `- Summary: ${shelfCycle.summary || "-"}`,
    ...((shelfCycle.fields ?? []).length ? shelfCycle.fields.map((item) => `- Field: ${item}`) : [])
  ];

  return lines.filter((line) => line !== "").join("\n");
}

function formatDraftNoteDisplay(draftNote = null, action = {}) {
  if (action?.shelfCycleReadyNote?.summary) {
    const note = notePreviewFromAction(action);

    return [
      note.title ? `Title: ${note.title}` : "",
      note.type ? `Type: ${note.type}` : "",
      note.customer ? `Customer: ${note.customer}` : "",
      note.summary ? `Note:\n${note.summary}` : ""
    ].filter(Boolean).join("\n\n");
  }

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

function formatSuggestedCreatesDisplay(items = []) {
  if (!items.length) {
    return "No new contact, customer, or product record was suggested.";
  }

  return items.map((item, index) => {
    const lines = [
      `${index + 1}. ${fieldLabel(item.type || "record")} suggestion`,
      item.name ? `Name: ${item.name}` : "",
      item.companyName ? `Company: ${item.companyName}` : "",
      item.email ? `Email: ${item.email}` : "",
      item.phone ? `Phone: ${item.phone}` : "",
      item.reason ? `Why: ${item.reason}` : ""
    ].filter(Boolean);

    return lines.join("\n");
  }).join("\n\n");
}

function executableAction(action = currentAction) {
  return (action?.proposedActions ?? []).find((item) => item.executable) ?? null;
}

function actionButtonLabel(proposedAction = {}) {
  return {
    customer_note: "Add Note to ShelfCycle",
    customer_create: "Create Customer in ShelfCycle",
    supplier_create: "Create Supplier in ShelfCycle",
    contact_create: "Create Contact in ShelfCycle",
    pricing_record: "Add Pricing to ShelfCycle",
    product_create_or_update: "Create Product in ShelfCycle",
    product_document_followup: "Upload Product Document",
    order_or_logistics_note: "Add Logistics Note"
  }[proposedAction.actionType] || "Add to ShelfCycle";
}

function localSubmitUrl(section = "packet", proposedAction = executableAction()) {
  const url = new URL("http://localhost:4318/review-submit.html");
  url.searchParams.set("reviewUrl", window.location.href);
  url.searchParams.set("section", section);

  if (proposedAction?.id) {
    url.searchParams.set("actionId", proposedAction.id);
    url.searchParams.set("actionType", proposedAction.actionType);
  }

  return url.href;
}

function shelfField(label, value = "", { multiline = false } = {}) {
  const control = multiline
    ? `<textarea readonly>${escapeHtml(value || "")}</textarea>`
    : `<input type="text" readonly value="${escapeHtml(value || "")}" />`;

  return `
    <label>
      <span>${escapeHtml(label)}</span>
      ${control}
    </label>
  `;
}

function asArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
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

function collectPreviewMentions(action = {}, proposedAction = null, customer = "") {
  const mentions = [];

  if (customer && customer !== "No matched ShelfCycle customer") {
    mentions.push({
      kind: "customer",
      label: customer,
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

function shelfCycleNotePreviewHtml({ customer = "", targetUrl = "", note = {}, mentions = [], hasTarget = false } = {}) {
  return `
    <article class="shelfcycle-note-modal-preview">
      <div class="shelfcycle-modal-title-row">
        <h3>New Note</h3>
        <span class="status-pill ${hasTarget ? "status-ready" : "status-review"}">${hasTarget ? "Target selected" : "Review before save"}</span>
      </div>

      <div class="shelfcycle-top-fields">
        ${shelfField("Date", note.date || "")}
        ${shelfField("Type", note.type || "")}
        ${shelfField("Title", note.title || "")}
      </div>

      <div class="shelfcycle-relation-row">
        <div>
          <strong>Customer: ${escapeHtml(customer || "No matched ShelfCycle customer")}</strong>
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

function parseCandidateFields(fields = []) {
  const parsed = {};

  for (const field of fields) {
    const [rawKey, ...rest] = String(field).split(":");

    if (rawKey && rest.length) {
      parsed[rawKey.trim()] = rest.join(":").trim();
    }
  }

  return parsed;
}

function genericFieldsHtml(fields = {}, labels = []) {
  const keys = labels.length
    ? labels
    : Object.keys(fields).filter((key) => !Array.isArray(fields[key]) && fields[key] !== null && typeof fields[key] !== "object");

  return keys
    .map((key) => shelfField(fieldLabel(key), fields[key] || "", { multiline: key === "note" || String(fields[key] || "").length > 90 }))
    .join("");
}

function proposedActionPreviewCards(action = {}) {
  return (action.proposedActions ?? [])
    .filter((item) => ["supplier_create", "customer_create", "contact_create"].includes(item.actionType))
    .map((item) => {
      const fields = item.fieldValues ?? {};
      const supplier = item.actionType === "supplier_create";
      const customer = item.actionType === "customer_create";
      const contact = item.actionType === "contact_create";
      const title = supplier
        ? "New Supplier Preview"
        : customer
          ? "New Customer Preview"
          : "New Contact Preview";
      const labels = supplier
        ? ["name", "phone", "email", "website", "street1", "street2", "city", "country", "stateRegion", "zip"]
        : customer
          ? ["name", "email", "website", "phoneNumber", "streetAddress", "streetAddress2", "city", "stateRegion", "zip", "country", "prospect"]
          : ["name", "title", "email", "phone", "mobilePhone", "companyType", "documentTypes"];
      const warnings = (item.warnings ?? []).length
        ? `<p class="small muted">${escapeHtml(item.warnings.join(" "))}</p>`
        : "";
      const actionLink = item.executable
        ? `<a class="button-link mini primary" href="${localSubmitUrl(item.actionType, item)}" target="_blank" rel="noreferrer">Approve ${supplier ? "Supplier" : customer ? "Customer" : "Contact"}</a>`
        : "";

      return `
        <article class="shelfcycle-form-card">
          <div class="shelfcycle-form-header">
            <div>
              <p class="section-kicker">Proposed ${escapeHtml(item.actionType.replace(/_/g, " "))}</p>
              <h3>${escapeHtml(title)}</h3>
            </div>
            <span class="status-pill ${item.executable ? "status-ready" : "status-review"}">${item.executable ? "Ready for approval" : "Needs review"}</span>
          </div>
          <div class="shelfcycle-field-grid">
            ${genericFieldsHtml(fields, labels)}
          </div>
          ${warnings}
          ${actionLink ? `<div class="shelfcycle-form-actions">${actionLink}</div>` : ""}
        </article>
      `;
    })
    .join("");
}

function notePreviewFromAction(action = {}) {
  const draftNote = action.draftNote ?? {};
  const fields = action.writePlan?.fields ?? {};
  const candidate = action.briefAi?.shelfCycleCandidate ?? null;
  const readyNote = action.shelfCycleReadyNote ?? {};
  const summary = [
    readyNote.summary || "",
    draftNote.summary || fields.summary || action.summary || ""
  ].filter(Boolean)[0] || "";

  return {
    customer: action.matches?.customer?.[0]?.candidate?.name || "No matched ShelfCycle customer",
    date: fields.date || new Date().toISOString().slice(0, 10),
    type: draftNote.type || fields.type || "Email",
    title: readyNote.title || candidate?.title || draftNote.title || fields.title || action.subject || "ClearEdge note",
    summary
  };
}

async function copyPdfDocumentsToDesktop() {
  const statusEl = documentsEl?.querySelector("[data-document-copy-status]");

  if (!currentAction?.id) {
    if (statusEl) {
      statusEl.textContent = "Review packet is not loaded yet.";
    }
    return;
  }

  const token = new URLSearchParams(window.location.search).get("token") || "";

  if (statusEl) {
    statusEl.textContent = "Copying PDF references to Desktop folder...";
  }

  try {
    const endpoint = isLocalMvpHost()
      ? "/api/review-action/copy-documents"
      : `${LOCAL_MVP_API_BASE}/api/review-action/copy-documents`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewActionId: currentAction.id,
        token
      })
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message || payload.message || "Could not copy PDFs.");
    }

    const copied = payload.copied?.length ?? 0;
    const unavailable = payload.unavailable?.length ?? 0;

    if (statusEl) {
      statusEl.textContent = `Desktop folder: ${payload.folderPath}. Copied ${copied}; unavailable ${unavailable}.`;
    }
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = error instanceof Error ? error.message : "Could not copy PDFs.";
    }
  }
}

function renderDocuments(workspaceArtifacts = {}) {
  if (!documentsEl) {
    return;
  }

  documentsEl.innerHTML = formatDocumentsHtml(workspaceArtifacts);
  documentsEl.querySelector("[data-copy-pdfs]")?.addEventListener("click", () => {
    copyPdfDocumentsToDesktop();
  });
}

function renderReviewShelfCyclePreview(action = {}) {
  if (!reviewShelfCyclePreviewEl) {
    return;
  }

  const note = notePreviewFromAction(action);
  const noteAction = (action.proposedActions ?? []).find((item) => item.actionType === "customer_note") ?? executableAction(action);
  const selectedTarget = noteAction?.selectedTarget ?? null;
  const noteCustomer = selectedTarget?.label || note.customer;
  const targetUrl = selectedTarget?.id
    ? `https://app.shelfcycle.com/org-clearedge/customers/${selectedTarget.id}/notes`
    : "";
  const noteWithActionFields = {
    ...note,
    date: noteAction?.fieldValues?.date || note.date,
    type: noteAction?.fieldValues?.type || note.type,
    title: noteAction?.fieldValues?.title || note.title,
    summary: noteAction?.fieldValues?.note || note.summary
  };
  const mentions = collectPreviewMentions(action, noteAction, noteCustomer);
  const candidate = action.briefAi?.shelfCycleCandidate ?? null;
  const candidateFields = parseCandidateFields(candidate?.fields ?? []);
  const suggestedCreates = (action.suggestedCreates ?? []).map((item) => `
    <article class="shelfcycle-form-card">
      <div class="shelfcycle-form-header">
        <div>
          <p class="section-kicker">Suggested ${escapeHtml(item.type || "Record")}</p>
          <h3>${escapeHtml(item.type === "contact" ? "New Contact Preview" : "New Record Preview")}</h3>
        </div>
        <span class="status-pill status-review">Manual create</span>
      </div>
      <div class="shelfcycle-field-grid">
        ${shelfField("Name", item.name || "")}
        ${shelfField("Email", item.email || "")}
        ${shelfField("Company", item.companyName || "")}
        ${shelfField("Phone", item.phone || "")}
      </div>
    </article>
  `).join("");

  reviewShelfCyclePreviewEl.innerHTML = `
    ${shelfCycleNotePreviewHtml({
      customer: noteCustomer,
      targetUrl,
      note: noteWithActionFields,
      mentions,
      hasTarget: Boolean(selectedTarget?.id || selectedTarget?.label)
    })}
    ${proposedActionPreviewCards(action)}
    ${
      candidate?.shouldConsider
        ? `<article class="shelfcycle-form-card">
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
              ${shelfField("Supplier", candidateFields.supplier || "")}
              ${shelfField("Product", candidateFields.product || "")}
              ${shelfField("Action", candidateFields.action || action.briefAi?.action || "", { multiline: true })}
              ${shelfField("Summary", candidate.summary || "", { multiline: true })}
            </div>
          </article>`
        : ""
    }
    ${suggestedCreates}
  `;
}

function updateShelfCycleLinks() {
  const proposedAction = executableAction();
  const canSubmit = Boolean(proposedAction);

  if (openLocalSubmitEl) {
    openLocalSubmitEl.href = localSubmitUrl("packet", proposedAction);
  }

  if (addPacketToShelfCycleEl) {
    addPacketToShelfCycleEl.href = localSubmitUrl("packet", proposedAction);
    addPacketToShelfCycleEl.hidden = !canSubmit;
  }

  for (const link of sectionShelfCycleLinks) {
    link.href = localSubmitUrl(link.dataset.section || "packet", proposedAction);
    link.hidden = !canSubmit;
  }
}

function renderAvailableActions(action = {}) {
  const proposedActions = action.proposedActions ?? [];

  if (!proposedActions.length) {
    availableActionsEl.innerHTML = '<span class="pill muted-pill">No manual actions detected.</span>';
    return;
  }

  availableActionsEl.innerHTML = proposedActions
    .map((proposedAction) => {
      const warnings = proposedAction.warnings?.length
        ? `<span>${proposedAction.warnings.map(escapeHtml).join(" ")}</span>`
        : `<span>${proposedAction.executable ? "Ready for local approval." : "Preview only."}</span>`;
      const submitLink = proposedAction.executable
        ? `<a class="button-link mini primary" href="${localSubmitUrl(proposedAction.actionType, proposedAction)}" target="_blank" rel="noreferrer">${escapeHtml(actionButtonLabel(proposedAction))}</a>`
        : "";

      return `
        <article class="pill-card">
          <strong>${escapeHtml(proposedAction.displayLabel)}</strong>
          <span class="status-pill ${proposedAction.executable ? "status-ready" : "status-review"}">${proposedAction.executable ? "Executable" : "Preview only"}</span>
          ${warnings}
          ${submitLink}
        </article>
      `;
    })
    .join("");
}

function renderAction(action = {}) {
  currentAction = action;
  titleEl.textContent = action.subject || "ClearEdge review packet";
  ledeEl.textContent = operatorLede(action);
  relationshipChipEl.textContent = action.relationship?.relationship || "-";
  stateChipEl.textContent = action.state?.state || "-";
  createdAtEl.textContent = formatDate(action.createdAt);
  renderOperatorPacket(action);
  renderAvailableActions(action);
  renderReviewShelfCyclePreview(action);
  setOutput(participantsEl, formatParticipants(action.externalParticipants));
  setOutput(summaryEl, formatReadyNoteDisplay(action));
  setOutput(ownerReadEl, formatOwnerRead(action.briefAi));
  setOutput(roleWorklistsEl, formatRoleWorklists(action.roleWorklists ?? {}));
  setOutput(warningsEl, (action.warnings ?? []).length ? action.warnings.join("\n") : "None");
  setOutput(draftNoteEl, formatDraftNoteDisplay(action.draftNote, action));
  setOutput(writePlanEl, formatWritePlanDisplay(action.writePlan));
  setOutput(suggestedCreatesEl, formatSuggestedCreatesDisplay(action.suggestedCreates ?? []));
  renderDocuments(action.workspaceArtifacts ?? {});
  updateShelfCycleLinks();
  openChatGptEl.href = action.chatGptUrl || "https://chatgpt.com/";
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

  const payload = await fetchReviewActionPayload(id, token);
  renderAction(payload.action ?? {});
}

loadReviewAction().catch((error) => {
  titleEl.textContent = "Review packet unavailable";
  ledeEl.textContent = error instanceof Error ? error.message : "Unexpected error loading the review packet.";
});
