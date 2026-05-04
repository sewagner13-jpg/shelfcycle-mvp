import {
  compactWhitespace,
  extractDomain,
  isLikelyCompanyName,
  isLikelyPersonName,
  uniqueStrings
} from "./normalize.mjs";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s./-]?)\d{3}[\s./-]?\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s)]+/gi;

function stripLabel(line = "") {
  return compactWhitespace(line.replace(/^[A-Za-z /_-]{2,30}:\s*/, ""));
}

export function parseContactInput(text = "") {
  const lines = text
    .split(/\n+/)
    .map((line) => compactWhitespace(line))
    .filter(Boolean);

  const emails = uniqueStrings(text.match(EMAIL_RE) ?? []);
  const phones = uniqueStrings(text.match(PHONE_RE) ?? []);
  const websites = uniqueStrings(text.match(URL_RE) ?? []);

  let name = "";
  let title = "";
  let companyName = "";

  for (const line of lines) {
    if (!name && isLikelyPersonName(stripLabel(line))) {
      name = stripLabel(line);
      continue;
    }

    if (!companyName && isLikelyCompanyName(stripLabel(line))) {
      companyName = stripLabel(line);
      continue;
    }

    if (!title && /\b(manager|director|purchasing|buyer|sales|chemist|r&d|operations|compliance|owner|president|csr)\b/i.test(line)) {
      title = stripLabel(line);
    }
  }

  if (!companyName && emails.length) {
    const domain = extractDomain(emails[0]).replace(/^www\./, "");

    if (domain) {
      companyName = domain
        .split(".")[0]
        .split(/[-_]/)
        .map((part) => (part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : part))
        .join(" ");
    }
  }

  return {
    workflow: "new_contact",
    fields: {
      name,
      title,
      email: emails[0] ?? "",
      officePhone: phones[0] ?? "",
      mobilePhone: phones[1] ?? "",
      faxPhone: phones.find((phone) => /fax/i.test(text) && text.includes(phone)) ?? "",
      website: websites[0] ?? "",
      companyName
    },
    rawExtracts: {
      emails,
      phones,
      websites,
      lines: lines.slice(0, 25)
    }
  };
}
