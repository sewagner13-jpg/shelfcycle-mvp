import { fetchGmailAttachmentData } from "./gmail-client.mjs";
import {
  compactWhitespace,
  extractDomain,
  firstNonEmpty,
  isLikelyCompanyName,
  isLikelyPersonName,
  uniqueStrings
} from "./normalize.mjs";
import { companyNameFromSubject } from "./business-email-identity.mjs";

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_IMAGE_BYTES = 750_000;
const DEFAULT_MAX_IMAGES_PER_THREAD = 4;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const WEBSITE_RE = /\b(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"')]+)?\b/i;
const INTERNATIONAL_PHONE_RE = /(?:\+?\d[\d\s()./-]{6,}\d)(?:\s*(?:x|ext\.?)\s*\d+)?/gi;
const SIGNOFF_RE = /^(kindly|kind regards|best regards|regards|thanks|thank you|sincerely|cheers|warm regards)[,!.]*$/i;
const TITLE_RE = /\b(manager|sales|chemical sales|director|president|owner|procurement|purchasing|buyer|technical|chemist|engineer|operations|logistics|sourcing|representative|vp|ceo|cfo|coo|team)\b/i;

function getHeaderValue(message = {}, name = "") {
  return message.payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function parseAddressHeader(value = "") {
  const match = String(value).match(/"?([^"<]*)"?\s*<([^>]+)>|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);

  if (!match) {
    return {
      name: compactWhitespace(value),
      email: "",
      domain: ""
    };
  }

  const email = compactWhitespace(match[2] ?? match[3] ?? "");

  return {
    name: compactWhitespace(match[1] ?? ""),
    email,
    domain: extractDomain(email)
  };
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
    .replace(/&#(\d+);/g, (_match, code) => {
      const point = Number.parseInt(code, 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : _match;
    });
}

export function htmlToText(value = "") {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|table|tbody|thead|section|article|h[1-6])>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\uFFFC/g, " ")
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

function collectTextParts(payload = {}, output = []) {
  if (!payload) {
    return output;
  }

  if (payload.parts?.length) {
    for (const part of payload.parts) {
      collectTextParts(part, output);
    }
  }

  if (!payload.filename && payload.body?.data && (!payload.mimeType || /^text\/(?:plain|html)$/i.test(payload.mimeType || ""))) {
    output.push({
      mimeType: payload.mimeType || "",
      text: decodePartBody(payload)
    });
  }

  return output;
}

function messageText(message = {}) {
  return collectTextParts(message.payload)
    .map((part) => part.mimeType === "text/html" ? htmlToText(part.text) : decodeHtmlEntities(part.text))
    .join("\n");
}

function cutQuotedHistory(text = "") {
  return String(text || "")
    .split(/\n\s*(?:On .+ wrote:|From:\s|Sent:\s|-----Original Message-----)/i)[0] ?? "";
}

function cleanLines(text = "") {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => compactWhitespace(line.replace(/[|]+/g, " ")))
    .filter(Boolean);
}

export function signatureBlockFromText(text = "") {
  const lines = cleanLines(cutQuotedHistory(htmlToText(text)));

  if (!lines.length) {
    return "";
  }

  const signoffIndex = lines.reduce((latest, line, index) => SIGNOFF_RE.test(line) ? index : latest, -1);
  const candidateLines = signoffIndex >= 0
    ? lines.slice(signoffIndex + 1, signoffIndex + 22)
    : lines.slice(-18);

  return candidateLines.join("\n");
}

