import { compactWhitespace } from "./normalize.mjs";

const HIGH_CONFIDENCE = 0.9;

function normalizeConfidence(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

function normalizeCustomerCandidate(entry = {}) {
  const candidate = entry.candidate ?? entry;
  const id = compactWhitespace(candidate.id ?? candidate.customerId ?? candidate.accountId ?? "");
  const label = compactWhitespace(candidate.name ?? candidate.label ?? candidate.companyName ?? "");

  if (!id && !label) {
    return null;
  }

  const confidence = normalizeConfidence(entry.confidence ?? entry.score ?? candidate.confidence ?? candidate.score, id ? 0.75 : 0.45);
  const matchReasons = [];

  if (id) {
    matchReasons.push("known ShelfCycle customer id available");
  }

  if (label) {
    matchReasons.push("customer name matched review packet");
  }

  return {
    kind: "customer",
    id,
    label: label || id,
    confidence,
    matchReasons
  };
}

function normalizeSupplierCandidate(entry = {}) {
  const candidate = entry.candidate ?? entry;
  const id = compactWhitespace(candidate.id ?? candidate.supplierId ?? candidate.accountId ?? "");
  const label = compactWhitespace(candidate.name ?? candidate.label ?? candidate.companyName ?? candidate.supplierName ?? "");

  if (!id && !label) {
    return null;
  }

  const confidence = normalizeConfidence(entry.confidence ?? entry.score ?? candidate.confidence ?? candidate.score, id ? 0.75 : 0.45);
  const matchReasons = [];

  if (id) {
    matchReasons.push("known ShelfCycle supplier id available");
  }

  if (label) {
    matchReasons.push("supplier name matched review packet");
  }

  return {
    kind: "supplier",
    id,
    label: label || id,
    confidence,
    matchReasons
  };
}

function contactCompanyKind(contact = {}) {
  const raw = compactWhitespace(contact.companyType ?? contact.relationshipType ?? contact.type ?? "").toLowerCase();

  if (raw.includes("supplier")) {
    return "supplier";
  }

  if (raw.includes("customer") || raw.includes("prospect")) {
    return "customer";
  }

  return "";
}

function normalizeCompanyCandidateFromContact(entry = {}, kind = "") {
  const candidate = entry.candidate ?? entry;
  const contactKind = contactCompanyKind(candidate);

  if (contactKind !== kind) {
    return null;
  }

  const id = compactWhitespace(
    kind === "supplier"
      ? candidate.supplierId ?? candidate.companyId ?? candidate.accountId ?? ""
      : candidate.customerId ?? candidate.companyId ?? candidate.accountId ?? ""
  );
  const label = compactWhitespace(candidate.companyName ?? candidate.company ?? candidate.accountName ?? "");

  if (!id && !label) {
    return null;
  }

  const confidence = normalizeConfidence(entry.confidence ?? entry.score ?? candidate.confidence ?? candidate.score, id ? 0.8 : 0.76);

  return {
    kind,
    id,
    label: label || id,
    confidence,
    matchReasons: [
      `existing ShelfCycle ${kind} contact matched this company`,
      candidate.email ? `matched contact email ${candidate.email}` : ""
    ].filter(Boolean)
  };
}

function dedupeCandidates(candidates = []) {
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

export function resolveCustomerTargets(reviewAction = {}, { selectedTarget = null } = {}) {
  const targetCandidates = dedupeCandidates(
    [
      ...(reviewAction.matches?.customer ?? []).map((entry) => normalizeCustomerCandidate(entry)),
      ...(reviewAction.matches?.contacts ?? []).map((entry) => normalizeCompanyCandidateFromContact(entry, "customer"))
    ].filter(Boolean)
  );

  if (selectedTarget?.kind === "customer") {
    const id = compactWhitespace(selectedTarget.id);
    const label = compactWhitespace(selectedTarget.label);

    if (id || label) {
      return {
        selectedTarget: {
          kind: "customer",
          id,
          label: label || id,
          confidence: normalizeConfidence(selectedTarget.confidence, 1),
          matchReasons: selectedTarget.matchReasons ?? [id ? "user selected target" : "user selected searchable customer label"]
        },
        targetCandidates
      };
    }
  }

  if (targetCandidates.length === 1 && targetCandidates[0].id && targetCandidates[0].confidence >= HIGH_CONFIDENCE) {
    return {
      selectedTarget: targetCandidates[0],
      targetCandidates
    };
  }

  return {
    selectedTarget: null,
    targetCandidates
  };
}

export function resolveSupplierTargets(reviewAction = {}, { selectedTarget = null } = {}) {
  const targetCandidates = dedupeCandidates(
    [
      ...((reviewAction.matches?.supplier ?? reviewAction.matches?.suppliers ?? []).map((entry) => normalizeSupplierCandidate(entry))),
      ...(reviewAction.matches?.contacts ?? []).map((entry) => normalizeCompanyCandidateFromContact(entry, "supplier"))
    ].filter(Boolean)
  );

  if (selectedTarget?.kind === "supplier") {
    const id = compactWhitespace(selectedTarget.id);
    const label = compactWhitespace(selectedTarget.label);

    if (id || label) {
      return {
        selectedTarget: {
          kind: "supplier",
          id,
          label: label || id,
          confidence: normalizeConfidence(selectedTarget.confidence, 1),
          matchReasons: selectedTarget.matchReasons ?? [id ? "user selected target" : "user selected searchable supplier label"]
        },
        targetCandidates
      };
    }
  }

  if (targetCandidates.length === 1 && targetCandidates[0].id && targetCandidates[0].confidence >= HIGH_CONFIDENCE) {
    return {
      selectedTarget: targetCandidates[0],
      targetCandidates
    };
  }

  return {
    selectedTarget: null,
    targetCandidates
  };
}
