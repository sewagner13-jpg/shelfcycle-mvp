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

  if (item.reviewUrl) {
    return "Open the manual review packet before updating ShelfCycle.";
  }

  return item.analysis?.roleWorklists?.sales?.[0] || item.analysis?.roleWorklists?.procurement?.[0] || "";
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

  return `- ${who}${domain} | ${item.subject || "No subject"} | ${time} | ${item.relationship.relationship}${silo} | ${keyPoint || "No concise summary available"}${docs}${intelligence}${nextStep ? ` | Next: ${nextStep}` : ""}${gmail}${messages}${review}`;
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

  return `- ${parts.join(" | ")}`;
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

export function buildDailyBrief({
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
