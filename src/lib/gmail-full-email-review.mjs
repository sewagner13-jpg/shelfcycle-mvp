import { getAccessToken } from "./gmail-client.mjs";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const EMAIL_TRIAGE_DECISIONS = Object.freeze([
  "create_note",
  "opportunity",
  "follow_up",
  "fyi",
  "ignore"
]);

const DECISION_LABELS = Object.freeze({
  create_note: "Create note",
  opportunity: "Opportunity",
  follow_up: "Follow-up",
  fyi: "FYI",
  ignore: "Ignore"
});
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_CLEAN_BODY_CHARS = 30_000;
const DEFAULT_INTERNAL_DOMAINS = ["clear-edge.net"];
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "aol.com",
  "proton.me",
  "protonmail.com"
]);
const SIGNOFF_RE = /^(?:all the best|best|best regards|cheers|cordially|kind regards|kindly|many thanks|regards|respectfully|sincerely|thanks|thank you|warm regards)[,!.\s-]*$/i;
const MOBILE_SIGNATURE_RE = /^(?:sent from my (?:iphone|ipad|android)|get outlook for (?:ios|android)|sent via mobile|sent from mail for windows)$/i;
const DISCLAIMER_RE = /^(?:confidentiality notice|confidential notice|privacy notice|legal disclaimer|disclaimer|this (?:e-?mail|message)(?: and any attachments)? (?:is|are) (?:confidential|intended)|the information contained in this (?:e-?mail|message)|this communication may contain|if you are not the intended recipient|please consider the environment before printing)/i;
const TITLE_WORD_RE = /\b(?:account manager|buyer|ceo|cfo|coo|director|engineer|manager|owner|president|procurement|purchasing|sales|technical|vice president|vp)\b/i;
const PHONE_RE = /(?:\+?\d[\d\s()./-]{6,}\d)(?:\s*(?:x|ext\.?)\s*\d+)?/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const WEBSITE_RE = /\b(?:https?:\/\/|www\.)[^\s]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|us|biz)\b/i;

function compactWhitespace(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeDomain(value = "") {
  return compactWhitespace(value).toLowerCase().replace(/^@/, "");
}

function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => {
      const point = Number.parseInt(code, 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    })
    .replace(/&#(\d+);/g, (match, code) => {
      const point = Number.parseInt(code, 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    });
}

function stripQuotedHtml(value = "") {
  return String(value || "")
    .replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, "\n")
    .replace(/<div\b[^>]*class=["'][^"']*(?:gmail_quote|gmail_extra|yahoo_quoted)[^"']*["'][^>]*>[\s\S]*$/gi, "\n")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ");
}

export function htmlEmailToText(value = "") {
  return decodeHtmlEntities(stripQuotedHtml(value))
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|table|tbody|thead|section|article|h[1-6])>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\uFFFC/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n");
}

function decodePartBody(part = {}) {
  if (!part.body?.data) {
    return "";
  }

  try {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function collectMimeTextParts(payload = {}, output = []) {
  if (!payload) {
    return output;
  }

  if (payload.parts?.length) {
    for (const part of payload.parts) {
      collectMimeTextParts(part, output);
    }
  }

  const mimeType = compactWhitespace(payload.mimeType).toLowerCase();
  const text = decodePartBody(payload);

  if (!payload.filename && text && (!mimeType || mimeType === "text/plain" || mimeType === "text/html")) {
    output.push({ mimeType, text });
  }

  return output;
}

export function extractGmailMessageText(message = {}) {
  const parts = collectMimeTextParts(message.payload);
  const plain = parts.filter((part) => part.mimeType !== "text/html").map((part) => part.text).filter(Boolean);
  const html = parts.filter((part) => part.mimeType === "text/html").map((part) => part.text).filter(Boolean);

  if (plain.length) {
    return decodeHtmlEntities(plain.join("\n"));
  }

  if (html.length) {
    return htmlEmailToText(html.join("\n"));
  }

  return "";
}

function normalizedLines(value = "") {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""));
}

function headerSequenceStartsAt(lines = [], index = 0) {
  if (!/^from:\s*\S/i.test(lines[index] || "")) {
    return false;
  }

  const lookahead = lines.slice(index, index + 8).join("\n");
  return /\n(?:sent|date):\s*/i.test(lookahead) && /\n(?:to|subject):\s*/i.test(lookahead);
}

function quotedHistoryIndex(lines = []) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = compactWhitespace(lines[index]);

    if (!line) {
      continue;
    }

    if (
      /^on .{3,250} wrote:$/i.test(line) ||
      /^-{2,}\s*(?:original|forwarded) message\s*-{2,}$/i.test(line) ||
      /^begin forwarded message:?$/i.test(line) ||
      /^_{5,}$/i.test(line) ||
      /^>{1,}\s*/.test(line) ||
      headerSequenceStartsAt(lines, index)
    ) {
      return index;
    }
  }

  return -1;
}

