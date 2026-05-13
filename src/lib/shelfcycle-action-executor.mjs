import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { SHELFCYCLE_ACTION_TYPES, SHELFCYCLE_ERROR_CODES } from "./shelfcycle-action-router.mjs";
import { normalizeContactDocumentTypes } from "./shelfcycle-contact-document-types.mjs";
import { getNoteSubmissionTarget } from "./shelfcycle-submit.mjs";

const execFileAsync = promisify(execFile);

function assertExecutableAction(proposedAction = {}) {
  if (!proposedAction.executable) {
    const error = new Error(proposedAction.warnings?.[0] || "ShelfCycle action is not executable.");
    error.code = SHELFCYCLE_ERROR_CODES.NOT_EXECUTABLE;
    error.warnings = proposedAction.warnings ?? [];
    throw error;
  }
}

export function buildCustomerNoteSubmission(reviewAction = {}, proposedAction = {}) {
  if (proposedAction.actionType !== SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE) {
    const error = new Error("Only customer note actions can be converted into customer note submissions.");
    error.code = SHELFCYCLE_ERROR_CODES.UNSUPPORTED_ACTION_TYPE;
    throw error;
  }

  assertExecutableAction(proposedAction);

  const submission = getNoteSubmissionTarget(reviewAction, {
    selectedTarget: proposedAction.selectedTarget
  });

  return {
    ...submission,
    actionType: proposedAction.actionType,
    actionId: proposedAction.id,
    reviewActionId: proposedAction.reviewActionId,
    fields: {
      ...submission.fields,
      ...(proposedAction.fieldValues?.date ? { date: proposedAction.fieldValues.date } : {}),
      ...(proposedAction.fieldValues?.type ? { type: proposedAction.fieldValues.type } : {}),
      ...(proposedAction.fieldValues?.title ? { title: proposedAction.fieldValues.title } : {}),
      ...(proposedAction.fieldValues?.note ? { summary: proposedAction.fieldValues.note } : {}),
      ...(Array.isArray(proposedAction.fieldValues?.mentions) ? { mentions: proposedAction.fieldValues.mentions } : {})
    }
  };
}

function noteSubmissionUrl(target = {}) {
  if (target.kind === "supplier") {
    return `https://app.shelfcycle.com/org-clearedge/suppliers/${target.id}/notes`;
  }

  return `https://app.shelfcycle.com/org-clearedge/customers/${target.id}/notes`;
}

export function buildGenericNoteSubmission(reviewAction = {}, proposedAction = {}) {
  assertExecutableAction(proposedAction);

  const target = proposedAction.selectedTarget ?? {};
  const fields = proposedAction.fieldValues ?? {};

  if (!target.id) {
    const error = new Error("A ShelfCycle customer or supplier target is required.");
    error.code = SHELFCYCLE_ERROR_CODES.MISSING_TARGET;
    throw error;
  }

  return {
    recordType: "note",
    actionType: proposedAction.actionType,
    actionId: proposedAction.id,
    reviewActionId: proposedAction.reviewActionId,
    customerId: target.kind === "customer" ? target.id : "",
    customerName: target.kind === "customer" ? target.label : "",
    supplierId: target.kind === "supplier" ? target.id : "",
    supplierName: target.kind === "supplier" ? target.label : "",
    url: noteSubmissionUrl(target),
    fields: {
      date: fields.date || new Date().toISOString().slice(0, 10),
      type: fields.type || "Email",
      title: fields.title || reviewAction.subject || "ClearEdge note",
      summary: fields.note || reviewAction.summary || "",
      mentions: Array.isArray(fields.mentions) ? fields.mentions : []
    }
  };
}

export function buildContactSubmission(_reviewAction = {}, proposedAction = {}) {
  assertExecutableAction(proposedAction);

  const target = proposedAction.selectedTarget ?? {};

  if (!target.id && !target.label) {
    const error = new Error("A ShelfCycle customer or supplier target is required.");
    error.code = SHELFCYCLE_ERROR_CODES.MISSING_TARGET;
    throw error;
  }
  const targetKind = target.kind === "supplier" ? "supplier" : "customer";
  const rawFields = proposedAction.fieldValues ?? {};
  const fields = {
    ...rawFields,
    phone: targetKind === "supplier"
      ? (rawFields.phone || rawFields.officePhone || rawFields.mobilePhone || "")
      : (rawFields.phone || rawFields.officePhone || ""),
    officePhone: targetKind === "supplier"
      ? (rawFields.officePhone || rawFields.phone || rawFields.mobilePhone || "")
      : (rawFields.officePhone || rawFields.phone || ""),
    documentTypes: normalizeContactDocumentTypes(targetKind, rawFields.documentTypes)
  };

  return {
    recordType: "contact",
    actionType: proposedAction.actionType,
    actionId: proposedAction.id,
    reviewActionId: proposedAction.reviewActionId,
    customerId: targetKind === "customer" ? target.id : "",
    customerName: targetKind === "customer" ? target.label : "",
    supplierId: targetKind === "supplier" ? target.id : "",
    supplierName: targetKind === "supplier" ? target.label : "",
    url: target.id
      ? `https://app.shelfcycle.com/org-clearedge/${targetKind === "supplier" ? "suppliers" : "customers"}/${target.id}/contacts`
      : "https://app.shelfcycle.com/org-clearedge/contacts",
    fields
  };
}

