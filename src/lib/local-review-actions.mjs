import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { collectExecutableActions } from "./shelfcycle-submit.mjs";

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

  return (
    /\b(sds|tds|coa|quote|pricing|po|purchase order|invoice|statement|spec|specification)\b/i.test(name) ||
    /(pdf|doc|docx|xls|xlsx|csv|txt)$/i.test(name) ||
    type.startsWith("application/pdf") ||
    type.includes("spreadsheet") ||
    type.includes("wordprocessing")
  );
}

function collectAvailableActions(item = {}) {
  const actions = [];
  const attachments = (item.workspaceArtifacts?.attachments ?? []).filter((attachment) =>
    isMeaningfulAttachment(attachment.filename, attachment.mimeType)
  );
  const salesText = (item.analysis?.roleWorklists?.sales ?? []).join("\n");
  const procurementText = (item.analysis?.roleWorklists?.procurement ?? []).join("\n");
  const siloName = item.silo?.name || "";
  const combinedText = `${salesText}\n${procurementText}`;

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

  if (siloName === "compliance" || attachments.length || /\bsds\b|\btds\b|\bcoa\b|\bdocument\b/i.test(combinedText)) {
    actions.push({
      key: "documents",
      label: "Review Document Follow-Through",
      description: "Check document-related attachments and decide whether to attach or chase files manually."
    });
  }

  if (siloName === "commercial" || /\bpricing\b|\bquote\b/i.test(combinedText)) {
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

  if (/\bsample\b|\btrial\b|\btest\b/i.test(combinedText)) {
    actions.push({
      key: "samples",
      label: "Review Sample or Trial Follow-Up",
      description: "Open sample and trial tasks for manual review."
    });
  }

  return actions;
}

function firstExternalParticipant(item = {}) {
  return item.externalParticipants?.[0] ?? null;
}

function suggestedNextStep(item = {}) {
  return (
    item.analysis?.roleWorklists?.sales?.[0] ||
    item.analysis?.roleWorklists?.procurement?.[0] ||
    item.analysis?.roleWorklists?.owner?.[0] ||
    ""
  );
}

function chatGptUrlForAction(item = {}) {
  const nextStep = suggestedNextStep(item);

  if (!nextStep) {
    return "";
  }

  const participant = firstExternalParticipant(item);
  const prompt = [
    "Help me decide the best real next step for this ClearEdge Solutions thread before I update ShelfCycle.",
    `Subject: ${item.subject || "No subject"}`,
    `Contact: ${participant?.name || participant?.email || "Unknown"}`,
    `Relationship: ${item.relationship?.relationship || "unknown"}`,
    `Silo: ${item.silo?.name || "unknown"}`,
    `Suggested next step: ${nextStep}`,
    "Keep the recommendation practical, approval-first, and include what platform action I should take next."
  ].join("\n");

  return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
}

export function createReviewActionRecord(item = {}) {
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
    summary: item.summary || item.analysis?.draftNote?.summary || "",
    availableActions: collectAvailableActions(item),
    executableActions: collectExecutableActions(item),
    chatGptUrl: chatGptUrlForAction(item),
    draftNote: item.analysis?.draftNote ?? null,
    writePlan: item.analysis?.writePlan || item.analysis?.write_plan || item.writePlan || null,
    matches: item.analysis?.matches ?? {},
    intelligenceContext: item.analysis?.intelligenceContext ?? item.analysis?.notebookContext ?? null,
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

function actionPath(storageDir, actionId = "") {
  return path.join(storageDir, `${actionId}.json`);
}

export async function saveLocalReviewAction(storageDir, action = {}) {
  await mkdir(storageDir, { recursive: true });
  await writeFile(actionPath(storageDir, action.id), JSON.stringify(action, null, 2), "utf8");
}

export async function loadLocalReviewAction(storageDir, actionId = "") {
  try {
    return JSON.parse(await readFile(actionPath(storageDir, actionId), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function attachLocalReviewActions(analyzedThreads = [], { storageDir, baseUrl = "http://localhost:4318" } = {}) {
  const enhanced = [];
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");

  for (const item of analyzedThreads) {
    if (!isCoreBusinessThread(item)) {
      enhanced.push(item);
      continue;
    }

    const actionRecord = createReviewActionRecord(item);
    await saveLocalReviewAction(storageDir, actionRecord);

    enhanced.push({
      ...item,
      reviewUrl: `${cleanBaseUrl}/review-action.html?id=${encodeURIComponent(actionRecord.id)}&token=${encodeURIComponent(actionRecord.viewToken)}`
    });
  }

  return enhanced;
}

export function sanitizeReviewAction(action = {}) {
  const { viewToken, ...safe } = action;
  return safe;
}
