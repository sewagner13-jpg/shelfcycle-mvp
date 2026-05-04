import { compactWhitespace } from "./normalize.mjs";

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

export function getNoteSubmissionTarget(action = {}) {
  const customer = topCustomerMatch(action);

  if (!customer?.id) {
    throw new Error("Cannot submit note: no single matched ShelfCycle customer id is available in the review action.");
  }

  const draftNote = action.draftNote ?? {};
  const writePlan = action.writePlan ?? {};
  const fields = writePlan.fields ?? {};
  const summary = compactWhitespace(draftNote.summary ?? fields.summary ?? action.summary ?? "");

  if (!summary) {
    throw new Error("Cannot submit note: draft note summary is empty.");
  }

  return {
    recordType: "note",
    customerId: customer.id,
    customerName: compactWhitespace(customer.name),
    url: `https://app.shelfcycle.com/org-clearedge/customers/${customer.id}/notes`,
    fields: {
      date: normalizeNoteDate(fields.date),
      type: compactWhitespace(draftNote.type ?? fields.type ?? "Call"),
      title: compactWhitespace(draftNote.title ?? fields.title ?? action.subject ?? "ClearEdge note"),
      summary
    }
  };
}

export function collectExecutableActions(action = {}) {
  const executable = [];

  try {
    const note = getNoteSubmissionTarget(action);

    executable.push({
      key: "create_note",
      label: "Create Note in ShelfCycle",
      description: `Create a new note under ${note.customerName || "the matched customer"} after approval.`,
      recordType: "note"
    });
  } catch {
    // Keep review packets usable even when a direct submit path is not available yet.
  }

  return executable;
}