function disclaimerIndex(lines = []) {
  const minimumIndex = Math.max(1, Math.floor(lines.length * 0.35));

  for (let index = minimumIndex; index < lines.length; index += 1) {
    if (DISCLAIMER_RE.test(compactWhitespace(lines[index]))) {
      return index;
    }
  }

  return -1;
}

function signatureSignals(lines = []) {
  const text = lines.join("\n");
  return [
    EMAIL_RE.test(text),
    PHONE_RE.test(text),
    WEBSITE_RE.test(text),
    TITLE_WORD_RE.test(text)
  ].filter(Boolean).length;
}

function contactTailIndex(lines = []) {
  let blockStart = -1;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!compactWhitespace(lines[index])) {
      blockStart = index + 1;
      break;
    }
  }

  if (blockStart <= 0 || blockStart >= lines.length) {
    return -1;
  }

  const tail = lines.slice(blockStart);
  if (tail.length > 12 || signatureSignals(tail) < 2) {
    return -1;
  }

  return blockStart;
}

function signatureIndex(lines = []) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = compactWhitespace(lines[index]);

    if (line === "--" || line === "-- --" || MOBILE_SIGNATURE_RE.test(line)) {
      return index;
    }
  }

  const start = Math.max(0, lines.length - 28);
  for (let index = start; index < lines.length; index += 1) {
    if (SIGNOFF_RE.test(compactWhitespace(lines[index]))) {
      return index;
    }
  }

  return contactTailIndex(lines);
}

function trimAndCollapseLines(lines = []) {
  const output = [];
  let previousBlank = true;

  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]{2,}/g, " ").trimEnd();
    const blank = !line.trim();

    if (blank && previousBlank) {
      continue;
    }

    output.push(blank ? "" : line.trim());
    previousBlank = blank;
  }

  while (output.length && !output[0]) {
    output.shift();
  }
  while (output.length && !output[output.length - 1]) {
    output.pop();
  }

  return output;
}

export function sanitizeEmailBody(value = "") {
  let lines = normalizedLines(value);
  const quotedAt = quotedHistoryIndex(lines);

  if (quotedAt >= 0) {
    lines = lines.slice(0, quotedAt);
  }

  const disclaimerAt = disclaimerIndex(lines);
  if (disclaimerAt >= 0) {
    lines = lines.slice(0, disclaimerAt);
  }

  const signatureAt = signatureIndex(lines);
  if (signatureAt >= 0) {
    lines = lines.slice(0, signatureAt);
  }

  return trimAndCollapseLines(lines).join("\n").slice(0, MAX_CLEAN_BODY_CHARS).trim();
}

function getHeaderValue(message = {}, name = "") {
  return message.payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export function parseEmailAddress(value = "") {
  const text = compactWhitespace(value);
  const match = text.match(/"?([^"<]*)"?\s*<([^>]+)>|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  const email = compactWhitespace(match?.[2] ?? match?.[3] ?? "").toLowerCase();
  const name = compactWhitespace(match?.[1] ?? (email ? text.replace(email, "") : text)).replace(/^"|"$/g, "");
  const domain = email.includes("@") ? email.split("@").pop().toLowerCase() : "";

  return { name, email, domain };
}