function normalizeWebsite(value = "") {
  const text = compactWhitespace(value);

  if (!text || text.includes("@")) {
    return "";
  }

  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function extractWebsite(text = "") {
  const match = String(text).match(WEBSITE_RE);
  const value = compactWhitespace(match?.[0] ?? "");

  if (!value || value.includes("@")) {
    return "";
  }

  return normalizeWebsite(value);
}

function phoneLines(lines = []) {
  return lines.filter((line) => INTERNATIONAL_PHONE_RE.test(line) || /\b(?:tel|phone|direct|dir|mobile|cell|c\.?p|fax)\b/i.test(line));
}

function cleanPhone(value = "") {
  return compactWhitespace(value)
    .replace(/\b(?:tel|phone|direct|dir|mobile|cell|c\.?p|fax)\b\.?\s*:?\s*/ig, "")
    .replace(/\s{2,}/g, " ");
}

function extractPhoneByLabel(lines = [], labelPattern) {
  for (const line of lines) {
    const labelIndex = line.search(labelPattern);

    if (labelIndex < 0) {
      continue;
    }

    const matches = [...line.matchAll(INTERNATIONAL_PHONE_RE)];
    const match = matches.find((item) => item.index >= labelIndex) ?? matches[0];

    if (match) {
      return cleanPhone(match[0]);
    }
  }

  return "";
}

function extractPhones(lines = []) {
  const joined = lines.join("\n");
  const allPhones = [...joined.matchAll(INTERNATIONAL_PHONE_RE)]
    .map((match) => cleanPhone(match[0]))
    .filter((phone) => /\d{7,}/.test(phone.replace(/\D/g, "")));

  return {
    phone: extractPhoneByLabel(lines, /\b(?:tel|phone|direct|dir)\b/i) || allPhones[0] || "",
    mobilePhone: extractPhoneByLabel(lines, /\b(?:mobile|cell|c\.?p)\b/i) || allPhones[1] || "",
    faxPhone: extractPhoneByLabel(lines, /\bfax\b/i) || "",
    allPhones: uniqueStrings(allPhones)
  };
}

function likelyCompanyLine(lines = [], personName = "", title = "") {
  return lines.find((line) => {
    if (line === personName || line === title || EMAIL_RE.test(line) || extractWebsite(line) || phoneLines([line]).length) {
      return false;
    }

    return isLikelyCompanyName(line);
  }) ?? "";
}

function likelyPersonLine(lines = []) {
  return lines.find((line) => isLikelyPersonName(line) && !isLikelyCompanyName(line)) ?? "";
}

function likelyTitleLine(lines = [], personName = "") {
  return lines.find((line) => line !== personName && TITLE_RE.test(line) && !EMAIL_RE.test(line) && !extractWebsite(line)) ?? "";
}

function parseInternationalAddress(lines = [], knownValues = []) {
  const known = new Set(knownValues.map((value) => compactWhitespace(value)).filter(Boolean));
  const candidates = lines.filter((line) => {
    if (known.has(line) || EMAIL_RE.test(line) || extractWebsite(line) || phoneLines([line]).length || SIGNOFF_RE.test(line)) {
      return false;
    }

    return /\d/.test(line) && /,/.test(line) || /\b(korea|china|india|germany|canada|mexico|usa|united states|seoul|shanghai|building|road|street|avenue|blvd|suite|floor|fl\.?|f)\b/i.test(line);
  });

  if (!candidates.length) {
    return {};
  }

  const address = candidates.slice(0, 3).join(", ");
  const zip = compactWhitespace((address.match(/\((\d{4,10})\)|\b\d{5}(?:-\d{4})?\b/) ?? [])[1] ?? (address.match(/\b\d{5}(?:-\d{4})?\b/) ?? [])[0] ?? "");
  const country = compactWhitespace((address.match(/\b(Korea|South Korea|China|India|Germany|Canada|Mexico|United States|USA)\b/i) ?? [])[0] ?? "");
  const city = compactWhitespace((address.match(/\b(Seoul|Shanghai|Mumbai|Toronto|Monterrey)\b/i) ?? [])[0] ?? "");

  return {
    streetAddress: address,
    city,
    stateRegion: "",
    zip,
    country
  };
}

export function parseSignatureText(text = "", { sender = {}, subject = "" } = {}) {
  const lines = cleanLines(text);
  const joined = lines.join("\n");
  const email = compactWhitespace((joined.match(EMAIL_RE) ?? [])[0] ?? "");
  const website = extractWebsite(joined);
  const personName = likelyPersonLine(lines) || (sender.name && isLikelyPersonName(sender.name) ? sender.name : "");
  const title = likelyTitleLine(lines, personName);
  const companyName = likelyCompanyLine(lines, personName, title) || companyNameFromSubject(subject);
  const phones = extractPhones(lines);
  const address = parseInternationalAddress(lines, [personName, title, companyName, email, website, ...phones.allPhones]);
  const confidenceSignals = [
    personName,
    title,
    companyName,
    email || sender.email,
    phones.phone || phones.mobilePhone,
    website,
    address.streetAddress
  ].filter(Boolean).length;

  return normalizeSignatureFields({
    personName,
    title,
    email: email || sender.email || "",
    phone: phones.phone,
    mobilePhone: phones.mobilePhone,
    faxPhone: phones.faxPhone,
    companyName,
    website,
    ...address,
    confidence: Math.min(0.92, confidenceSignals ? 0.28 + confidenceSignals * 0.1 : 0),
    sourceText: joined
  }, { sender, subject });
}

function responseText(response = {}) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  for (const output of response.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return "";
}

function signatureSchema() {
  const fields = {
    personName: { type: "string" },
    title: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    mobilePhone: { type: "string" },
    faxPhone: { type: "string" },
    companyName: { type: "string" },
    website: { type: "string" },
    streetAddress: { type: "string" },
    streetAddress2: { type: "string" },
    city: { type: "string" },
    stateRegion: { type: "string" },
    zip: { type: "string" },
    country: { type: "string" },
    visibleText: { type: "string" },
    confidence: { type: "number" }
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: fields,
    required: Object.keys(fields)
  };
}

export function resolveSignatureOcrConfig(config = {}) {
  const apiKey = firstNonEmpty(config.apiKey, process.env.OPENAI_SIGNATURE_OCR_API_KEY, process.env.OPENAI_API_KEY);
  const enabled = config.enabled ?? Boolean(apiKey);
  const timeoutMs = Number.parseInt(String(firstNonEmpty(config.timeoutMs, process.env.OPENAI_SIGNATURE_OCR_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)), 10) || DEFAULT_TIMEOUT_MS;

  return {
    enabled: Boolean(enabled && apiKey),
    apiKey,
    endpoint: firstNonEmpty(config.endpoint, process.env.OPENAI_RESPONSES_ENDPOINT, "https://api.openai.com/v1/responses"),
    model: firstNonEmpty(config.model, process.env.OPENAI_SIGNATURE_OCR_MODEL, process.env.OPENAI_BUSINESS_CARD_MODEL, process.env.OPENAI_MODEL, DEFAULT_MODEL),
    timeoutMs,
    maxImageBytes: Number.parseInt(String(firstNonEmpty(config.maxImageBytes, process.env.GMAIL_SIGNATURE_OCR_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES)), 10) || DEFAULT_MAX_IMAGE_BYTES,
    maxImagesPerThread: Number.parseInt(String(firstNonEmpty(config.maxImagesPerThread, process.env.GMAIL_SIGNATURE_OCR_MAX_IMAGES_PER_THREAD, DEFAULT_MAX_IMAGES_PER_THREAD)), 10) || DEFAULT_MAX_IMAGES_PER_THREAD
  };
}

export async function extractSignatureImageWithAi({
  imageDataUrl = "",
  filename = "",
  sender = {},
  subject = "",
  config = {},
  fetchImpl = fetch
} = {}) {
  const resolved = resolveSignatureOcrConfig(config);

  if (!resolved.enabled || !imageDataUrl) {
    return {
      ok: false,
      code: "OPENAI_NOT_CONFIGURED",
      message: "OpenAI signature OCR is not configured."
    };
  }

  const controller = typeof AbortController === "function" && resolved.timeoutMs > 0
    ? new AbortController()
    : null;
  const timeout = controller ? setTimeout(() => controller.abort(), resolved.timeoutMs) : null;

  try {
    const response = await fetchImpl(resolved.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${resolved.apiKey}`,
        "content-type": "application/json"
      },
      signal: controller?.signal,
      body: JSON.stringify({
        model: resolved.model,
        store: false,
        instructions: [
          "You are extracting a business email signature image for CRM data entry.",
          "Return only JSON matching the schema.",
          "Extract only visible signature text, plus the sender email/domain supplied as metadata.",
          "Never invent private/internal fields. Leave uncertain fields blank.",
          "Prefer direct labels such as Tel, C.P, Mobile, Fax, title, website, and address."
        ].join("\n"),
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  "Extract contact/company details from this Gmail signature image.",
                  `Filename: ${filename}`,
                  `Sender: ${sender.name || ""} <${sender.email || ""}>`,
                  `Subject: ${subject || ""}`
                ].join("\n")
              },
              {
                type: "input_image",
                image_url: imageDataUrl
              }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "clearedge_gmail_signature_ocr",
            strict: true,
            schema: signatureSchema()
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI signature OCR failed (${response.status}): ${compactWhitespace(errorText).slice(0, 500)}`);
    }

    const data = await response.json();
    const parsed = JSON.parse(responseText(data) || "{}");

    return {
      ok: true,
      fields: normalizeSignatureFields(parsed, { sender, subject }),
      visibleText: compactWhitespace(parsed.visibleText || ""),
      warnings: []
    };
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(`OpenAI signature OCR timed out after ${resolved.timeoutMs}ms.`);
    }

    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function normalizeSignatureFields(input = {}, { sender = {}, subject = "" } = {}) {
  const senderDomain = extractDomain(sender.email || "");
  const website = normalizeWebsite(firstNonEmpty(input.website, input.url, senderDomain ? `https://${senderDomain}` : ""));
  const companyName = compactWhitespace(firstNonEmpty(
    input.companyName,
    input.company,
    input.organization,
    companyNameFromSubject(subject)
  ));

  return {
    personName: compactWhitespace(firstNonEmpty(input.personName, input.name, sender.name)),
    title: compactWhitespace(firstNonEmpty(input.title, input.role)),
    email: compactWhitespace(firstNonEmpty(input.email, sender.email)),
    phone: compactWhitespace(firstNonEmpty(input.phone, input.officePhone, input.phoneNumber)),
    mobilePhone: compactWhitespace(firstNonEmpty(input.mobilePhone, input.mobile)),
    faxPhone: compactWhitespace(firstNonEmpty(input.faxPhone, input.fax)),
    companyName,
    website,
    streetAddress: compactWhitespace(firstNonEmpty(input.streetAddress, input.street1, input.address1)),
    streetAddress2: compactWhitespace(firstNonEmpty(input.streetAddress2, input.street2, input.address2)),
    city: compactWhitespace(input.city),
    stateRegion: compactWhitespace(firstNonEmpty(input.stateRegion, input.state, input.region)),
    zip: compactWhitespace(firstNonEmpty(input.zip, input.postalCode, input.postal)),
    country: compactWhitespace(input.country),
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0))
  };
}