export function buildCustomerSubmission(_reviewAction = {}, proposedAction = {}) {
  assertExecutableAction(proposedAction);

  const fields = proposedAction.fieldValues ?? {};

  if (!fields.name) {
    const error = new Error("A customer name is required.");
    error.code = SHELFCYCLE_ERROR_CODES.MISSING_REQUIRED_FIELDS;
    throw error;
  }

  return {
    recordType: "customer",
    actionType: proposedAction.actionType,
    actionId: proposedAction.id,
    reviewActionId: proposedAction.reviewActionId,
    url: "https://app.shelfcycle.com/org-clearedge/customers",
    fields
  };
}

export function buildSupplierSubmission(_reviewAction = {}, proposedAction = {}) {
  assertExecutableAction(proposedAction);

  const fields = proposedAction.fieldValues ?? {};

  if (!fields.name) {
    const error = new Error("A supplier name is required.");
    error.code = SHELFCYCLE_ERROR_CODES.MISSING_REQUIRED_FIELDS;
    throw error;
  }

  return {
    recordType: "supplier",
    actionType: proposedAction.actionType,
    actionId: proposedAction.id,
    reviewActionId: proposedAction.reviewActionId,
    url: "https://app.shelfcycle.com/org-clearedge/suppliers",
    fields
  };
}

export function buildSupplierUpdateSubmission(_reviewAction = {}, proposedAction = {}) {
  assertExecutableAction(proposedAction);

  const target = proposedAction.selectedTarget ?? {};

  if (!target.id && !target.label) {
    const error = new Error("A ShelfCycle supplier target is required.");
    error.code = SHELFCYCLE_ERROR_CODES.MISSING_TARGET;
    throw error;
  }

  return {
    recordType: "supplier",
    actionType: proposedAction.actionType,
    actionId: proposedAction.id,
    reviewActionId: proposedAction.reviewActionId,
    supplierId: target.id || "",
    supplierName: target.label || "",
    url: target.id
      ? `https://app.shelfcycle.com/org-clearedge/suppliers/${target.id}`
      : "https://app.shelfcycle.com/org-clearedge/suppliers",
    fields: proposedAction.fieldValues ?? {}
  };
}

export function buildContactUpdateSubmission(_reviewAction = {}, proposedAction = {}) {
  assertExecutableAction(proposedAction);

  const target = proposedAction.selectedTarget ?? {};
  const fields = proposedAction.fieldValues ?? {};
  const companyTarget = fields.companyTarget ?? {};

  if (!target.id && !target.label) {
    const error = new Error("A ShelfCycle contact target is required.");
    error.code = SHELFCYCLE_ERROR_CODES.MISSING_TARGET;
    throw error;
  }

  return {
    recordType: "contact",
    actionType: proposedAction.actionType,
    actionId: proposedAction.id,
    reviewActionId: proposedAction.reviewActionId,
    contactId: target.id || "",
    contactName: target.label || "",
    customerId: companyTarget.kind === "customer" ? (companyTarget.id || "") : "",
    customerName: companyTarget.kind === "customer" ? (companyTarget.label || "") : "",
    supplierId: companyTarget.kind === "supplier" ? (companyTarget.id || "") : "",
    supplierName: companyTarget.kind === "supplier" ? (companyTarget.label || "") : "",
    url: target.id
      ? `https://app.shelfcycle.com/org-clearedge/contacts/${target.id}`
      : "https://app.shelfcycle.com/org-clearedge/contacts",
    fields
  };
}

export function buildPricingSubmission(_reviewAction = {}, proposedAction = {}) {
  assertExecutableAction(proposedAction);

  return {
    recordType: "pricing_record",
    actionType: proposedAction.actionType,
    actionId: proposedAction.id,
    reviewActionId: proposedAction.reviewActionId,
    url: "https://app.shelfcycle.com/org-clearedge/price-book?viewBy=CUSTOMER",
    fields: proposedAction.fieldValues
  };
}