function companyFromDomain(domain = "") {
  const normalized = normalizeDomain(domain);

  if (!normalized || GENERIC_EMAIL_DOMAINS.has(normalized)) {
    return "";
  }

  const label = normalized.split(".")[0].replace(/[-_]+/g, " ");
  return label.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isoTimestamp(message = {}, dateHeader = "") {
  const internal = Number(message.internalDate || 0);
  const parsed = internal || Date.parse(dateHeader || "");
  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : "";
}

function suggestedActionForMessage(subject = "", body = "") {
  const text = `${subject}\n${body}`;

  if (/\b(?:quote|pricing|price request|rfq|request for quote)\b/i.test(text)) {
    return "Review the pricing or quote request and decide whether to open an opportunity.";
  }
  if (/\b(?:sample|trial|test quantity)\b/i.test(text)) {
    return "Stage a sample follow-up with an owner and due date.";
  }
  if (/\b(?:sds|tds|coa|technical data sheet|safety data sheet)\b/i.test(text)) {
    return "Review the document request and create a follow-up if a file is still owed.";
  }
  if (/\b(?:following up|follow up|checking in|circling back|any update)\b/i.test(text)) {
    return "Create a dated follow-up or close this as FYI if no response is needed.";
  }
  if (/\b(?:purchase order|\bpo\b|order confirmation|shipment|delivery|eta)\b/i.test(text)) {
    return "Review the commercial or logistics update and create a note if it changes the account record.";
  }

  return "Review the source and choose the appropriate triage action.";
}

function normalizedExternalEmails(externalParticipants = []) {
  return new Set(
    externalParticipants
      .map((participant) => compactWhitespace(participant?.email).toLowerCase())
      .filter(Boolean)
  );
}

function buildReviewMessage(message = {}, { externalEmails = new Set(), internalDomains = new Set() } = {}) {
  const from = parseEmailAddress(getHeaderValue(message, "from"));
  const subject = compactWhitespace(getHeaderValue(message, "subject"));
  const dateHeader = compactWhitespace(getHeaderValue(message, "date"));
  const cleanBody = sanitizeEmailBody(extractGmailMessageText(message));
  const unread = (message.labelIds ?? []).includes("UNREAD");
  const external = externalEmails.has(from.email) || Boolean(from.domain && !internalDomains.has(from.domain));

  return {
    id: String(message.id || ""),
    threadId: String(message.threadId || ""),
    subject,
    receivedAt: isoTimestamp(message, dateHeader),
    dateHeader,
    unread,
    readStatus: unread ? "unread" : "read",
    external,
    from: {
      ...from,
      company: companyFromDomain(from.domain)
    },
    cleanBody,
    suggestedAction: suggestedActionForMessage(subject, cleanBody),
    sanitized: true
  };
}

export function buildFullEmailReview(thread = {}, {
  externalParticipants = [],
  internalDomains = [],
  checkedAt = new Date().toISOString()
} = {}) {
  const externalEmails = normalizedExternalEmails(externalParticipants);
  const internalDomainSet = new Set(
    [...DEFAULT_INTERNAL_DOMAINS, ...internalDomains]
      .map(normalizeDomain)
      .filter(Boolean)
  );
  const messages = (thread.messages ?? [])
    .map((message) => buildReviewMessage(message, { externalEmails, internalDomains: internalDomainSet }))
    .filter((message) => message.id)
    .sort((left, right) => Date.parse(left.receivedAt || 0) - Date.parse(right.receivedAt || 0));
  const latest = (items) => items[items.length - 1] ?? null;
  const selected =
    latest(messages.filter((message) => message.unread && message.external)) ||
    latest(messages.filter((message) => message.external)) ||
    latest(messages);
  const earlierUnread = messages.filter((message) => message.unread && message.id !== selected?.id);
  const readHistory = messages.filter((message) => !message.unread && message.id !== selected?.id);

  return {
    threadId: String(thread.id || selected?.threadId || ""),
    subject: selected?.subject || messages.find((message) => message.subject)?.subject || "",
    sourceCheckedAt: checkedAt,
    latestRelevantMessageId: selected?.id || "",
    earlierUnreadMessageIds: earlierUnread.map((message) => message.id),
    readHistoryMessageIds: readHistory.map((message) => message.id),
    counts: {
      messages: messages.length,
      unread: messages.filter((message) => message.unread).length,
      earlierUnread: earlierUnread.length,
      readHistory: readHistory.length
    },
    messages,
    sanitized: true,
    gmailMutationAllowed: false
  };
}

export async function fetchGmailThreadReadOnly({
  threadId = "",
  config = {},
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const id = compactWhitespace(threadId);

  if (!id) {
    throw new Error("Missing Gmail thread id.");
  }

  const { accessToken, user } = await getAccessToken({
    ...config,
    scopes: [GMAIL_READONLY_SCOPE]
  });
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}/threads/${encodeURIComponent(id)}`);
  url.searchParams.set("format", "full");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gmail full-email read failed (${response.status}): ${compactWhitespace(errorText).slice(0, 500)}`);
    }

    return response.json();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Gmail full-email read timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeEmailDecision(value = "") {
  const decision = compactWhitespace(value).toLowerCase().replace(/[\s-]+/g, "_");
  return EMAIL_TRIAGE_DECISIONS.includes(decision) ? decision : "";
}

export function stageEmailDecision(existing = [], {
  messageId = "",
  decision = "",
  selectedAt = new Date().toISOString()
} = {}) {
  const normalizedMessageId = compactWhitespace(messageId);
  const normalizedDecision = normalizeEmailDecision(decision);

  if (!normalizedMessageId) {
    throw new Error("Missing Gmail message id for the triage decision.");
  }
  if (!normalizedDecision) {
    throw new Error("Unsupported email triage decision.");
  }

  const record = {
    messageId: normalizedMessageId,
    decision: normalizedDecision,
    label: DECISION_LABELS[normalizedDecision],
    status: ["fyi", "ignore"].includes(normalizedDecision) ? "resolved" : "staged",
    selectedAt,
    gmailMutationPerformed: false
  };

  return [
    ...existing.filter((item) => item?.messageId !== normalizedMessageId),
    record
  ];
}
