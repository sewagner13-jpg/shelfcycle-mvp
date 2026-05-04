function formatTime(timestamp = 0, locale = "en-US", timeZone = "America/New_York") {
  if (!timestamp) {
    return "";
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone
  }).format(new Date(timestamp));
}

function firstExternalParticipant(item = {}) {
  return item.externalParticipants?.[0] ?? null;
}

function isOpsVendorThread(item = {}) {
  return item.relationship?.subtype === "ops_vendor";
}

function isSolicitationThread(item = {}) {
  return item.relationship?.relationship === "solicitation";
}

function isCoreBusinessThread(item = {}) {
  return (
    (item.relationship?.relationship === "customer" || item.relationship?.relationship === "supplier") &&
    !isOpsVendorThread(item) &&
    !isSolicitationThread(item)
  );
}

function shouldIncludeRoleActions(item = {}) {
  return isCoreBusinessThread(item);
}

function sortByPriorityAndTime(items = []) {
  return [...items].sort((left, right) => {
    const scoreDelta = (right.priorityScore ?? 0) - (left.priorityScore ?? 0);

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return (right.lastTimestamp ?? 0) - (left.lastTimestamp ?? 0);
  });
}

function deriveNextStep(item = {}) {
  if (item.briefAi?.action) {
    return item.briefAi.action;
  }

  if (isSolicitationThread(item)) {
    return "Ignore unless strategically relevant.";
  }

  if (isOpsVendorThread(item)) {
    const text = `${item.subject || ""}\n${item.summary || ""}`;

    if (/\binvoice\b|\bpayment due\b|\bpast due\b|\bdebit\b|\bpayroll\b/i.test(text)) {
      return "Review with finance or ops; no ShelfCycle update needed.";
    }

    if (/\bstatement\b|\breceipt\b|\bsecurity\b|\bpassword\b/i.test(text)) {
      return "Review for ops or admin follow-up; no ShelfCycle update needed.";
    }

    return "Review for ops or admin follow-up; no ShelfCycle update needed.";
  }

  if (item.relationship?.relationship === "employee") {
    return "Review internally if needed.";
  }

  const actionCategory = actionType(item);

  if (actionCategory === "Orders / POs to Confirm") {
    return item.reviewUrl
      ? "Review order details and decide whether to confirm or update ShelfCycle."
      : "Review order details and decide whether to confirm.";
  }

  if (actionCategory === "Pricing / Quote Decisions") {
    return item.reviewUrl
      ? "Review pricing and decide whether to quote, update pricing, or log the decision in ShelfCycle."
      : "Review pricing and decide whether to quote or update pricing.";
  }

  if (actionCategory === "Documents / Compliance") {
    return item.reviewUrl
      ? "Review the document request and decide whether to attach SDS, TDS, COA, or specs to the product record."
      : "Review the document request and send or file the needed technical document.";
  }

  if (actionCategory === "Shipment / Logistics") {
    return item.reviewUrl
      ? "Confirm shipment, release, pickup, or delivery details before updating ShelfCycle."
      : "Confirm shipment, release, pickup, or delivery details.";
  }

  const roleAction =
    item.analysis?.roleWorklists?.sales?.[0] ||
    item.analysis?.roleWorklists?.procurement?.[0] ||
    item.analysis?.roleWorklists?.owner?.[0];

  if (roleAction) {
    return item.reviewUrl ? `${roleAction} Review the packet before changing ShelfCycle.` : roleAction;
  }

  if (item.reviewUrl) {
    return "Open the manual review packet before updating ShelfCycle.";
  }

  return "";
}

function artifactSuffix(item = {}) {
  const attachments = (item.workspaceArtifacts?.attachments ?? []).filter((attachment) =>
    isMeaningfulAttachment(attachment.filename, attachment.mimeType)
  );
  const driveFiles = item.workspaceArtifacts?.driveFiles ?? [];
  const driveIds = item.workspaceArtifacts?.driveFileIds ?? [];

  if (attachments.length) {
    const names = attachments
      .map((attachment) => attachment.filename)
      .filter(Boolean)
      .slice(0, 2)
      .join(", ");
    return names ? ` | Docs: ${names}` : "";
  }

  if (driveFiles.length) {
    const names = driveFiles
      .map((file) => file.name)
      .filter(Boolean)
      .slice(0, 2)
      .join(", ");
    return names ? ` | Docs: ${names}` : "";
  }

  if (driveIds.length && item.workspaceArtifacts?.driveScopeAvailable === false) {
    return " | Docs: linked Google files detected";
  }

  return "";
}

function isMeaningfulAttachment(filename = "", mimeType = "") {
  const name = String(filename).trim().toLowerCase();
  const type = String(mimeType).trim().toLowerCase();

  if (!name) {
    return false;
  }

  if (/\b(sds|tds|coa|quote|pricing|po|purchase order|invoice|statement|spec|specification)\b/i.test(name)) {
    return true;
  }

  if (/(pdf|doc|docx|xls|xlsx|csv|txt)$/i.test(name)) {
    return true;
  }

  if (type.startsWith("application/pdf") || type.includes("spreadsheet") || type.includes("wordprocessing")) {
    return true;
  }

  return false;
}

