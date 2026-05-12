import { compactWhitespace } from "./normalize.mjs";
import { buildShelfCycleReadyNote, normalizeShelfCycleNoteText } from "./shelfcycle-ready-note.mjs";

function topCustomerMatch(action = {}) {
  return action.matches?.customer?.[0]?.candidate ?? null;
}

function normalizeNoteDate(value = "") {
  const text = compactWhitespace(value);

  if (!text) {
    return new Date().toISOString().slice(0, 10);
  }

  const isoMatch = text.match(/\b\d{4}-\d{2}-\d{2}\b/);

  if (isoMatch) {
    return isoMatch[0];
  }

  const parsed = new Date(text);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\\d+);/g, (_match, code) => {
      const point = Number.parseInt(code, 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : _match;
    });
}

function cleanNoteText(value = "") {
  return normalizeShelfCycleNoteText(decodeHtmlEntities(value));
}

export function buildNoteFields(action = {}) {
  const draftNote = action.draftNote ?? {};
  const writePlan = action.writePlan ?? {};
  const fields = writePlan.fields ?? {};
  const readyNote = action.shelfCycleReadyNote?.source === "user_approved"
    ? action.shelfCycleReadyNote
    : buildShelfCycleReadyNote(action);
  const summary = cleanNoteText(readyNote.summary ?? draftNote.summary ?? fields.summary ?? action.summary ?? "");

  return {
    date: normalizeNoteDate(fields.date),
    type: cleanNoteText(draftNote.type ?? fields.type ?? "Call"),
    title: cleanNoteText(readyNote.title ?? draftNote.title ?? fields.title ?? action.subject ?? "ClearEdge note"),
    summary
  };
}

export function getNoteSubmissionTarget(action = {}, { selectedTarget = null } = {}) {
  const customer = selectedTarget?.kind === "customer"
    ? { id: selectedTarget.id, name: selectedTarget.label }
    : topCustomerMatch(action);

  if (!customer?.id && !customer?.name) {
    throw new Error("Cannot submit note: no ShelfCycle customer target is available in the review action.");
  }

  const fields = buildNoteFields(action);

  if (!fields.summary) {
    throw new Error("Cannot submit note: draft note summary is empty.");
  }

  return {
    recordType: "note",
    customerId: compactWhitespace(customer.id),
    customerName: compactWhitespace(customer.name),
    url: customer.id
      ? `https://app.shelfcycle.com/org-clearedge/customers/${customer.id}/notes`
      : "https://app.shelfcycle.com/org-clearedge/contacts",
    fields
  };
}

export function collectExecutableActions(action = {}) {
  const executable = [];

  try {
    const note = getNoteSubmissionTarget(action);

    if (note.customerId) {
      executable.push({
        key: "create_note",
        label: "Create Note in ShelfCycle",
        description: `Create a new note under ${note.customerName || "the matched customer"} after approval.`,
        recordType: "note"
      });
    }
  } catch {
    // Keep review packets usable even when a direct submit path is not available yet.
  }

  return executable;
}
