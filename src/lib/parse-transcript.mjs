import { findMentions, matchEntity } from "./match.mjs";
import { compactWhitespace, dedupeObjects, uniqueStrings } from "./normalize.mjs";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s./-]?)\d{3}[\s./-]?\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?/gi;

function cleanSentence(line = "") {
  return compactWhitespace(line.replace(/^[-*•\d.:\s]+/, ""));
}

function detectInteractionType(text = "") {
  if (/\bvisit\b|\bon site\b/i.test(text)) {
    return "Visit";
  }

  if (/\bmeeting\b/i.test(text)) {
    return "Meeting";
  }

  if (/\bemail\b/i.test(text)) {
    return "Email";
  }

  if (/\bopportunity\b|\bquote\b|\bpricing\b/i.test(text)) {
    return "Opportunity";
  }

  return "Call";
}

function extractActionItems(lines = []) {
  return lines
    .map(cleanSentence)
    .filter((line) =>
      /\b(next step|follow up|follow-up|send|sample|quote|pricing|visit|call|email|ship|order|introduce|review|schedule|need to|will)\b/i.test(
        line
      )
    )
    .slice(0, 8);
}

function extractKeyPoints(lines = []) {
  return lines
    .map(cleanSentence)
    .filter((line) => line.length >= 20)
    .slice(0, 8);
}

function formatSummary({ interactionType, customerName, productMatches, contactMatches, keyPoints, actionItems }) {
  const sections = [];
  sections.push(`Interaction Type: ${interactionType}`);

  if (customerName) {
    sections.push(`Primary Customer: ${customerName}`);
  }

  if (productMatches.length) {
    sections.push(`Products Discussed:\n${productMatches.map((item) => `- ${item}`).join("\n")}`);
  }

  if (contactMatches.length) {
    sections.push(`Contacts Mentioned:\n${contactMatches.map((item) => `- ${item}`).join("\n")}`);
  }

  if (keyPoints.length) {
    sections.push(`Key Points:\n${keyPoints.map((item) => `- ${item}`).join("\n")}`);
  }

  if (actionItems.length) {
    sections.push(`Next Steps:\n${actionItems.map((item) => `- ${item}`).join("\n")}`);
  }

  return sections.join("\n\n");
}

export function parseTranscript(text = "", referenceData = {}) {
  const lines = text
    .split(/\n+/)
    .map((line) => compactWhitespace(line))
    .filter(Boolean);

  const interactionType = detectInteractionType(text);
  const customerMentions = findMentions(text, referenceData.customers, ["name", "website", "email"], {
    minScore: 0.62,
    limit: 3
  });
  const contactMentions = findMentions(
    text,
    referenceData.contacts,
    ["name", "companyName", "email", "title"],
    {
      minScore: 0.56,
      limit: 6
    }
  );
  const productMentions = findMentions(text, referenceData.products, ["code", "name", "family", "synonyms"], {
    minScore: 0.56,
    limit: 10
  });

  const topCustomer = customerMentions[0]?.candidate ?? null;
  const topProducts = productMentions.slice(0, 5).map((match) => match.candidate);
  const topContacts = contactMentions.slice(0, 5).map((match) => match.candidate);

  const actionItems = extractActionItems(lines);
  const keyPoints = extractKeyPoints(lines);
  const emails = uniqueStrings(text.match(EMAIL_RE) ?? []);
  const phones = uniqueStrings(text.match(PHONE_RE) ?? []);

  const unmatchedEmails = emails.filter(
    (email) => !contactMentions.some((entry) => entry.candidate?.email?.toLowerCase() === email.toLowerCase())
  );

  const draftDate = new Date().toISOString().slice(0, 10);
  const titleSuffix =
    topProducts.length === 1
      ? topProducts[0].name || topProducts[0].code
      : topProducts.length > 1
        ? `${topProducts.length} products discussed`
        : interactionType;
  const title = `${draftDate} - ${titleSuffix}`;

  return {
    workflow: "call_report",
    fields: {
      customerName: topCustomer?.name ?? "",
      interactionType,
      title,
      date: draftDate
    },
    matches: {
      customer: customerMentions,
      contacts: contactMentions,
      products: productMentions
    },
    suggestedCreates: dedupeObjects(
      unmatchedEmails.map((email) => ({
        type: "contact",
        email
      })),
      (item) => `${item.type}:${item.email}`
    ),
    draftNote: {
      type: interactionType,
      title,
      customerName: topCustomer?.name ?? "",
      summary: formatSummary({
        interactionType,
        customerName: topCustomer?.name ?? "",
        productMatches: topProducts.map((product) => product.name || product.code).filter(Boolean),
        contactMatches: topContacts.map((contact) => contact.name).filter(Boolean),
        keyPoints,
        actionItems
      })
    },
    rawExtracts: {
      lines: lines.slice(0, 50),
      emails,
      phones,
      keyPoints,
      actionItems
    }
  };
}