function truncateInsight(text = "", maxLength = 92) {
  const normalized = String(text).trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function gmailThreadUrl(item = {}) {
  if (item.source && item.source !== "gmail") {
    return "";
  }

  if (!item.threadId) {
    return "";
  }

  return `https://mail.google.com/mail/u/0/#inbox/${item.threadId}`;
}

function messagesThreadUrl(item = {}) {
  if (item.source !== "messages") {
    return "";
  }

  const participant = firstExternalParticipant(item);
  const raw = participant?.email || "";
  const digits = raw.replace(/[^\d+]/g, "");

  if (!digits) {
    return "";
  }

  return `sms:${digits}`;
}

function chatGptUrlForItem(item = {}, nextStep = "") {
  if (!nextStep) {
    return "";
  }

  const participant = firstExternalParticipant(item);
  const shelfCycleCandidate = item.briefAi?.shelfCycleCandidate;
  const prompt = [
    "Help me decide the best real next step for this ClearEdge Solutions thread.",
    "Think like Sean Wagner, president of ClearEdge: sales, procurement, pricing, customer/supplier relationships, and ShelfCycle data quality all matter.",
    `Subject: ${item.subject || "No subject"}`,
    `Contact: ${participant?.name || participant?.email || "Unknown"}`,
    `Relationship: ${item.relationship?.relationship || "unknown"}`,
    `Silo: ${item.silo?.name || "unknown"}`,
    item.briefAi?.why ? `Why it matters: ${item.briefAi.why}` : "",
    `Suggested next step: ${nextStep}`,
    shelfCycleCandidate?.shouldConsider
      ? `ShelfCycle candidate to review: ${shelfCycleCandidate.recordType || "record"} - ${shelfCycleCandidate.title || ""} - ${shelfCycleCandidate.summary || ""}`
      : "",
    item.reviewUrl ? `Review packet: ${item.reviewUrl}` : "",
    "Keep the recommendation practical, approval-first, and avoid creating ShelfCycle records unless I explicitly decide to."
  ].filter(Boolean).join("\n");

  return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
}

function intelligenceSuffix(item = {}) {
  const intelligenceContext = item.analysis?.intelligenceContext ?? item.analysis?.notebookContext;

  if (intelligenceContext?.status !== "matched") {
    return "";
  }

  const matchedEntry = intelligenceContext.matchedEntry ?? {};
  const points = [];

  if (matchedEntry.lastKnownGoodPrice) {
    points.push(`Price ${matchedEntry.lastKnownGoodPrice}`);
  }

  const preferredSignals =
    item.silo?.name === "logistics"
      ? matchedEntry.logisticsNuances
      : item.silo?.name === "compliance"
        ? matchedEntry.complianceNotes
        : matchedEntry.commercialBenchmarks;

  for (const signal of preferredSignals ?? []) {
    if (signal && points.length < 2) {
      points.push(signal);
    }
  }

  for (const fallbackSignal of [...(matchedEntry.historicalNotes ?? []), ...(matchedEntry.logisticsNuances ?? []), ...(matchedEntry.complianceNotes ?? [])]) {
    if (fallbackSignal && points.length < 2 && !points.includes(fallbackSignal)) {
      points.push(fallbackSignal);
    }
  }

  if (!points.length) {
    return "";
  }

  return ` | Intelligence: ${points.map((point) => truncateInsight(point)).join(" / ")}`;
}

function compactLine(item, { timeZone, locale }) {
  const participant = firstExternalParticipant(item);
  const who = participant?.name || participant?.email || "Unknown sender";
  const domain = participant?.domain ? ` | ${participant.domain}` : "";
  const time = formatTime(item.lastTimestamp, locale, timeZone);
  const nextStep = deriveNextStep(item);
  const keyPoint = item.analysis?.rawExtracts?.keyPoints?.[0] || item.analysis?.rawExtracts?.actionItems?.[0] || "";
  const docs = artifactSuffix(item);
  const silo = item.silo?.name ? ` | ${item.silo.name}` : "";
  const intelligence = intelligenceSuffix(item);
  const gmail = gmailThreadUrl(item) ? ` | Gmail: ${gmailThreadUrl(item)}` : "";
  const messages = messagesThreadUrl(item) ? ` | Messages: ${messagesThreadUrl(item)}` : "";
  const review = item.reviewUrl ? ` | Review: ${item.reviewUrl}` : "";
  const chatgpt = chatGptUrlForItem(item, nextStep) ? ` | Decide in ChatGPT: ${chatGptUrlForItem(item, nextStep)}` : "";

  return `- ${who}${domain} | ${item.subject || "No subject"} | ${time} | ${item.relationship.relationship}${silo} | ${keyPoint || "No concise summary available"}${docs}${intelligence}${nextStep ? ` | Next: ${nextStep}` : ""}${gmail}${messages}${review}${chatgpt}`;
}

function sumRoleWorklists(items = [], role) {
  const actions = [];

  for (const item of items) {
    if (!shouldIncludeRoleActions(item)) {
      continue;
    }

    for (const action of item.analysis?.roleWorklists?.[role] ?? []) {
      if (!actions.includes(action)) {
        actions.push(action);
      }
    }
  }

  return actions;
}

function gatherIntelligenceCoverage(items = []) {
  const learningPrompts = [];
  const contradictions = [];
  const seenPrompts = new Set();
  const seenContradictions = new Set();

  for (const item of items) {
    const analysis = item.analysis ?? {};
    const context = analysis.intelligenceContext ?? analysis.notebookContext ?? null;
    const prompt = analysis.learningPrompt;
    const status = context?.status;

    if (status === "no_historical_context" && prompt && !seenPrompts.has(prompt)) {
      seenPrompts.add(prompt);
      learningPrompts.push(prompt);
    }

    if (status === "matched") {
      for (const contradiction of context?.contradictions ?? []) {
        if (contradiction && !seenContradictions.has(contradiction)) {
          seenContradictions.add(contradiction);
          contradictions.push(contradiction);
        }
      }
    }
  }

  return { learningPrompts, contradictions };
}

function gatherShelfCycleActions(items = []) {
  const actions = [];

  for (const item of items) {
    if (!isCoreBusinessThread(item)) {
      continue;
    }

    const title = item.analysis?.draftNote?.title || item.subject || "email thread";
    const attachmentNames = (item.workspaceArtifacts?.attachments ?? [])
      .map((attachment) => attachment.filename)
      .filter(Boolean);
    const reviewTarget = item.reviewUrl ? ` Open review packet: ${item.reviewUrl}` : "";

    if (item.analysis?.draftNote?.summary) {
      actions.push(`Review the draft note and action plan for ${title}.${reviewTarget}`);
    }

    if (item.analysis?.suggestedCreates?.length) {
      actions.push(
        `Review ${item.analysis.suggestedCreates.length} suggested contact or account draft(s) from ${title} before creating anything.${reviewTarget}`
      );
    }

    if (attachmentNames.some((name) => /\b(sds|tds|coa)\b/i.test(name))) {
      actions.push(`Review attached technical documents from ${title} and decide whether to link them to a product record.${reviewTarget}`);
    }

    for (const warning of item.analysis?.warnings ?? []) {
      actions.push(`Check warning from ${title}: ${warning}.${reviewTarget}`);
    }
  }

  return [...new Set(actions)];
}

function hasMessageMemoryContent(section = {}) {
  if (!section) {
    return false;
  }

  return [
    section.urgent_items,
    section.business_threads,
    section.unanswered_messages,
    section.memory_candidates,
    section.suggested_followups,
    section.low_priority_summary
  ].some((items) => Array.isArray(items) && items.length);
}

function messageMemoryCounts(section = {}) {
  return {
    urgent: section.urgent_items?.length ?? 0,
    businessThreads: section.business_threads?.length ?? 0,
    unanswered: section.unanswered_messages?.length ?? 0,
    memoryCandidates: section.memory_candidates?.length ?? 0,
    unknownContacts: section.unknown_contacts?.length ?? 0,
    followups: section.suggested_followups?.length ?? 0
  };
}

function formatMessageMemoryItem(item = {}) {
  const parts = [
    item.contact || "Unknown",
    item.subject || item.summary || "",
    item.relationship ? `[${item.relationship}]` : "",
    item.silo ? `[${item.silo}]` : "",
    item.summary || "",
    item.next_step ? `Next: ${item.next_step}` : ""
  ].filter(Boolean);

  const chatgpt = item.next_step
    ? ` | Decide in ChatGPT: https://chatgpt.com/?q=${encodeURIComponent(`Help me decide the best real next step for this ClearEdge Solutions text-message thread.\nContact: ${item.contact || "Unknown"}\nSubject: ${item.subject || ""}\nSuggested next step: ${item.next_step}\nKeep it practical and approval-first.`)}`
    : "";

  return `- ${parts.join(" | ")}${chatgpt}`;
}

function appendMessageMemorySection(sections = [], messageMemory = null) {
  if (!messageMemory || !hasMessageMemoryContent(messageMemory)) {
    return;
  }

  sections.push("", messageMemory.section || "Message Memory");

  const mappings = [
    ["Urgent Items", messageMemory.urgent_items, formatMessageMemoryItem],
    ["Business Threads", messageMemory.business_threads, formatMessageMemoryItem],
    ["Unanswered Messages", messageMemory.unanswered_messages, formatMessageMemoryItem],
    [
      "Memory Candidates",
      messageMemory.memory_candidates,
      (item) => `- ${item.contact || "Unknown"} | ${item.memoryType || "memory"} | ${item.summary || ""}`
    ],
    [
      "Suggested Follow-Ups",
      messageMemory.suggested_followups,
      (item) => `- ${item.summary || ""}`
    ],
    [
      "Low Priority Summary",
      messageMemory.low_priority_summary,
      (item) => `- ${(item.contact ? `${item.contact} | ` : "")}${item.summary || ""}`
    ]
  ];

  for (const [heading, items, formatter] of mappings) {
    sections.push(heading);
    sections.push(...(items?.length ? items.map((item) => formatter(item)) : ["- None"]));
  }
}

function buildLegacyDailyBrief({
  analyzedThreads = [],
  organization = "ClearEdge Solutions",
  title = "Daily ClearEdge Email Brief",
  messageMemory = null,
  generatedAt = new Date().toISOString(),
  timeZone = "America/New_York",
  locale = "en-US"
} = {}) {
  const sorted = sortByPriorityAndTime(analyzedThreads);
  const needsAttention = sorted.filter(
    (item) =>
      item.state.state === "needs_attention" &&
      ["customer", "supplier", "employee"].includes(item.relationship.relationship)
  );
  const waitingOnOthers = sorted.filter(
    (item) =>
      item.state.state === "waiting_on_other_side" &&
      ["customer", "supplier"].includes(item.relationship.relationship)
  );
  const internal = sorted.filter(
    (item) => item.relationship.relationship === "employee" || item.state.state === "informational"
  );
  const solicitations = sorted.filter((item) => item.relationship.relationship === "solicitation");
  const ownerActions = sumRoleWorklists(sorted, "owner");
  const salesActions = sumRoleWorklists(sorted, "sales");
  const procurementActions = sumRoleWorklists(sorted, "procurement");
  const shelfCycleActions = gatherShelfCycleActions(sorted);
  const intelligenceCoverage = gatherIntelligenceCoverage(sorted);
  const hasIntelligenceCoverage =
    intelligenceCoverage.learningPrompts.length > 0 || intelligenceCoverage.contradictions.length > 0;
  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone
  }).format(new Date(generatedAt));

  const sections = [
    title,
    `Organization: ${organization}`,
    `Generated: ${dateLabel}`,
    "",
    `Coverage Summary`,
    `- Threads reviewed: ${sorted.length}`,
    `- Needs attention: ${needsAttention.length}`,
    `- Waiting on others: ${waitingOnOthers.length}`,
    `- Internal/FYI: ${internal.length}`,
    `- Likely solicitations: ${solicitations.length}`,
    ...(hasMessageMemoryContent(messageMemory)
      ? [
          `- Message business threads: ${messageMemoryCounts(messageMemory).businessThreads}`,
          `- Unknown message contacts: ${messageMemoryCounts(messageMemory).unknownContacts}`,
          `- Message follow-ups: ${messageMemoryCounts(messageMemory).followups}`
        ]
      : [])
  ];

  appendMessageMemorySection(sections, messageMemory);

  sections.push(
    "",
    `Needs Attention`,
    ...(needsAttention.length
      ? needsAttention.slice(0, 12).map((item) => compactLine(item, { timeZone, locale }))
      : ["- None"]),
    "",
    `Waiting On Others`,
    ...(waitingOnOthers.length
      ? waitingOnOthers.slice(0, 12).map((item) => compactLine(item, { timeZone, locale }))
      : ["- None"]),
    "",
    `Internal / FYI`,
    ...(internal.length ? internal.slice(0, 10).map((item) => compactLine(item, { timeZone, locale })) : ["- None"]),
    "",
    `Likely Solicitations`,
    ...(solicitations.length
      ? solicitations.slice(0, 10).map((item) => compactLine(item, { timeZone, locale }))
      : ["- None"]),
    "",
    `Role Actions`,
    `Owner`,
    ...(ownerActions.length ? ownerActions.slice(0, 8).map((item) => `- ${item}`) : ["- None"]),
    `Sales`,
    ...(salesActions.length ? salesActions.slice(0, 10).map((item) => `- ${item}`) : ["- None"]),
    `Procurement`,
    ...(procurementActions.length ? procurementActions.slice(0, 10).map((item) => `- ${item}`) : ["- None"]),
    "",
    `ShelfCycle Follow-Through`,
    ...(shelfCycleActions.length ? shelfCycleActions.slice(0, 12).map((item) => `- ${item}`) : ["- None"])
  );

  if (hasIntelligenceCoverage) {
    sections.push("", `ClearEdge Intelligence Coverage`);

    if (intelligenceCoverage.learningPrompts.length) {
      sections.push(
        `Add to Intelligence Library`,
        ...intelligenceCoverage.learningPrompts.slice(0, 8).map((item) => `- ${item}`)
      );
    }

    if (intelligenceCoverage.contradictions.length) {
      sections.push(
        `Reconcile with Intelligence`,
        ...intelligenceCoverage.contradictions.slice(0, 8).map((item) => `- ${item}`)
      );
    }
  }

  return sections.join("\n");
}