function mergeSignatureFields(base = {}, incoming = {}) {
  const output = { ...base };

  for (const [key, value] of Object.entries(incoming)) {
    const incomingValue = compactWhitespace(value);

    if (!incomingValue) {
      continue;
    }

    const existing = compactWhitespace(output[key]);
    output[key] = !existing || incomingValue.length > existing.length ? incomingValue : existing;
  }

  output.confidence = Math.max(Number(base.confidence || 0), Number(incoming.confidence || 0));
  return output;
}

function isUsefulSignature(fields = {}) {
  return Boolean(
    fields.personName ||
    fields.title ||
    fields.phone ||
    fields.mobilePhone ||
    fields.faxPhone ||
    fields.companyName ||
    fields.streetAddress
  );
}

function isImageAttachment(attachment = {}) {
  const name = compactWhitespace(attachment.filename).toLowerCase();
  const mimeType = compactWhitespace(attachment.mimeType).toLowerCase();

  return mimeType.startsWith("image/") || /\.(?:png|jpe?g|gif|webp)$/i.test(name);
}

function collectInlineImageDataParts(payload = {}, output = []) {
  if (!payload) {
    return output;
  }

  if (payload.parts?.length) {
    for (const part of payload.parts) {
      collectInlineImageDataParts(part, output);
    }
  }

  if ((payload.body?.data || "") && isImageAttachment(payload)) {
    output.push({
      filename: compactWhitespace(payload.filename || "inline-signature-image"),
      mimeType: compactWhitespace(payload.mimeType || "image/png"),
      size: Number(payload.body?.size ?? 0),
      inlineData: payload.body.data
    });
  }

  return output;
}

