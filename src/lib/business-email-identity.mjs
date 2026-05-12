import { asTitle, compactWhitespace, extractDomain, isLikelyCompanyName } from "./normalize.mjs";

const INFRASTRUCTURE_DOMAINS = new Set([
  "superhuman.com",
  "gmail.com",
  "google.com",
  "googlemail.com",
  "calendar.google.com",
  "outlook.com",
  "office365.com",
  "microsoft.com",
  "icloud.com",
  "me.com",
  "apple.com"
]);

const INFRASTRUCTURE_LOCAL_PARTS = new Set([
  "reminder",
  "noreply",
  "no-reply",
  "notification",
  "notifications",
  "calendar",
  "mailer-daemon",
  "postmaster"
]);

export function participantDomain(entry = {}) {
  return compactWhitespace(entry.domain || extractDomain(entry.email || entry.website || entry.url || ""));
}

export function isInfrastructureParticipant(entry = {}) {
  const email = compactWhitespace(entry.email).toLowerCase();
  const domain = participantDomain(entry).toLowerCase();
  const localPart = email.includes("@") ? email.split("@")[0] : "";
  const name = compactWhitespace(entry.name).toLowerCase();

  return (
    INFRASTRUCTURE_DOMAINS.has(domain) ||
    INFRASTRUCTURE_LOCAL_PARTS.has(localPart) ||
    (name === "reminder" && domain !== "")
  );
}

export function businessExternalParticipants(reviewAction = {}) {
  return (reviewAction.externalParticipants ?? [])
    .filter((entry) => entry?.email || entry?.name || entry?.domain)
    .filter((entry) => !isInfrastructureParticipant(entry));
}

export function dominantBusinessDomain(reviewAction = {}) {
  const counts = new Map();

  for (const participant of businessExternalParticipants(reviewAction)) {
    const domain = participantDomain(participant).toLowerCase();

    if (!domain) {
      continue;
    }

    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "";
}

function companyNameFromDomain(domain = "") {
  const clean = compactWhitespace(domain)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(".")[0]
    .replace(/[-_]+/g, " ");

  return clean ? asTitle(clean) : "";
}

export function companyNameFromSubject(subject = "") {
  const clean = compactWhitespace(subject)
    .replace(/^(?:re|fw|fwd)\s*:\s*/i, "")
    .replace(/\[[^\]]+\]/g, "");
  const parts = clean
    .split(/\s*(?:\/|\||–|—| - )\s*/)
    .map((part) => compactWhitespace(part))
    .filter(Boolean)
    .map((part) => part.replace(/\b(?:follow[\s-]?up|meeting|acs|clear\s*edge|clearedge)\b.*$/i, "").trim())
    .filter(Boolean)
    .filter((part) => !/\bclear\s*edge|clearedge\b/i.test(part));

  return parts.find((part) => isLikelyCompanyName(part)) ?? "";
}

export function preferredExternalParticipant(reviewAction = {}) {
  return businessExternalParticipants(reviewAction)[0] ?? reviewAction.externalParticipants?.[0] ?? {};
}

export function preferredSuggestedContact(reviewAction = {}) {
  const contacts = (reviewAction.suggestedCreates ?? []).filter((item) => item.type === "contact");

  if (reviewAction.workflow === "business_card") {
    return contacts[0] ?? null;
  }

  const businessContacts = contacts.filter((entry) => !isInfrastructureParticipant(entry));
  const domain = dominantBusinessDomain(reviewAction);
  const sameDomain = domain
    ? businessContacts.find((entry) => participantDomain(entry).toLowerCase() === domain)
    : null;

  return sameDomain ?? businessContacts[0] ?? null;
}

export function inferredCompanyName(reviewAction = {}, { relationship = "" } = {}) {
  const domain = dominantBusinessDomain(reviewAction);
  const participant = preferredExternalParticipant(reviewAction);
  const participantCompanyName = isLikelyCompanyName(participant.name) ? participant.name : "";
  const subjectCompanyName = relationship === "supplier" || relationship === "customer"
    ? companyNameFromSubject(reviewAction.subject || reviewAction.fields?.subject || "")
    : "";

  return {
    domain,
    participant,
    participantCompanyName,
    subjectCompanyName,
    domainCompanyName: companyNameFromDomain(domain || participantDomain(participant))
  };
}
