import { compactWhitespace, normalizeText, uniqueStrings } from "./normalize.mjs";

function countMatches(text = "", pattern) {
  return (text.match(pattern) ?? []).length;
}

function detectKnownChemicalTerms(text = "", knownChemicalTerms = []) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return [];
  }

  return uniqueStrings(
    knownChemicalTerms
      .filter((term) => normalizeText(term).length >= 4)
      .filter((term) => normalized.includes(normalizeText(term)))
  ).slice(0, 4);
}

export function detectWorkflow(text = "", context = {}) {
  const raw = String(text);
  const value = compactWhitespace(raw);
  const lower = value.toLowerCase();

  if (!value) {
    return {
      workflow: "call_report",
      confidence: 0,
      signals: ["empty input"]
    };
  }

  const signals = [];
  const scores = {
    call_report: 0,
    email_thread: 0,
    new_product: 0,
    new_customer: 0,
    new_contact: 0,
    new_location: 0
  };

  const hasSds = /^\s*safety data sheet\b/im.test(raw) || /\bsds\b/i.test(value);
  const hasTds = /^\s*technical data sheet\b/im.test(raw) || /\btds\b/i.test(value);
  const hasHazmat = /\bcas\b|\bun\/na\b|\bghs\b|\bpacking group\b|\bhazard class\b/i.test(value);
  const hasAddress = /\b\d{5}(?:-\d{4})?\b/.test(value) && /\b[A-Z]{2}\b/.test(value);
  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value);
  const hasPhone = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s./-]?)\d{3}[\s./-]?\d{4}/.test(value);
  const hasWebsite = /\b(?:https?:\/\/|www\.)[^\s]+/i.test(value);
  const hasSpeakerLabels = countMatches(raw, /(^|\n)\s*[A-Z][A-Za-z.' -]{1,40}:/g) >= 2;
  const hasTranscriptWords = /\btranscript\b|\bmeeting\b|\bcall\b|\bspoke\b|\bfollow up\b|\bnext steps?\b/i.test(
    value
  );
  const hasEmailHeaders =
    countMatches(raw, /(^|\n)\s*(from|to|cc|bcc|subject|sent|date):/gi) >= 2 || /^on .+ wrote:$/im.test(raw);
  const hasManyLines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean).length >= 6;
  const knownChemicalTerms = detectKnownChemicalTerms(raw, context.knownChemicalTerms ?? []);

  if (hasSds || hasTds || hasHazmat) {
    scores.new_product += 4;
    signals.push("document keywords");
  }

  if (knownChemicalTerms.length) {
    scores.new_product += 1.5;
    scores.call_report += 0.6;
    scores.email_thread += 0.6;
    signals.push(`known chemical terms: ${knownChemicalTerms.join(", ")}`);
  }

  if (hasTranscriptWords) {
    scores.call_report += 2.5;
    signals.push("conversation keywords");
  }

  if (hasSpeakerLabels || hasManyLines) {
    scores.call_report += 2;
    signals.push("multi-line conversational structure");
  }

  if (hasEmailHeaders) {
    scores.email_thread += 5;
    scores.call_report += 0.75;
    signals.push("email thread structure");
  }

  if (hasAddress) {
    scores.new_location += 2.5;
    scores.new_customer += 1;
    signals.push("address structure");
  }

  if (hasEmail && hasPhone) {
    scores.new_contact += 2;
    scores.new_customer += 1;
    signals.push("contact information");
  }

  if (hasWebsite) {
    scores.new_customer += 1.5;
    scores.new_contact += 0.75;
    signals.push("website");
  }

  if (/\btitle\b|\brole\b|\bmobile\b|\bfax\b|\boffice\b/i.test(lower)) {
    scores.new_contact += 1.5;
    signals.push("contact labels");
  }

  if (/\bcustomer\b|\bcompany\b|\bcredit limit\b|\bpayment term\b|\bprospect\b/i.test(lower)) {
    scores.new_customer += 1.5;
    signals.push("customer labels");
  }

  if (/\bshipping\b|\bwarehouse\b|\bship to\b|\bdelivery\b/i.test(lower)) {
    scores.new_location += 1.5;
    signals.push("location labels");
  }

  const ordered = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const [workflow, score] = ordered[0];
  const nextScore = ordered[1]?.[1] ?? 0;
  const confidence = Math.max(0, Math.min(1, score / Math.max(4, score + nextScore)));

  return {
    workflow,
    confidence,
    signals
  };
}
