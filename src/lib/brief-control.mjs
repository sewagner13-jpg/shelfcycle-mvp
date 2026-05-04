import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { compactWhitespace, extractDomain, normalizePhone, uniqueStrings } from "./normalize.mjs";

export function defaultBriefControl() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    exclude: {
      emails: [],
      domains: [],
      phones: [],
      keywords: []
    }
  };
}

function normalizeList(values = []) {
  return uniqueStrings((Array.isArray(values) ? values : []).map((value) => compactWhitespace(value)).filter(Boolean));
}

export function normalizeBriefControl(control = {}) {
  const defaults = defaultBriefControl();
  const exclude = control.exclude ?? {};

  return {
    ...defaults,
    ...control,
    exclude: {
      emails: normalizeList(exclude.emails).map((value) => value.toLowerCase()),
      domains: normalizeList(exclude.domains).map((value) => extractDomain(value) || value.toLowerCase()),
      phones: normalizeList(exclude.phones).map((value) => normalizePhone(value)).filter(Boolean),
      keywords: normalizeList(exclude.keywords).map((value) => value.toLowerCase())
    }
  };
}

export async function loadBriefControl(controlPath = "") {
  if (!controlPath) {
    return defaultBriefControl();
  }

  try {
    const contents = await readFile(controlPath, "utf8");
    return normalizeBriefControl(JSON.parse(contents));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return defaultBriefControl();
    }

    throw error;
  }
}

export async function saveBriefControl(controlPath, control = defaultBriefControl()) {
  const normalized = normalizeBriefControl(control);
  await mkdir(path.dirname(controlPath), { recursive: true });
  await writeFile(
    controlPath,
    JSON.stringify(
      {
        ...normalized,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );

  return normalized;
}

function threadParticipants(item = {}) {
  return item.externalParticipants ?? [];
}

function excludedByParticipant(item = {}, control = defaultBriefControl()) {
  const exclude = normalizeBriefControl(control).exclude;

  return threadParticipants(item).some((participant) => {
    const email = compactWhitespace(participant.email || "").toLowerCase();
    const domain = participant.domain || extractDomain(email);
    const phone = normalizePhone(email || participant.name || "");

    return (
      (email && exclude.emails.includes(email)) ||
      (domain && exclude.domains.includes(domain)) ||
      (phone && exclude.phones.includes(phone))
    );
  });
}

function excludedByKeyword(item = {}, control = defaultBriefControl()) {
  const keywords = normalizeBriefControl(control).exclude.keywords;
  const haystack = [
    item.subject,
    item.summary,
    item.analysis?.draftNote?.summary,
    item.analysis?.rawExtracts?.keyPoints?.join("\n"),
    item.analysis?.rawExtracts?.actionItems?.join("\n")
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return keywords.some((keyword) => keyword && haystack.includes(keyword));
}

export function shouldExcludeAnalyzedThread(item = {}, control = defaultBriefControl()) {
  return excludedByParticipant(item, control) || excludedByKeyword(item, control);
}

export function filterAnalyzedThreads(items = [], control = defaultBriefControl()) {
  return items.filter((item) => !shouldExcludeAnalyzedThread(item, control));
}

export function addExclusion(control = defaultBriefControl(), { type = "", value = "" } = {}) {
  const normalized = normalizeBriefControl(control);
  const cleanValue = compactWhitespace(value);

  if (!cleanValue) {
    return normalized;
  }

  if (type === "email") {
    normalized.exclude.emails = uniqueStrings([...normalized.exclude.emails, cleanValue.toLowerCase()]);
  }

  if (type === "domain") {
    normalized.exclude.domains = uniqueStrings([...normalized.exclude.domains, extractDomain(cleanValue) || cleanValue.toLowerCase()]);
  }

  if (type === "phone") {
    normalized.exclude.phones = uniqueStrings([...normalized.exclude.phones, normalizePhone(cleanValue)].filter(Boolean));
  }

  if (type === "keyword") {
    normalized.exclude.keywords = uniqueStrings([...normalized.exclude.keywords, cleanValue.toLowerCase()]);
  }

  return normalized;
}
