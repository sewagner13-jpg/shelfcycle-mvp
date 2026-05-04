import { compactWhitespace, uniqueStrings } from "./normalize.mjs";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s./-]?)\d{3}[\s./-]?\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?/gi;

function parseCityStateZip(text = "") {
  const match =
    text.match(/([A-Za-z .'-]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/) ??
    text.match(/([A-Za-z .'-]+)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);

  if (!match) {
    return {
      city: "",
      state: "",
      zip: ""
    };
  }

  return {
    city: compactWhitespace(match[1]),
    state: compactWhitespace(match[2]),
    zip: compactWhitespace(match[3])
  };
}

export function parseLocationInput(text = "") {
  const lines = text
    .split(/\n+/)
    .map((line) => compactWhitespace(line))
    .filter(Boolean);

  const emails = uniqueStrings(text.match(EMAIL_RE) ?? []);
  const phones = uniqueStrings(text.match(PHONE_RE) ?? []);
  const addressLine = lines.find((line) => /^\d+\s+/.test(line)) ?? "";
  const street2Line = lines.find((line) => /\b(suite|ste|unit|building|warehouse|dock)\b/i.test(line)) ?? "";
  const cityStateZipSource = lines.find((line) => /\b[A-Z]{2}\b/.test(line) && /\d{5}/.test(line)) ?? "";
  const cityStateZip = parseCityStateZip(cityStateZipSource);
  const country = lines.find((line) => /\b(us|usa|united states|canada|mexico)\b/i.test(line)) ?? "";
  const name = lines.find((line) => !/^\d+\s+/.test(line) && !line.includes("@") && !/\d{5}/.test(line)) ?? "";

  return {
    workflow: "new_location",
    fields: {
      name,
      email: emails[0] ?? "",
      phone: phones[0] ?? "",
      street1: addressLine,
      street2: street2Line && street2Line !== addressLine ? street2Line : "",
      city: cityStateZip.city,
      state: cityStateZip.state,
      zip: cityStateZip.zip,
      country,
      shippingInstructions: lines.find((line) => /\bship|delivery|receiving|dock|instructions\b/i.test(line)) ?? ""
    },
    rawExtracts: {
      emails,
      phones,
      lines: lines.slice(0, 25)
    }
  };
}