export function buildProductSubmission(_reviewAction = {}, proposedAction = {}) {
  assertExecutableAction(proposedAction);
  const product = proposedAction.selectedTarget ?? {};
  const fields = proposedAction.fieldValues ?? {};

  return {
    recordType: "product_code",
    actionType: proposedAction.actionType,
    actionId: proposedAction.id,
    reviewActionId: proposedAction.reviewActionId,
    productId: product.id || "",
    productName: product.label || fields.code || fields.productName || "",
    url: product.id
      ? `https://app.shelfcycle.com/org-clearedge/products/${product.id}`
      : "https://app.shelfcycle.com/org-clearedge/products",
    fields
  };
}

export function buildProductDocumentSubmission(_reviewAction = {}, proposedAction = {}) {
  assertExecutableAction(proposedAction);
  const product = proposedAction.selectedTarget ?? {};

  return {
    recordType: "product_document",
    actionType: proposedAction.actionType,
    actionId: proposedAction.id,
    reviewActionId: proposedAction.reviewActionId,
    productId: product.id,
    productName: product.label,
    url: `https://app.shelfcycle.com/org-clearedge/products/${product.id}`,
    fields: proposedAction.fieldValues
  };
}

export function buildShelfCycleSubmission(reviewAction = {}, proposedAction = {}) {
  if (proposedAction.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE) {
    return buildCustomerNoteSubmission(reviewAction, proposedAction);
  }

  if (proposedAction.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_NOTE || proposedAction.actionType === SHELFCYCLE_ACTION_TYPES.ORDER_OR_LOGISTICS_NOTE) {
    return buildGenericNoteSubmission(reviewAction, proposedAction);
  }

  if (proposedAction.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE) {
    return buildContactSubmission(reviewAction, proposedAction);
  }

  if (proposedAction.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE) {
    return buildCustomerSubmission(reviewAction, proposedAction);
  }

  if (proposedAction.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE) {
    return buildSupplierSubmission(reviewAction, proposedAction);
  }

  if (proposedAction.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_UPDATE) {
    return buildSupplierUpdateSubmission(reviewAction, proposedAction);
  }

  if (proposedAction.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_UPDATE) {
    return buildContactUpdateSubmission(reviewAction, proposedAction);
  }

  if (proposedAction.actionType === SHELFCYCLE_ACTION_TYPES.PRICING_RECORD) {
    return buildPricingSubmission(reviewAction, proposedAction);
  }

  if (proposedAction.actionType === SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE) {
    return buildProductSubmission(reviewAction, proposedAction);
  }

  if (proposedAction.actionType === SHELFCYCLE_ACTION_TYPES.PRODUCT_DOCUMENT_FOLLOWUP) {
    return buildProductDocumentSubmission(reviewAction, proposedAction);
  }

  const error = new Error(`Unsupported ShelfCycle action type: ${proposedAction.actionType || "unknown"}.`);
  error.code = SHELFCYCLE_ERROR_CODES.UNSUPPORTED_ACTION_TYPE;
  throw error;
}

export async function executeApprovedShelfCycleAction({
  reviewAction = {},
  proposedAction = {},
  automationRunnerPath,
  cwd = process.cwd()
} = {}) {
  const submission = buildShelfCycleSubmission(reviewAction, proposedAction);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shelfcycle-agent-"));
  const payloadPath = path.join(tempDir, "action-payload.json");

  try {
    await writeFile(payloadPath, JSON.stringify(submission, null, 2), "utf8");
    const { stdout } = await execFileAsync(process.execPath, [automationRunnerPath, "execute-action", "--payload", payloadPath], {
      cwd,
      maxBuffer: 1024 * 1024
    });
    const automation = JSON.parse(stdout.trim() || "{}");

    const messages = {
      [SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE]: "Customer submitted to ShelfCycle.",
      [SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE]: "Supplier submitted to ShelfCycle.",
      [SHELFCYCLE_ACTION_TYPES.SUPPLIER_UPDATE]: "Supplier updated in ShelfCycle.",
      [SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE]: "Contact submitted to ShelfCycle.",
      [SHELFCYCLE_ACTION_TYPES.CONTACT_UPDATE]: "Contact updated in ShelfCycle.",
      [SHELFCYCLE_ACTION_TYPES.PRICING_RECORD]: "Pricing record submitted to ShelfCycle.",
      [SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE]: "Product submitted to ShelfCycle.",
      [SHELFCYCLE_ACTION_TYPES.PRODUCT_DOCUMENT_FOLLOWUP]: "Product document submitted to ShelfCycle."
    };

    return {
      status: "submitted",
      shelfcycleUrl: automation.savedAtUrl || submission.url || "",
      message: messages[proposedAction.actionType] || "ShelfCycle action submitted.",
      actionType: proposedAction.actionType,
      actionId: proposedAction.id,
      target: proposedAction.selectedTarget,
      mentionResults: automation.mentionResults ?? [],
      warnings: automation.warnings ?? [],
      automation
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