function attachmentDataUrl(payload = {}, mimeType = "image/png") {
  const raw = payload.data || "";

  if (!raw) {
    return "";
  }

  return `data:${mimeType || "image/png"};base64,${Buffer.from(raw, "base64url").toString("base64")}`;
}

function isInternalSender(sender = {}, internalDomains = []) {
  const domain = extractDomain(sender.email || "");
  return ["clear-edge.net", ...internalDomains].map((item) => String(item || "").toLowerCase()).includes(domain);
}

function signatureSourceKey(fields = {}) {
  return (fields.email || `${fields.personName}|${fields.companyName}`).toLowerCase();
}

export async function extractGmailSignaturesFromThread(thread = {}, {
  attachments = [],
  gmailConfig = {},
  signatureConfig = {},
  fetchAttachmentDataImpl = fetchGmailAttachmentData,
  fetchImpl = fetch
} = {}) {
  const resolvedOcr = resolveSignatureOcrConfig(signatureConfig);
  const internalDomains = signatureConfig.internalDomains ?? [];
  const signatures = [];
  const warnings = [];
  let ocrCount = 0;

  for (const message of thread.messages ?? []) {
    const sender = parseAddressHeader(getHeaderValue(message, "from"));

    if (!sender.email || isInternalSender(sender, internalDomains)) {
      continue;
    }

    const subject = getHeaderValue(message, "subject");
    let fields = {};
    let messageOcrUsed = false;
    const textSignature = signatureBlockFromText(messageText(message));
    const parsedText = textSignature ? parseSignatureText(textSignature, { sender, subject }) : {};

    if (isUsefulSignature(parsedText)) {
      fields = mergeSignatureFields(fields, parsedText);
    }

    const inlineImageParts = collectInlineImageDataParts(message.payload);
    const imageAttachments = [
      ...attachments.filter((attachment) => attachment.messageId === message.id),
      ...inlineImageParts
    ]
      .filter((attachment) => (attachment.attachmentId || attachment.inlineData) && isImageAttachment(attachment))
      .filter((attachment) => !attachment.size || attachment.size <= resolvedOcr.maxImageBytes)
      .slice(0, Math.max(0, resolvedOcr.maxImagesPerThread - ocrCount));

    for (const attachment of imageAttachments) {
      if (!resolvedOcr.enabled) {
        continue;
      }

      try {
        const payload = attachment.inlineData
          ? { data: attachment.inlineData }
          : await fetchAttachmentDataImpl({
              messageId: attachment.messageId,
              attachmentId: attachment.attachmentId,
              config: gmailConfig
            });
        const ocr = await extractSignatureImageWithAi({
          imageDataUrl: attachmentDataUrl(payload, attachment.mimeType),
          filename: attachment.filename,
          sender,
          subject,
          config: resolvedOcr,
          fetchImpl
        });
        ocrCount += 1;

        if (ocr.ok && isUsefulSignature(ocr.fields)) {
          fields = mergeSignatureFields(fields, ocr.fields);
          messageOcrUsed = true;
        }
      } catch (error) {
        warnings.push(`Signature OCR failed for ${attachment.filename || attachment.attachmentId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    fields = normalizeSignatureFields(fields, { sender, subject });

    if (!isUsefulSignature(fields)) {
      continue;
    }

    signatures.push({
      ...fields,
      source: "gmail_signature",
      sourceMessageId: message.id,
      sourceThreadId: thread.id || message.threadId || "",
      sourceSender: sender.email,
      sourceMethods: [
        textSignature && isUsefulSignature(parsedText) ? "text_signature" : "",
        messageOcrUsed ? "image_ocr" : ""
      ].filter(Boolean)
    });
  }

  const deduped = [];
  const seen = new Set();

  for (const signature of signatures) {
    const key = signatureSourceKey(signature);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(signature);
  }

  return {
    signatures: deduped,
    warnings
  };
}
