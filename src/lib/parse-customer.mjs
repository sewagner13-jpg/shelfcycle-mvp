import { compactWhitespace, extractDomain, isLikelyCompanyName, uniqueStrings } from "./normalize.mjs";
import { normalizeCustomerCreateFields } from "./shelfcycle-customer-requirements.mjs";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s./-]?)\d{3}[\s./-]?\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s)]+/gi;

export function parseCustomerInput(text = "") {
  const lines = text
    .split(/\n+/)
    .map((line) => compactWhitespace(line))
    .filter(Boolean);

  const emails = uniqueStrings(text.match(EMAIL_RE) ?? []);
  const phones = uniqueStrings(text.match(PHONE_RE) ?? []);
  const websites = uniqueStrings(text.match(URL_RE) ?? []);

  let name = lines.find((line) => isLikelyCompanyName(line)) ?? "";

  if (!name && websites[0]) {
    const domain = extractDomain(websites[0]).replace(/^www\./, "");

    if (domain) {
      name = domain
        .split(".")[0]
        .split(/[-_]/)
        .map((part) => (part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1)}` : part))
        .join(" ");
    }
  }

  const addressBlock = lines.filter((line) => /^\d+\s+/.test(line) || /\d{5}/.test(line)).join(", ");
  const fields = normalizeCustomerCreateFields({
    name,
    email: emails[0] ?? "",
    website: websites[0] ?? "",
    phoneNumber: phones[0] ?? "",
    address: addressBlock,
    prospect: /\bprospect\b/i.test(text)
  });

  return {
    workflow: "new_customer",
    fields,
    rawExtracts: {
      emails,
      phones,
      websites,
      lines: lines.slice(0, 25)
    }
  };
}