function relationshipLabel(item = {}) {
  return [item.relationship?.relationship, item.silo?.name]
    .filter(Boolean)
    .map((value) => String(value).replace(/_/g, " "))
    .join(" / ");
}

function statusLabel(item = {}) {
  if (item.state?.state === "needs_attention") {
    return "Needs Sean";
  }

  if (item.state?.state === "waiting_on_other_side") {
    return "Waiting on others";
  }

  return item.state?.state ? String(item.state.state).replace(/_/g, " ") : "Informational";
}

function priorityLabel(item = {}) {
  if (item.state?.state === "needs_attention" && (item.priorityScore ?? 0) >= 95) {
    return "HIGH PRIORITY";
  }

  if (item.state?.state === "needs_attention") {
    return "PRIORITY";
  }

  if (item.state?.state === "waiting_on_other_side") {
    return "WAITING";
  }

  return "FYI";
}

function actionType(item = {}) {
  const text = [
    item.subject,
    item.summary,
    item.silo?.name,
    item.analysis?.draftNote?.summary,
    item.analysis?.rawExtracts?.keyPoints?.join("\n"),
    item.analysis?.rawExtracts?.actionItems?.join("\n"),
    item.analysis?.roleWorklists?.sales?.join("\n"),
    item.analysis?.roleWorklists?.procurement?.join("\n")
  ].filter(Boolean).join("\n");

  if (/\b(po|purchase order|order confirmation|order number|backorder)\b/i.test(text)) {
    return "Orders / POs to Confirm";
  }

  if (isOpsVendorThread(item) || /\b(invoice|payment|statement|past due|debit|receipt)\b/i.test(text)) {
    return "Payments / Invoices";
  }

  if (item.silo?.name === "logistics" || /\b(container|shipment|freight|carrier|pickup|delivery|vessel|port|bol|bill of lading)\b/i.test(text)) {
    return "Shipment / Logistics";
  }

  if (item.silo?.name === "compliance" || /\b(sds|tds|coa|spec|certificate|document|data sheet)\b/i.test(text)) {
    return "Documents / Compliance";
  }

  if (item.silo?.name === "commercial" || /\b(price|pricing|quote|availability|lead time|cost)\b/i.test(text)) {
    return "Pricing / Quote Decisions";
  }

  return "Follow-Ups";
}

