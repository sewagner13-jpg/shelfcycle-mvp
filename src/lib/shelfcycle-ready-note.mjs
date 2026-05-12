import { compactWhitespace, uniqueStrings } from "./normalize.mjs";
import { companyNameFromSubject, preferredExternalParticipant } from "./business-email-identity.mjs";

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

function stripGeneratedIntelligenceBlock(value = "") {
  return String(value || "").replace(
    /^\s*#{1,6}\s*ClearEdge Intelligence Brief[\s\S]*?(?=\n\s*Thread Summary:|\n\s*Interaction Type:|$)/i,
    ""
  );
}

function trimEmailTail(value = "") {
  return String(value || "")
    .replace(/\s--\sKind regards[\s\S]*$/i, "")
    .replace(/\sBest regards,?[\s\S]*$/i, "")
    .replace(/\sAll the best,?[\s\S]*$/i, "")
    .replace(/\sThanks,?[\s\S]*$/i, "")
    .replace(/\s--\sThanks[\s\S]*$/i, "")
    .replace(/\s--\sRegards[\s\S]*$/i, "")
    .replace(/\s[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3},\s*(?:President|Owner|Director|VP|Vice President|Sales|Manager|Purchasing|Procurement)[\s\S]*$/i, "")
    .replace(/\sOn .+ wrote:[\s\S]*$/i, "");
}

function cleanLegacyRequestTarget(value = "") {
  return cleanLine(value)
    .replace(/\bthe\s+(?=[A-Z]?\d)/gi, "")
    .replace(/\s+to\s+(?:the\s+following|following)\s*:?\s*$/i, "")
    .replace(/\s*[:;,.]\s*$/g, "");
}

