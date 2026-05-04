const WHITESPACE_RE = /\s+/g;
const PUNCT_STRIP_RE = /[^a-z0-9\s]/gi;

export function compactWhitespace(value = "") {
  return String(value).replace(WHITESPACE_RE, " ").trim();
}

export function normalizeText(value = "") {
  return compactWhitespace(String(value).toLowerCase().replace(PUNCT_STRIP_RE, " "));
}

export function tokenize(value = "") {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

export function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => compactWhitespace(value)).filter(Boolean))];
}

export function normalizePhone(value = "") {
  const digits = String(value).replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  return digits;
}

export function normalizeUrl(value = "") {
  const trimmed = compactWhitespace(value);

  if (!trimmed) {
    return "";
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    const cleanPath = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.hostname.toLowerCase()}${cleanPath}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

export function extractDomain(value = "") {
  const normalized = normalizeUrl(value);
  return normalized.split("/")[0] ?? "";
}

export function firstNonEmpty(...values) {
  return values.find((value) => compactWhitespace(value)) ?? "";
}

export function isLikelyCompanyName(value = "") {
  const text = compactWhitespace(value);

  if (!text) {
    return false;
  }

  return /\b(inc|llc|corp|corporation|coatings|chemical|chemicals|technologies|solutions|systems|group|company|materials|industries|labs|laboratories)\b/i.test(
    text
  );
}

export function isLikelyPersonName(value = "") {
  const text = compactWhitespace(value);

  if (!text || text.length > 60 || /\d/.test(text)) {
    return false;
  }

  const parts = text.split(/\s+/).filter(Boolean);

  if (parts.length < 2 || parts.length > 4) {
    return false;
  }

  return parts.every((part) => /^[A-Z][a-z'".-]+$/.test(part));
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function dedupeObjects(items = [], keyFn = (item) => JSON.stringify(item)) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const key = keyFn(item);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(item);
  }

  return output;
}

export function asTitle(value = "") {
  return compactWhitespace(value)
    .split(" ")
    .map((part) => {
      if (!part) {
        return part;
      }

      return `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

export function sortByScore(items = []) {
  return [...items].sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}
