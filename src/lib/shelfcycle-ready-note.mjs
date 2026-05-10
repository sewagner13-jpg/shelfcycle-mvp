import { compactWhitespace, uniqueStrings } from "./normalize.mjs";

function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code) => {
      const point = Number.parseInt(code, 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : _match;
    });
}

export function normalizeShelfCycleNoteText(value = "") {
  return decodeHtmlEntities(value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanLine(value = "") {
  return compactWhitespace(decodeHtmlEntities(value));
}

function trimEmailTail(value = "") {
  return String(value || "")
    .replace(/\s--\sKind regards[\s\S]*$/i, "")
    .replace(/\sBest regards,?[\s\S]*$/i, "")
    .replace(/\s--\sThanks[\s\S]*$/i, "")
    .replace(/\s--\sRegards[\s\S]*$/i, "")
    .replace(/\s[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3},\s*(?:President|Owner|Director|VP|Vice President|Sales|Manager|Purchasing|Procurement)[\s\S]*$/i, "")
    .replace(/\sOn .+ wrote:[\s\S]*$/i, "");
}

function shortText(value = "", maxLength = 240) {
  const text = cleanLine(trimEmailTail(value))
    .replace(/^Thread Summary:\s*/i, "")
    .replace(/^Main takeaway:\s*/i, "")
    .replace(/^Recommended next step:\s*/i, "")
    .replace(/^(?:sean,?\s*)?(?:happy\s+(?:monday|tuesday|wednesday|thursday|friday|weekend)\.?\s*)/i, "")
    .replace(/^sean,?\s*/i, "");

  if (text.length <= maxLength) {
    return text;
  }

  const boundary = text.slice(0, maxLength + 1).search(/[.!?]\s+[A-Z0-9]/);

  if (boundary > 50) {
    return text.slice(0, boundary + 1);
  }

  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function extractLabeledText(text = "", label = "") {
  const source = String(text || "");
  const pattern = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\b(?:Thread Summary|Main takeaway|Recommended next step|Source|Action|Why it matters):|$)`, "i");
  const match = source.match(pattern);

  return match ? shortText(match[1]) : "";
}

function extractLegacySectionBullets(text = "", label = "") {
  const source = String(text || "");
  const pattern = new RegExp(`\\b${label}:\\s*([\\s\\S]*?)(?=\\n\\s*\\b(?:Interaction Type|Subject|External Participants|Matched Contacts|Key Points|Next Steps):|$)`, "i");
  const match = source.match(pattern);

  if (!match) {
    return [];
  }

  return match[1]
    .split(/\n+\s*-\s+/)
    .map((item) => item.replace(/^\s*-\s*/, ""))
    .map((item) => shortText(item, 220))
    .filter(Boolean)
    .filter((item) => !/^(?:Interaction Type|Subject|External Participants|Matched Contacts|Key Points|Next Steps):/i.test(item))
    .slice(0, 4);
}

function extractMoneyVariables(...values) {
  const text = values.map((value) => Array.isArray(value) ? value.join(" ") : value).join(" ");
  return uniqueStrings((text.match(/\$\s*\d+(?:,\d{3})*(?:\.\d+)?(?:\s*-\s*\$?\d+(?:,\d{3})*(?:\.\d+)?)?(?:\s*\/\s*(?:lb|kg|drum|tote|pail|package))?|\b\d+(?:\.\d+)?\s*(?:\/|per)\s*(?:lb|kg|drum|tote|pail|pkg|package)\b/gi) ?? [])
    .map(cleanLine));
}

function firstClean(...values) {
  return values.map((value) => cleanLine(value)).find(Boolean) ?? "";
}

function externalLabel(action = {}) {
  const participant = action.externalParticipants?.[0] ?? {};
  return firstClean(participant.name, participant.email, participant.domain);
}

function aiShelfCycleCandidate(action = {}) {
  const candidate = action.briefAi?.shelfCycleCandidate ?? action.analysis?.briefAi?.shelfCycleCandidate ?? null;

  return candidate?.shouldConsider ? candidate : null;
}

function parseCandidateField(field = "") {
  const text = cleanLine(field)
    .replace(/^field:\s*/i, "")
    .replace(/^suggested\s+field:\s*/i, "");
  const [rawKey, ...rest] = text.split(":");

  if (rawKey && rest.length) {
    return `${cleanLine(rawKey)}: ${cleanLine(rest.join(":"))}`;
  }

  return text;
}

function collectKeyVariables(action = {}, candidate = null) {
  const fields = (candidate?.fields ?? []).map(parseCandidateField);
  const details = (action.briefAi?.keyDetails ?? []).map(cleanLine);
  const fromDraft = [
    action.writePlan?.fields?.product,
    action.writePlan?.fields?.price,
    action.writePlan?.fields?.quantity,
    action.writePlan?.fields?.packaging,
    action.writePlan?.fields?.poNumber,
    action.writePlan?.fields?.quoteNumber
  ].map(cleanLine);

  const money = extractMoneyVariables(
    action.summary,
    action.draftNote?.summary,
    action.briefAi?.why,
    action.briefAi?.keyDetails,
    candidate?.summary,
    candidate?.fields
  );

  return uniqueStrings([...details, ...fields, ...fromDraft, ...money].filter(Boolean))
    .map((item) => shortText(item, 160))
    .slice(0, 10);
}

function collectDocumentNames(action = {}) {
  const attachments = (action.workspaceArtifacts?.attachments ?? [])
    .map((item) => cleanLine(item.filename || item.name))
    .filter(Boolean);
  const driveFiles = (action.workspaceArtifacts?.driveFiles ?? [])
    .map((item) => cleanLine(item.name || item.id))
    .filter(Boolean);

  return uniqueStrings([...attachments, ...driveFiles]).slice(0, 8);
}

function decisionOrStatus(action = {}, candidate = null, draftSummary = "") {
  const combined = [
    action.summary,
    action.draftNote?.summary,
    action.briefAi?.why,
    action.briefAi?.action,
    candidate?.summary
  ].map(cleanLine).join(" ");
  const money = extractMoneyVariables(combined);

  if (/\bdelivered cost\b/i.test(combined) && money.length) {
    return `Delivered-cost guidance was received (${money.slice(0, 2).join(" to ")}); margin/customer pricing decision is still open.`;
  }

  if (/\bcost\b/i.test(combined) && /\bprofit|margin|mark\s*up|markup\b/i.test(combined)) {
    return "Cost basis needs confirmation before ClearEdge adds margin or gives customer pricing.";
  }

  if (/\bperformance\b[\s\S]{0,80}\bacceptable\b/i.test(combined) && /\bpricing|price|quote\b/i.test(combined)) {
    return "Product performance was reported as acceptable; pricing is the open follow-up.";
  }

  const labeledTakeaway = extractLabeledText(action.summary, "Main takeaway") || extractLabeledText(draftSummary, "Main takeaway");

  if (labeledTakeaway) {
    return labeledTakeaway;
  }

  const candidates = [
    candidate?.summary,
    action.briefAi?.why,
    action.briefAi?.action,
    draftSummary,
    action.summary
  ].map(cleanLine).filter(Boolean);
  const resolved = candidates.find((text) =>
    /\b(confirm(?:ed)?|decid(?:ed|e)|approved|prefer(?:red)?|received|sent|quoted|ordered|waiting|pending|eta|po\b|purchase order)\b/i.test(text)
  );

  return resolved || candidates[0] || "No final decision was identified in the packet. Treat this as a review item.";
}

function addSection(lines, title, items = []) {
  const cleanItems = uniqueStrings(items.map((item) => shortText(item)).filter(Boolean));

  if (!cleanItems.length) {
    return;
  }

  if (lines.length) {
    lines.push("");
  }

  lines.push(`${title}:`);
  lines.push(...cleanItems.map((item) => `- ${item}`));
}

export function buildShelfCycleReadyNote(action = {}) {
  const draftNote = action.draftNote ?? {};
  const fields = action.writePlan?.fields ?? {};
  const candidate = aiShelfCycleCandidate(action);
  const draftSummary = firstClean(draftNote.summary, fields.summary, action.summary);
  const legacyKeyPoints = extractLegacySectionBullets(action.summary || draftSummary, "Key Points");
  const legacyNextSteps = extractLegacySectionBullets(action.summary || draftSummary, "Next Steps");
  const title = firstClean(candidate?.title, draftNote.title, fields.title, action.subject, "ClearEdge note");
  const labeledNextStep = extractLabeledText(action.summary, "Recommended next step") || extractLabeledText(draftSummary, "Recommended next step");
  const labeledTakeaway = extractLabeledText(action.summary, "Main takeaway") || extractLabeledText(draftSummary, "Main takeaway");
  const actionText = firstClean(action.briefAi?.action, action.followUpDraft?.nextStep, labeledNextStep);
  const why = firstClean(action.briefAi?.why, candidate?.summary, labeledTakeaway, draftSummary);
  const variables = collectKeyVariables(action, candidate);
  const documents = collectDocumentNames(action);
  const participant = externalLabel(action);
  const lines = [];

  addSection(lines, "Summary", [
    ...(candidate || action.briefAi ? [why || draftSummary] : legacyKeyPoints),
    !legacyKeyPoints.length ? (why || draftSummary || "Review packet generated from ClearEdge communication.") : ""
  ]);
  addSection(lines, "Decision / status", [
    decisionOrStatus(action, candidate, draftSummary)
  ]);
  addSection(lines, "Key variables", variables);
  addSection(lines, "Next step", [
    actionText ||
      (legacyNextSteps.length && /\bpricing|price|quote\b/i.test(legacyNextSteps.join(" "))
        ? "Review pricing needs and decide what pricing response should be sent."
        : legacyNextSteps[0]) ||
      "Review and decide whether this belongs in ShelfCycle."
  ]);
  addSection(lines, "Documents referenced", documents);
  addSection(lines, "Source", [
    action.subject ? `Email/thread: ${action.subject}` : "",
    participant ? `Primary outside party: ${participant}` : ""
  ]);

  return {
    title,
    type: firstClean(draftNote.type, fields.type, "Email"),
    date: firstClean(fields.date) || new Date().toISOString().slice(0, 10),
    summary: normalizeShelfCycleNoteText(lines.join("\n")),
    source: candidate || action.briefAi ? "openai_brief_ai" : "deterministic_review_packet",
    warnings: candidate || action.briefAi ? [] : ["No ChatGPT owner-read was attached; generated from deterministic review-packet fields."]
  };
}
