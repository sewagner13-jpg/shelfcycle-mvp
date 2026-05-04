import { randomUUID } from "node:crypto";

import { saveReviewAction } from "./knowledge-store.mjs";

function isCoreBusinessThread(item = {}) {
  return (
    (item.relationship?.relationship === "customer" || item.relationship?.relationship === "supplier") &&
    item.relationship?.subtype !== "ops_vendor"
  );
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

function collectAvailableActions(item = {}) {
  const actions = [];
  const attachments = (item.workspaceArtifacts?.attachments ?? []).filter((attachment) =>
    isMeaningfulAttachment(attachment.filename, attachment.mimeType)
  );
  const salesText = (item.analysis?.roleWorklists?.sales ?? []).join("\n");
  const procurementText = (item.analysis?.roleWorklists?.procurement ?? []).join("\n");
  const siloName = item.silo?.name || "";

  if (item.analysis?.draftNote?.summary) {
    actions.push({
      key: "note",
      label: "Review ShelfCycle Note Draft",
      description: "Open the note draft and write plan for manual approval before anything is entered."
    });
  }

  if (item.analysis?.suggestedCreates?.length) {
    actions.push({
      key: "contacts",
      label: "Review Contact Drafts",
      description: "Inspect suggested contact creates and decide whether any should be added manually."
    });
  }

  if (
    siloName === "compliance" ||
    attachments.length ||
    /\bsds\b|\btds\b|\bcoa\b|\bdocument\b/i.test(`${salesText}\n${procurementText}`)
  ) {
    actions.push({
      key: "documents",
      label: "Review Document Follow-Through",
      description: "Check document-related attachments and decide whether to attach or chase files manually."
    });
  }

  if (siloName === "commercial" || /\bpricing\b|\bquote\b/i.test(`${salesText}\n${procurementText}`)) {
    actions.push({
      key: "pricing",
      label: "Review Pricing Follow-Up",
      description: "Open the pricing/procurement tasks tied to this thread before quoting or responding."
    });
  }

  if (siloName === "logistics") {
    actions.push({
      key: "logistics",
      label: "Review Shipment or Carrier Follow-Up",
      description: "Inspect the shipment, container, carrier, or appointment details before any manual update."
    });
  }

  if (siloName === "relationship") {
    actions.push({
      key: "relationship",
      label: "Review Relationship Follow-Up",
      description: "Decide whether the thread should become a note, meeting follow-up, or executive touchpoint."
    });
  }

  if (/\bsample\b|\btrial\b|\btest\b/i.test(`${salesText}\n${procurementText}`)) {
    actions.push({
      key: "samples",
      label: "Review Sample or Trial Follow-Up",
      description: "Open sample and trial tasks for manual review."
    });
  }

  return actions;
}

function createActionRecord(item = {}) {
  return {
    id: randomUUID(),
    viewToken: randomUUID(),
    createdAt: new Date().toISOString(),
    threadId: item.threadId,
    subject: item.subject || "",
    relationship: item.relationship ?? {},
    silo: item.silo ?? {},
    state: item.state ?? {},
    externalParticipants: item.externalParticipants ?? [],
    summary: item.summary || "",
    availableActions: collectAvailableActions(item),
    draftNote: item.analysis?.draftNote ?? null,
    writePlan: item.analysis?.writePlan || item.analysis?.write_plan || item.writePlan || null,
    suggestedCreates: item.analysis?.suggestedCreates ?? [],
    followUpDraft: item.analysis?.followUpDraft ?? null,
    warnings: item.analysis?.warnings ?? [],
    roleWorklists: item.analysis?.roleWorklists ?? {},
    workspaceArtifacts: item.workspaceArtifacts ?? {
      attachments: [],
      driveFileIds: [],
      driveFiles: [],
      driveScopeAvailable: true,
      driveError: ""
    }
  };
}

function toReviewUrl(siteUrl = "", action = {}) {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}/review-action.html?id=${encodeURIComponent(action.id)}&token=${encodeURIComponent(action.viewToken)}`;
}

export async function attachReviewActions(analyzedThreads = [], { siteUrl } = {}) {
  const enhanced = [];

  for (const item of analyzedThreads) {
    if (!isCoreBusinessThread(item)) {
      enhanced.push(item);
      continue;
    }

    const actionRecord = createActionRecord(item);
    await saveReviewAction(actionRecord);

    enhanced.push({
      ...item,
      reviewUrl: toReviewUrl(siteUrl, actionRecord)
    });
  }

  return enhanced;
}