function normalizeLegacyRequestText(value = "") {
  const text = cleanLine(value);
  const directMatch = text.match(/^([A-Z][A-Za-z.'-]+)\s*[-:]\s*please\s+send\s+(.+?)(?:\s+to\s+(?:the\s+following|following)\s*:?\s*|[.!?]\s*|$)/i);

  if (directMatch) {
    const assignee = cleanLine(directMatch[1]);
    const requested = cleanLegacyRequestTarget(directMatch[2]);

    if (assignee && requested) {
      return `${assignee} was asked to send ${requested}.`;
    }
  }

  const requestMatch = text.match(/\bplease\s+send\s+(.+?)(?:\s+to\s+(?:the\s+following|following)\s*:?\s*|[.!?]\s*|$)/i);

  if (requestMatch) {
    const requested = cleanLegacyRequestTarget(requestMatch[1]);

    if (requested) {
      return `Requested send of ${requested}.`;
    }
  }

  return text;
}

function shortText(value = "", maxLength = 240) {
  const text = normalizeLegacyRequestText(cleanLine(trimEmailTail(stripGeneratedIntelligenceBlock(value)))
    .replace(/^Thread Summary:\s*/i, "")
    .replace(/^Main takeaway:\s*/i, "")
    .replace(/^Recommended next step:\s*/i, "")
    .replace(/^(?:sean,?\s*)?(?:happy\s+(?:monday|tuesday|wednesday|thursday|friday|weekend)\.?\s*)/i, "")
    .replace(/^sean,?\s*/i, ""));

  if (text.length <= maxLength) {
    return text;
  }

  const boundary = text.slice(0, maxLength + 1).search(/[.!?]\s+[A-Z0-9]/);

  if (boundary > 50) {
    return text.slice(0, boundary + 1);
  }

  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function isLowValueLegacyBullet(value = "") {
  return /\b(kind regards,\s*sean|clear-edge\.net|linkedin\.com\/in\/sean|on .+ wrote:|sorry[,.]?\s+forgot|i just wanted to reach out|old school crm|who needs ai|extracted gmail signatures)\b/i.test(value);
}

function looksLikeExternalReply(value = "") {
  return /\b(hello\s+sean|hi\s+sean|dear\s+sean|pleasure talking|i(?:'|’)ve cc(?:'|e)?d|will be follow(?:ing)? it up)\b/i.test(value);
}

function operatorNextStep(value = "", action = {}) {
  const raw = cleanLine(stripGeneratedIntelligenceBlock(value));
  const text = shortText(value, 180);

  if (!text) {
    return "";
  }

  if (/^hello\s+sean\b/i.test(raw) && (
    /\b(cc(?:'|e)?d|will be follow(?:ing)? it up|salesperson|sales team)\b/i.test(raw) ||
    action.relationship?.relationship === "supplier"
  )) {
    const relationship = action.relationship?.relationship === "supplier" ? "supplier" : "customer";
    return `Decide whether to create or update the ${relationship} and contact record in ShelfCycle, then log the follow-up owner from the thread.`;
  }

  if (/\b(?:please send|was asked to send|requested send of)\b/i.test(raw) || /\bwas asked to send\b/i.test(text)) {
    return "Send or confirm the requested sample/material follow-up, then log the outcome in ShelfCycle.";
  }

  return text;
}

function operatorSummaryText(value = "", action = {}) {
  const raw = cleanLine(stripGeneratedIntelligenceBlock(value));

  if (/^hello\s+sean\b/i.test(raw) && action.relationship?.relationship === "supplier") {
    const company = companyNameFromSubject(action.subject || action.fields?.subject || "") || "The supplier";
    return `${company} replied after the meeting and moved the follow-up to the appropriate sales contact.`;
  }

  if (/\b(?:please send|was asked to send|requested send of)\b/i.test(raw)) {
    return shortText(raw);
  }

  return shortText(value);
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
    .filter((item) => !isLowValueLegacyBullet(item))
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
  const participant = preferredExternalParticipant(action);
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
  const cleanSummary = stripGeneratedIntelligenceBlock(action.summary);
  const cleanDraftSummary = stripGeneratedIntelligenceBlock(action.draftNote?.summary);
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
    cleanSummary,
    cleanDraftSummary,
    action.briefAi?.why,
    action.briefAi?.keyDetails,
    candidate?.summary,
    candidate?.fields
  );

  return uniqueStrings([...details, ...fields, ...fromDraft, ...money].filter(Boolean))
    .map((item) => shortText(item, 160))
    .slice(0, 5);
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
    stripGeneratedIntelligenceBlock(action.summary),
    stripGeneratedIntelligenceBlock(action.draftNote?.summary),
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

  if (/\bcc(?:'|e)?d\b[\s\S]{0,140}\b(salesperson|sales\s+person|sales team|mr\.?\s+shin)\b/i.test(combined)) {
    return "Green Chemical introduced a sales contact to continue the EO/PO derivatives follow-up; no ShelfCycle record decision is final yet.";
  }

  if (/\b(?:please send|was asked to send|requested send of)\b/i.test(combined)) {
    return "Sample/material follow-up is open; the packet does not show that the requested items were sent.";
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
  const cleanedDraftSummary = firstClean(
    stripGeneratedIntelligenceBlock(draftNote.summary),
    stripGeneratedIntelligenceBlock(fields.summary),
    stripGeneratedIntelligenceBlock(action.summary)
  );
  const cleanedActionSummary = firstClean(stripGeneratedIntelligenceBlock(action.summary));
  const draftSummary = firstClean(cleanedDraftSummary, cleanedActionSummary);
  const legacySource = cleanedActionSummary || draftSummary;
  const legacyKeyPoints = extractLegacySectionBullets(legacySource, "Key Points").slice(0, 2);
  const legacyNextSteps = extractLegacySectionBullets(legacySource, "Next Steps").slice(0, 2);
  const title = firstClean(candidate?.title, draftNote.title, fields.title, action.subject, "ClearEdge note");
  const labeledNextStep = extractLabeledText(cleanedActionSummary, "Recommended next step") || extractLabeledText(draftSummary, "Recommended next step");
  const labeledTakeaway = extractLabeledText(cleanedActionSummary, "Main takeaway") || extractLabeledText(draftSummary, "Main takeaway");
  const actionText = operatorNextStep(firstClean(action.briefAi?.action, action.followUpDraft?.nextStep, labeledNextStep), action);
  const why = firstClean(action.briefAi?.why, candidate?.summary, labeledTakeaway, draftSummary);
  const variables = collectKeyVariables(action, candidate);
  const documents = collectDocumentNames(action);
  const participant = externalLabel(action);
  const externalReplySummary = operatorSummaryText(
    legacyKeyPoints.find(looksLikeExternalReply) || (looksLikeExternalReply(labeledNextStep) ? labeledNextStep : ""),
    action
  );
  const lines = [];

  addSection(lines, "Summary", [
    ...(candidate || action.briefAi || labeledTakeaway ? [externalReplySummary || why || draftSummary] : legacyKeyPoints),
    !legacyKeyPoints.length && !externalReplySummary ? (why || draftSummary || "Review packet generated from ClearEdge communication.") : ""
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
