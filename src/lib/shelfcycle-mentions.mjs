import { compactWhitespace } from "./normalize.mjs";

const VALID_KINDS = new Set(["customer", "contact", "product"]);

function normalizeKey(value = "") {
  return compactWhitespace(value).toLowerCase();
}

function uniq(values = []) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const text = compactWhitespace(value);

    if (!text) {
      continue;
    }

    const key = normalizeKey(text);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(text);
  }

  return result;
}

function mentionKey(mention = {}) {
  if (mention.id) {
    return `${mention.kind}:id:${normalizeKey(mention.id)}`;
  }

  return `${mention.kind}:label:${normalizeKey(mention.label)}`;
}

function companyAliases(label = "") {
  const text = compactWhitespace(label);
  const stripped = compactWhitespace(text
    .replace(/\b(incorporated|inc|llc|ltd|corp|corporation|co|company)\.?$/i, "")
    .replace(/[\s,.-]+$/g, ""));

  return stripped && stripped !== text ? [stripped] : [];
}

function normalizeMention({ kind = "", id = "", label = "", aliases = [], source = "" } = {}) {
  const cleanKind = compactWhitespace(kind).toLowerCase();
  const cleanLabel = compactWhitespace(label);

  if (!VALID_KINDS.has(cleanKind) || !cleanLabel) {
    return null;
  }

  return {
    kind: cleanKind,
    id: compactWhitespace(id),
    label: cleanLabel,
    aliases: uniq([cleanLabel, ...companyAliases(cleanLabel), ...aliases]),
    source: compactWhitespace(source)
  };
}

function candidateFromMatch(entry = {}) {
  return entry.candidate ?? entry;
}

function collectContactMentions(reviewAction = {}) {
  return (reviewAction.matches?.contacts ?? [])
    .map((entry) => {
      const candidate = candidateFromMatch(entry);
      return normalizeMention({
        kind: "contact",
        id: candidate.id ?? candidate.contactId ?? "",
        label: candidate.name ?? candidate.label ?? candidate.email ?? "",
        aliases: [
          candidate.name,
          candidate.email,
          candidate.title,
          candidate.role
        ],
        source: "matches.contacts"
      });
    })
    .filter(Boolean);
}

function collectProductMentions(reviewAction = {}) {
  return [
    ...(reviewAction.matches?.products ?? []),
    ...(reviewAction.matches?.product ?? [])
  ]
    .map((entry) => {
      const candidate = candidateFromMatch(entry);
      return normalizeMention({
        kind: "product",
        id: candidate.id ?? candidate.productId ?? "",
        label: candidate.code ?? candidate.name ?? candidate.label ?? "",
        aliases: [
          candidate.code,
          candidate.name,
          ...(candidate.synonyms ?? [])
        ],
        source: "matches.products"
      });
    })
    .filter(Boolean);
}

export function collectNoteMentionCandidates(reviewAction = {}, { selectedTarget = null } = {}) {
  const mentions = [];

  if (selectedTarget?.kind === "customer" && selectedTarget.label) {
    mentions.push(normalizeMention({
      kind: "customer",
      id: selectedTarget.id,
      label: selectedTarget.label,
      aliases: [selectedTarget.label],
      source: "selectedTarget"
    }));
  }

  mentions.push(...collectContactMentions(reviewAction));
  mentions.push(...collectProductMentions(reviewAction));

  const byKey = new Map();

  for (const mention of mentions.filter(Boolean)) {
    const key = mentionKey(mention);
    const existing = byKey.get(key);

    if (!existing || mention.aliases.length > existing.aliases.length) {
      byKey.set(key, mention);
    }
  }

  return [...byKey.values()];
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMentionOccurrence(text = "", mention = {}, usedRanges = []) {
  const aliases = [...(mention.aliases ?? [])]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  for (const alias of aliases) {
    const pattern = new RegExp(escapeRegExp(alias), "gi");
    let match = pattern.exec(text);

    while (match) {
      const start = match.index;
      const end = start + match[0].length;
      const overlaps = usedRanges.some((range) => start < range.end && end > range.start);

      if (!overlaps) {
        return {
          start,
          end,
          text: match[0],
          mention
        };
      }

      match = pattern.exec(text);
    }
  }

  return null;
}

function plainTextFromSegments(segments = []) {
  return segments.map((segment) => segment.type === "mention" ? `@${segment.mention.label}` : segment.text).join("");
}

export function buildMentionInsertionPlan(text = "", mentions = []) {
  const noteText = String(text || "");
  const usedRanges = [];
  const occurrences = [];
  const missing = [];

  for (const mention of mentions) {
    const occurrence = findMentionOccurrence(noteText, mention, usedRanges);

    if (occurrence) {
      usedRanges.push({ start: occurrence.start, end: occurrence.end });
      occurrences.push(occurrence);
      continue;
    }

    missing.push(mention);
  }

  occurrences.sort((left, right) => left.start - right.start);

  const segments = [];
  let cursor = 0;

  for (const occurrence of occurrences) {
    if (occurrence.start > cursor) {
      segments.push({ type: "text", text: noteText.slice(cursor, occurrence.start) });
    }

    segments.push({
      type: "mention",
      text: occurrence.text,
      mention: occurrence.mention
    });
    cursor = occurrence.end;
  }

  if (cursor < noteText.length) {
    segments.push({ type: "text", text: noteText.slice(cursor) });
  }

  if (missing.length) {
    const prefix = noteText.trim() ? "\n\nRelated records:\n" : "Related records:\n";
    segments.push({ type: "text", text: prefix });

    missing.forEach((mention, index) => {
      if (index > 0) {
        segments.push({ type: "text", text: "\n" });
      }

      segments.push({ type: "mention", text: mention.label, mention });
    });

    segments.push({ type: "text", text: "\n" });
  }

  return {
    segments,
    mentioned: occurrences.map((item) => item.mention),
    missing,
    plainText: plainTextFromSegments(segments)
  };
}