function keyPoint(item = {}) {
  return (
    item.briefAi?.why ||
    item.analysis?.rawExtracts?.keyPoints?.[0] ||
    item.analysis?.rawExtracts?.actionItems?.[0] ||
    item.analysis?.draftNote?.summary ||
    item.summary ||
    "No concise summary available."
  );
}

function docsLabel(item = {}) {
  const attachments = (item.workspaceArtifacts?.attachments ?? [])
    .filter((attachment) => isMeaningfulAttachment(attachment.filename, attachment.mimeType))
    .map((attachment) => attachment.filename)
    .filter(Boolean);
  const driveFiles = (item.workspaceArtifacts?.driveFiles ?? [])
    .map((file) => file.name)
    .filter(Boolean);
  const labels = [...attachments, ...driveFiles].slice(0, 3);

  if (labels.length) {
    return labels.join(", ");
  }

  if (item.workspaceArtifacts?.driveFileIds?.length && item.workspaceArtifacts?.driveScopeAvailable === false) {
    return "Linked Google files detected";
  }

  return "";
}

function decodeCommonHtmlEntities(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeHtml(value = "") {
  return decodeCommonHtmlEntities(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlLink(label, href) {
  if (!href) {
    return "";
  }

  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function htmlList(items = []) {
  return `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function actionLinks(item = {}, nextStep = "") {
  const links = [
    { label: "Gmail", href: gmailThreadUrl(item) },
    { label: "Messages", href: messagesThreadUrl(item) },
    { label: "Review Packet", href: item.reviewUrl },
    { label: "Decide in ChatGPT", href: chatGptUrlForItem(item, nextStep) }
  ];
  const seen = new Set();

  return links.filter((link) => {
    if (!link.href || seen.has(`${link.label}:${link.href}`)) {
      return false;
    }

    seen.add(`${link.label}:${link.href}`);
    return true;
  });
}

function formatActionCard(item = {}, { timeZone, locale } = {}) {
  const participant = firstExternalParticipant(item);
  const who = participant?.name || participant?.email || "Unknown sender";
  const company = participant?.domain || participant?.email || "Unknown";
  const nextStep = deriveNextStep(item);
  const warnings = item.analysis?.warnings ?? [];
  const docs = docsLabel(item);
  const intelligence = intelligenceSuffix(item).replace(/^\s*\|\s*Intelligence:\s*/, "");
  const actions = actionLinks(item, nextStep);
  const shelfCycleCandidate = item.briefAi?.shelfCycleCandidate;
  const keyDetails = (item.briefAi?.keyDetails ?? []).filter(Boolean).slice(0, 3);
  const notes = [
    docs ? `Docs: ${escapeHtml(docs)}` : "",
    intelligence ? `Intelligence: ${escapeHtml(truncateInsight(intelligence, 150))}` : "",
    keyDetails.length ? `Key details: ${escapeHtml(keyDetails.join(" / "))}` : "",
    item.briefAi?.ownerLens ? `Owner lens: ${escapeHtml(truncateInsight(item.briefAi.ownerLens, 150))}` : "",
    shelfCycleCandidate?.shouldConsider
      ? `ShelfCycle: ${escapeHtml(truncateInsight(`${shelfCycleCandidate.recordType || "Review"} - ${shelfCycleCandidate.summary || shelfCycleCandidate.title || ""}`, 170))}`
      : "",
    item.briefAi?.riskNote ? `Risk: ${escapeHtml(truncateInsight(item.briefAi.riskNote, 140))}` : "",
    warnings.length ? `Notes: ${escapeHtml(truncateInsight(warnings[0], 150))}` : ""
  ].filter(Boolean);
  const links = actions.map((action) => htmlLink(action.label, action.href)).filter(Boolean).join(" | ");

  return [
    `<article class="brief-card">`,
    `<p class="brief-kicker">${escapeHtml(priorityLabel(item))} — ${escapeHtml(actionType(item))}</p>`,
    `<h3>${escapeHtml(who)} — ${escapeHtml(item.subject || "No subject")}</h3>`,
    htmlList([
      `<strong>Time:</strong> ${escapeHtml(formatTime(item.lastTimestamp, locale, timeZone) || "-")}`,
      `<strong>Type:</strong> ${escapeHtml(relationshipLabel(item) || statusLabel(item) || "-")}`,
      `<strong>Company:</strong> ${escapeHtml(company)}`,
      `<strong>Action:</strong> ${escapeHtml(nextStep || "Review if needed.")}`,
      `<strong>Why:</strong> ${escapeHtml(truncateInsight(keyPoint(item), 180))}`,
      ...notes.map((note) => `<strong>${note.split(":")[0]}:</strong>${note.includes(":") ? note.slice(note.indexOf(":") + 1) : ""}`),
      links ? `<strong>Links:</strong> ${links}` : ""
    ].filter(Boolean)),
    `</article>`
  ].join("\n");
}

function groupByActionType(items = []) {
  const groups = new Map();

  for (const item of items) {
    const type = actionType(item);

    if (!groups.has(type)) {
      groups.set(type, []);
    }

    groups.get(type).push(item);
  }

  return groups;
}

function formatSnapshot({
  needsAttention = [],
  waitingOnOthers = [],
  internal = [],
  solicitations = [],
  messageMemory = null,
  sorted = []
} = {}) {
  const messageCounts = messageMemoryCounts(messageMemory ?? {});
  const reviewCount = sorted.filter((item) => item.reviewUrl).length;

  return [
    `<table class="brief-snapshot">`,
    `<tr><th>Area</th><th>Count</th></tr>`,
    `<tr><td>Needs Sean Today</td><td>${needsAttention.length}</td></tr>`,
    `<tr><td>Waiting on Others</td><td>${waitingOnOthers.length}</td></tr>`,
    `<tr><td>ShelfCycle Reviews</td><td>${reviewCount}</td></tr>`,
    `<tr><td>Business Text Threads</td><td>${messageCounts.businessThreads}</td></tr>`,
    `<tr><td>Unknown Text Contacts</td><td>${messageCounts.unknownContacts}</td></tr>`,
    `<tr><td>Hidden Noise</td><td>${solicitations.length + (messageMemory?.low_priority_summary?.length ?? 0)}</td></tr>`,
    `<tr><td>Internal / FYI</td><td>${internal.length}</td></tr>`,
    `</table>`
  ].join("\n");
}

function formatMessageMemoryBrief(messageMemory = null) {
  if (!messageMemory || !hasMessageMemoryContent(messageMemory)) {
    return ["<h2>Text Messages</h2>", "<p>None.</p>"].join("\n");
  }

  const lines = ["<h2>Text Messages</h2>"];
  const business = messageMemory.business_threads ?? [];
  const followups = messageMemory.suggested_followups ?? [];

  if (messageMemory.briefAi?.summary || messageMemory.briefAi?.action) {
    lines.push(
      `<p><strong>Summary:</strong> ${escapeHtml(messageMemory.briefAi.summary || "Review business text context.")}</p>`,
      `<p><strong>Action:</strong> ${escapeHtml(messageMemory.briefAi.action || "Review if needed.")}</p>`
    );

    if (messageMemory.briefAi.shelfCycleCandidate) {
      lines.push(`<p><strong>ShelfCycle:</strong> ${escapeHtml(messageMemory.briefAi.shelfCycleCandidate)}</p>`);
    }
  }

  if (business.length) {
    lines.push("<h3>Business Texts</h3>");
    lines.push(
      htmlList(
        business.slice(0, 3).map((item) =>
          `${escapeHtml(item.contact || "Unknown")}: ${escapeHtml(truncateInsight(item.summary || item.subject || "Review text context.", 150))}`
        )
      )
    );
  }

  if (followups.length) {
    lines.push("<h3>Suggested Text Follow-Ups</h3>");
    lines.push(htmlList(followups.slice(0, 3).map((item) => escapeHtml(truncateInsight(item.summary, 150)))));
  }

  if (messageMemory.unknown_contacts?.length) {
    lines.push(`<p>${messageMemory.unknown_contacts.length} unknown text contact(s) need local review.</p>`);
  }

  if (messageMemory.low_priority_summary?.length) {
    lines.push(`<p>${messageMemory.low_priority_summary.length} low-priority text thread(s) hidden.</p>`);
  }

  return lines.join("\n");
}

function formatSolicitationSummary(solicitations = []) {
  if (!solicitations.length) {
    return ["<h2>Hidden Low Priority</h2>", "<p>No likely solicitations found.</p>"].join("\n");
  }

  const examples = solicitations
    .slice(0, 6)
    .map((item) => firstExternalParticipant(item)?.name || firstExternalParticipant(item)?.domain || item.subject)
    .filter(Boolean);

  return [
    "<h2>Hidden Low Priority</h2>",
    `<p>${solicitations.length} likely solicitation(s) hidden.</p>`,
    examples.length ? `<p>Examples: ${escapeHtml(examples.join(", "))}</p>` : ""
  ].filter(Boolean).join("\n");
}

function formatRoleActions({ ownerActions = [], salesActions = [], procurementActions = [] } = {}) {
  return [
    "<h2>Role Actions</h2>",
    "<h3>Owner</h3>",
    htmlList(ownerActions.length ? ownerActions.slice(0, 5).map((item) => escapeHtml(item)) : ["None"]),
    "<h3>Sales</h3>",
    htmlList(salesActions.length ? salesActions.slice(0, 5).map((item) => escapeHtml(item)) : ["None"]),
    "<h3>Procurement</h3>",
    htmlList(procurementActions.length ? procurementActions.slice(0, 5).map((item) => escapeHtml(item)) : ["None"])
  ].join("\n");
}

function formatShelfCycleFollowThroughCards(items = [], { timeZone, locale } = {}) {
  const coreItems = items.filter((item) => isCoreBusinessThread(item));

  if (!coreItems.length) {
    return ["<h2>ShelfCycle Follow-Through</h2>", "<p>None.</p>"].join("\n");
  }

  const cards = coreItems.slice(0, 12).map((item) => {
    const participant = firstExternalParticipant(item);
    const title = item.analysis?.draftNote?.title || item.subject || "email thread";
    const attachmentNames = (item.workspaceArtifacts?.attachments ?? [])
      .map((attachment) => attachment.filename)
      .filter(Boolean);
    const warnings = item.analysis?.warnings ?? [];
    const shelfCycleCandidate = item.briefAi?.shelfCycleCandidate;

    return [
      `<article class="brief-card brief-card-secondary">`,
      `<h3>${escapeHtml(title)} — ${escapeHtml(participant?.name || participant?.email || "Unknown")}</h3>`,
      htmlList([
        `<strong>Received:</strong> ${escapeHtml(formatTime(item.lastTimestamp, locale, timeZone) || "-")}`,
        `<strong>Review:</strong> ${item.reviewUrl ? htmlLink("Review Packet", item.reviewUrl) : "None"}`,
        `<strong>Draft note:</strong> ${item.analysis?.draftNote?.summary ? "Yes" : "No"}`,
        `<strong>Suggested records:</strong> ${item.analysis?.suggestedCreates?.length ?? 0}`,
        shelfCycleCandidate?.shouldConsider
          ? `<strong>AI ShelfCycle candidate:</strong> ${escapeHtml(`${shelfCycleCandidate.recordType || "Review"} - ${shelfCycleCandidate.title || ""} - ${shelfCycleCandidate.summary || ""}`)}`
          : "",
        `<strong>Documents:</strong> ${escapeHtml(attachmentNames.some((name) => /\b(sds|tds|coa)\b/i.test(name)) ? attachmentNames.slice(0, 3).join(", ") : "None flagged")}`,
        warnings[0] ? `<strong>Note:</strong> ${escapeHtml(truncateInsight(warnings[0], 130))}` : "",
        `<strong>Recommended action:</strong> ${escapeHtml(deriveNextStep(item) || "Review before updating ShelfCycle.")}`
      ].filter(Boolean)),
      `</article>`
    ].join("\n");
  });

  return ["<h2>ShelfCycle Follow-Through</h2>", ...cards].join("\n\n");
}

function formatIntelligenceCoverageSection(items = []) {
  const intelligenceCoverage = gatherIntelligenceCoverage(items);
  const sections = [];

  if (!intelligenceCoverage.learningPrompts.length && !intelligenceCoverage.contradictions.length) {
    return "";
  }

  sections.push("<h2>ClearEdge Intelligence Coverage</h2>");

  if (intelligenceCoverage.learningPrompts.length) {
    sections.push("<h3>Add to Intelligence Library</h3>");
    sections.push(htmlList(intelligenceCoverage.learningPrompts.slice(0, 5).map((item) => escapeHtml(item))));
  }

  if (intelligenceCoverage.contradictions.length) {
    sections.push("<h3>Reconcile with Intelligence</h3>");
    sections.push(htmlList(intelligenceCoverage.contradictions.slice(0, 5).map((item) => escapeHtml(item))));
  }

  return sections.join("\n");
}

function buildActionDailyBrief({
  analyzedThreads = [],
  organization = "ClearEdge Solutions",
  title = "Daily ClearEdge Communications Brief",
  messageMemory = null,
  generatedAt = new Date().toISOString(),
  timeZone = "America/New_York",
  locale = "en-US"
} = {}) {
  const sorted = sortByPriorityAndTime(analyzedThreads);
  const needsAttention = sorted.filter(
    (item) =>
      item.state.state === "needs_attention" &&
      ["customer", "supplier", "employee"].includes(item.relationship.relationship)
  );
  const waitingOnOthers = sorted.filter(
    (item) =>
      item.state.state === "waiting_on_other_side" &&
      ["customer", "supplier"].includes(item.relationship.relationship)
  );
  const internal = sorted.filter(
    (item) => item.relationship.relationship === "employee" || item.state.state === "informational"
  );
  const solicitations = sorted.filter((item) => item.relationship.relationship === "solicitation");
  const queueItems = sorted.filter((item) =>
    ["needs_attention", "waiting_on_other_side"].includes(item.state?.state) &&
    !isSolicitationThread(item)
  );
  const topActions = queueItems.slice(0, 5);
  const topActionSet = new Set(topActions);
  const waitingRemainder = waitingOnOthers.filter((item) => !topActionSet.has(item));
  const grouped = groupByActionType(topActions);
  const preferredOrder = [
    "Orders / POs to Confirm",
    "Pricing / Quote Decisions",
    "Documents / Compliance",
    "Payments / Invoices",
    "Shipment / Logistics",
    "Follow-Ups"
  ];
  const ownerActions = sumRoleWorklists(sorted, "owner");
  const salesActions = sumRoleWorklists(sorted, "sales");
  const procurementActions = sumRoleWorklists(sorted, "procurement");
  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone
  }).format(new Date(generatedAt));
  const sections = [
    `<!doctype html>`,
    `<html>`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<style>
      body { margin: 0; padding: 24px; color: #17211b; background: #f7f4ec; font-family: Georgia, 'Times New Roman', serif; line-height: 1.45; }
      .brief-shell { max-width: 860px; margin: 0 auto; }
      .brief-header { border-bottom: 3px solid #264738; padding-bottom: 12px; margin-bottom: 18px; }
      h1 { margin: 0 0 6px; font-size: 28px; color: #173426; }
      h2 { margin: 26px 0 10px; font-size: 20px; color: #173426; border-bottom: 1px solid #d5cdbd; padding-bottom: 5px; }
      h3 { margin: 8px 0; font-size: 16px; color: #173426; }
      p { margin: 6px 0; }
      a { color: #0a5c4d; font-weight: 700; text-decoration: none; }
      table { width: 100%; border-collapse: collapse; background: #fffdf7; margin: 10px 0 18px; }
      th, td { border: 1px solid #ded6c7; padding: 8px 10px; text-align: left; }
      th:last-child, td:last-child { text-align: right; }
      ul { margin: 8px 0 0 20px; padding: 0; }
      li { margin: 4px 0; }
      .brief-card { background: #fffdf7; border: 1px solid #d8cdbc; border-left: 5px solid #264738; border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
      .brief-card-secondary { border-left-color: #8a6d38; }
      .brief-kicker { margin: 0 0 4px; color: #785f34; font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
      .muted { color: #70685b; }
    </style>`,
    `</head>`,
    `<body>`,
    `<main class="brief-shell">`,
    `<header class="brief-header">`,
    `<h1>${escapeHtml(title)}</h1>`,
    `<p><strong>${escapeHtml(organization)}</strong> · ${escapeHtml(dateLabel)}</p>`,
    `</header>`,
    "<h2>Snapshot</h2>",
    formatSnapshot({ needsAttention, waitingOnOthers, internal, solicitations, messageMemory, sorted }),
    "<h2>Top Actions</h2>"
  ];

  for (const groupName of preferredOrder) {
    const items = grouped.get(groupName) ?? [];

    if (!items.length) {
      continue;
    }

    sections.push(`<h3>${escapeHtml(groupName)}</h3>`);
    sections.push(...items.slice(0, 8).map((item) => formatActionCard(item, { timeZone, locale })));
  }

  if (!topActions.length) {
    sections.push("<p>No priority email actions found.</p>");
  }

  sections.push(
    formatMessageMemoryBrief(messageMemory),
    "<h2>Waiting on Others</h2>",
    ...(waitingRemainder.length ? waitingRemainder.slice(0, 6).map((item) => formatActionCard(item, { timeZone, locale })) : ["<p>Already covered in Top Actions or none.</p>"]),
    "<h2>Internal / FYI</h2>",
    internal.length
      ? `<p>${internal.length} internal or informational item(s) summarized. Review only if needed.</p>`
      : "<p>None.</p>",
    formatSolicitationSummary(solicitations),
    formatRoleActions({ ownerActions, salesActions, procurementActions }),
    formatShelfCycleFollowThroughCards(sorted, { timeZone, locale })
  );

  const intelligenceSection = formatIntelligenceCoverageSection(sorted);

  if (intelligenceSection) {
    sections.push(intelligenceSection);
  }

  sections.push(`</main>`, `</body>`, `</html>`);

  return sections.join("\n");
}

export function buildDailyBrief(options = {}) {
  if (options.briefFormat === "legacy") {
    return buildLegacyDailyBrief(options);
  }

  return buildActionDailyBrief(options);
}
