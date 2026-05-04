import {
  compactWhitespace,
  extractDomain,
  normalizePhone,
  normalizeText,
  safeArray,
  sortByScore,
  tokenize,
  uniqueStrings
} from "./normalize.mjs";

function levenshteinDistance(left = "", right = "") {
  const a = normalizeText(left);
  const b = normalizeText(right);

  if (!a) {
    return b.length;
  }

  if (!b) {
    return a.length;
  }

  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));

  for (let row = 0; row <= a.length; row += 1) {
    matrix[row][0] = row;
  }

  for (let column = 0; column <= b.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;

      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function editSimilarity(left = "", right = "") {
  const a = normalizeText(left);
  const b = normalizeText(right);

  if (!a && !b) {
    return 1;
  }

  if (!a || !b) {
    return 0;
  }

  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  return Math.max(0, 1 - distance / maxLength);
}

function tokenOverlap(left = "", right = "") {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let overlap = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function stringIncludesEither(left = "", right = "") {
  const a = normalizeText(left);
  const b = normalizeText(right);

  if (!a || !b) {
    return false;
  }

  return a.includes(b) || b.includes(a);
}

function toSearchStrings(candidate, fields = []) {
  return uniqueStrings(
    fields
      .flatMap((field) => {
        const value = typeof field === "function" ? field(candidate) : candidate?.[field];
        return Array.isArray(value) ? value : [value];
      })
      .map((value) => compactWhitespace(value))
  );
}

function domainScore(query = "", candidates = []) {
  const queryDomains = uniqueStrings(
    [extractDomain(query), ...String(query).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []]
      .map((value) => extractDomain(value))
      .filter(Boolean)
  );

  if (!queryDomains.length) {
    return 0;
  }

  for (const candidateValue of candidates) {
    const domain = extractDomain(candidateValue);

    if (domain && queryDomains.includes(domain)) {
      return 1;
    }
  }

  return 0;
}

function phoneScore(query = "", candidates = []) {
  const queryPhones = uniqueStrings(
    (String(query).match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s./-]?)\d{3}[\s./-]?\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?/gi) ?? [])
      .map((value) => normalizePhone(value))
      .filter(Boolean)
  );

  if (!queryPhones.length) {
    return 0;
  }

  for (const candidateValue of candidates) {
    const phone = normalizePhone(candidateValue);

    if (phone && queryPhones.includes(phone)) {
      return 1;
    }
  }

  return 0;
}

export function scoreCandidate(query = "", candidate, fields = []) {
  const searchStrings = toSearchStrings(candidate, fields);

  if (!compactWhitespace(query) || !searchStrings.length) {
    return 0;
  }

  let bestScore = 0;

  for (const searchString of searchStrings) {
    const overlap = tokenOverlap(query, searchString);
    const edit = editSimilarity(query, searchString);
    const inclusion = stringIncludesEither(query, searchString) ? 1 : 0;
    const score = Math.max(inclusion, overlap * 0.85, edit * 0.75);
    bestScore = Math.max(bestScore, score);
  }

  const domain = domainScore(query, searchStrings);
  const phone = phoneScore(query, searchStrings);

  return Math.max(bestScore, domain, phone);
}

export function matchEntity(query = "", candidates = [], fields = [], options = {}) {
  const minScore = options.minScore ?? 0.42;
  const limit = options.limit ?? 5;

  return sortByScore(
    safeArray(candidates)
      .map((candidate) => ({
        candidate,
        score: scoreCandidate(query, candidate, fields)
      }))
      .filter((entry) => entry.score >= minScore)
  ).slice(0, limit);
}

export function findMentions(text = "", candidates = [], fields = [], options = {}) {
  const normalizedText = normalizeText(text);
  const minScore = options.minScore ?? 0.54;
  const limit = options.limit ?? 10;
  const results = [];

  for (const candidate of safeArray(candidates)) {
    const searchStrings = toSearchStrings(candidate, fields);
    let bestScore = 0;
    let matchedField = "";

    for (const searchString of searchStrings) {
      const normalizedField = normalizeText(searchString);

      if (!normalizedField) {
        continue;
      }

      let score = 0;

      if (normalizedText.includes(normalizedField)) {
        score = 1;
      } else {
        const overlap = tokenOverlap(text, searchString);
        const edit = editSimilarity(text, searchString);
        const domain = domainScore(text, [searchString]);
        const phone = phoneScore(text, [searchString]);
        score = Math.max(overlap * 0.9, edit * 0.55, domain, phone);
      }

      if (score > bestScore) {
        bestScore = score;
        matchedField = searchString;
      }
    }

    if (bestScore >= minScore) {
      results.push({
        candidate,
        score: bestScore,
        matchedField
      });
    }
  }

  return sortByScore(results).slice(0, limit);
}
