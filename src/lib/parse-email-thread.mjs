import { dedupeObjects, uniqueStrings, compactWhitespace, extractDomain } from "./normalize.mjs";
import { findMentions } from "./match.mjs";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s./-]?)\d{3}[\s./-]?\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?/gi;
const PARTICIPANT_RE =
  /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\s*(?:<|\b)([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;

function extractSubject(text = "") {
  const match = text.match(/^\s*subject:\s*(.+)$/im);
  return compactWhitespace(match?.[1] ?? "");
}

function cleanLine(line = "") {
  return compactWhitespace(line.replace(/^[-*•\d.:\s]+/, ""));
}

function isHeaderLine(line = "") {
  return /^(from|to|cc|bcc|subject|sent|date):/i.test(line) || /^on .+ wrote:$/i.test(line);
}

function isNoiseLine(line = "") {
  return (
    !line ||
    isHeaderLine(line) ||
    /^https?:\/\//i.test(line) ||
    /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(line) ||
    /^\+?\d[\d\s()./-]{7,}$/.test(line) ||
    /^(kind regards|best regards|regards|thank you|thanks|cheers|best)$/i.test(line)
  );
}

function extractParticipants(text = "") {
  const participants = [];
  let match;

  while ((match = PARTICIPANT_RE.exec(text))) {
    const name = compactWhitespace(match[1]);
    const email = compactWhitespace(match[2]);
    const domain = extractDomain(email).replace(/^www\./, "");
    const companyName = domain
      ? domain
          .split(".")[0]
          .split(/[-_]/)
          .map((part) => (part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : part))
          .join(" ")
      : "";

    participants.push({
      name,
      email,
      companyName,
      internal: /@clear-edge\.net$/i.test(email)
    });
  }

  const bareEmails = uniqueStrings(text.match(EMAIL_RE) ?? []);

  for (const email of bareEmails) {
    if (participants.some((participant) => participant.email.toLowerCase() === email.toLowerCase())) {
      continue;
    }

    const domain = extractDomain(email).replace(/^www\./, "");

    participants.push({
      name: "",
      email,
      companyName: domain
        ? domain
            .split(".")[0]
            .split(/[-_]/)
            .map((part) => (part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : part))
            .join(" ")
        : "",
      internal: /@clear-edge\.net$/i.test(email)
    });
  }

  return dedupeObjects(participants, (item) => item.email.toLowerCase());
}

function extractActionItems(lines = []) {
  return lines
    .map(cleanLine)
    .filter(
      (line) =>
        line.length >= 12 &&
        !isNoiseLine(line) &&
        /\b(next step|follow up|follow-up|send|sample|quote|pricing|visit|call|email|ship|order|review|schedule|need to|will|can you|please)\b/i.test(
          line
        )
    )
    .slice(0, 8);
}

function extractKeyPoints(lines = []) {
  return lines
    .map(cleanLine)
    .filter((line) => line.length >= 20 && !isNoiseLine(line))
    .slice(0, 8);
}

function readableList(items = [], fallback = "") {
  const values = items.filter(Boolean);

  if (!values.length) {
    return fallback;
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function formatNarrativeNote({
  subject,
  customerName,
  externalParticipants,
  productMatches,
  keyPoints,
  actionItems
}) {
  const people = readableList(
    externalParticipants.slice(0, 3).map((participant) => participant.name || participant.email),
    "the outside party"
  );
  const products = readableList(productMatches.slice(0, 3), "");
  const firstPoint = keyPoints[0] || "";
  const firstAction = actionItems[0] || "";
  const lines = [];

  lines.push(
    `This email thread with ${people}${customerName ? ` at ${customerName}` : ""}${subject ? ` about "${subject}"` : ""} should be treated as a single business interaction.`
  );

  if (products) {
    lines.push(`Products or technical subjects discussed: ${products}.`);
  }

  if (firstPoint) {
    lines.push(`Main takeaway: ${firstPoint}.`);
  }

  if (firstAction) {
    lines.push(`Recommended next step: ${firstAction}.`);
  } else {
    lines.push("Recommended next step: review the thread and decide whether a ShelfCycle note, contact update, document follow-up, or pricing task is needed.");
  }

  return lines.join(" ");
}

function formatSummary({
  subject,
  customerName,
  externalParticipants,
  productMatches,
  contactMatches,
  keyPoints,
  actionItems
}) {
  const sections = [
    `Thread Summary:\n${formatNarrativeNote({
      subject,
      customerName,
      externalParticipants,
      productMatches,
      keyPoints,
      actionItems
    })}`,
    "Interaction Type: Email"
  ];

  if (subject) {
    sections.push(`Subject: ${subject}`);
  }

  if (customerName) {
    sections.push(`Primary Customer: ${customerName}`);
  }

  if (externalParticipants.length) {
    sections.push(
      `External Participants:\n${externalParticipants
        .map((participant) => `- ${participant.name || participant.email}`)
        .join("\n")}`
    );
  }

  if (productMatches.length) {
    sections.push(`Products Discussed:\n${productMatches.map((item) => `- ${item}`).join("\n")}`);
  }

  if (contactMatches.length) {
    sections.push(`Matched Contacts:\n${contactMatches.map((item) => `- ${item}`).join("\n")}`);
  }

  if (keyPoints.length) {
    sections.push(`Key Points:\n${keyPoints.map((item) => `- ${item}`).join("\n")}`);
  }

  if (actionItems.length) {
    sections.push(`Next Steps:\n${actionItems.map((item) => `- ${item}`).join("\n")}`);
  }

  return sections.join("\n\n");
}

export function parseEmailThread(text = "", referenceData = {}) {
  const lines = text
    .split(/\n+/)
    .map((line) => compactWhitespace(line))
    .filter(Boolean);
  const subject = extractSubject(text);
  const participants = extractParticipants(text);
  const externalParticipants = participants.filter((participant) => !participant.internal);
  const customerMentions = findMentions(text, referenceData.customers, ["name", "website", "email", "phone"], {
    minScore: 0.62,
    limit: 3
  });
  const contactMentions = findMentions(
    text,
    referenceData.contacts,
    ["name", "companyName", "email", "officePhone", "mobilePhone", "faxPhone"],
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
  const topContacts = contactMentions.slice(0, 5).map((match) => match.candidate);
  const topProducts = productMentions.slice(0, 5).map((match) => match.candidate);
  const keyPoints = extractKeyPoints(lines);
  const actionItems = extractActionItems(lines);
  const emails = uniqueStrings(text.match(EMAIL_RE) ?? []);
  const phones = uniqueStrings(text.match(PHONE_RE) ?? []);
  const unmatchedParticipants = externalParticipants.filter(
    (participant) => !contactMentions.some((entry) => entry.candidate?.email?.toLowerCase() === participant.email.toLowerCase())
  );
  const draftDate = new Date().toISOString().slice(0, 10);
  const title = `${draftDate} - ${subject || "Email follow-up"}`;

  return {
    workflow: "email_thread",
    fields: {
      customerName: topCustomer?.name ?? "",
      interactionType: "Email",
      subject,
      title,
      date: draftDate
    },
    matches: {
      customer: customerMentions,
      contacts: contactMentions,
      products: productMentions
    },
    suggestedCreates: dedupeObjects(
      unmatchedParticipants.map((participant) => ({
        type: "contact",
        name: participant.name,
        email: participant.email,
        companyName: participant.companyName
      })),
      (item) => item.email.toLowerCase()
    ),
    draftNote: {
      type: "Email",
      title,
      customerName: topCustomer?.name ?? "",
      summary: formatSummary({
        subject,
        customerName: topCustomer?.name ?? "",
        externalParticipants,
        productMatches: topProducts.map((product) => product.name || product.code).filter(Boolean),
        contactMatches: topContacts.map((contact) => contact.name).filter(Boolean),
        keyPoints,
        actionItems
      })
    },
    rawExtracts: {
      lines: lines.slice(0, 60),
      emails,
      phones,
      participants,
      keyPoints,
      actionItems
    }
  };
}
