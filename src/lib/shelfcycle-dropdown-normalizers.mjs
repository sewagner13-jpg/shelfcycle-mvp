export { SHELFCYCLE_PRODUCT_CODE_DROPDOWNS } from "./shelfcycle-field-map.mjs";

export function splitOptionValues(value = "") {
  return [...new Set((Array.isArray(value) ? value : String(value || "").split(/[,;\n|]+/))
    .map((item) => String(item || "").trim())
    .filter(Boolean))];
}

export function normalizeDropdownMatchText(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\bco\.\s*,?\s*ltd\.?\b/gi, "co ltd")
    .replace(/\bco\.\b/gi, "co")
    .replace(/\bltd\.\b/gi, "ltd")
    .replace(/\binc\.\b/gi, "inc")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const KNOWN_DROPDOWN_ALIASES = Object.freeze([
  {
    canonical: "Winbond Materials Co., Ltd. | Winbond Hardeners Co.,Ltd.",
    aliases: [
      "Winbond Materials Co., Ltd.",
      "WINBOND MATERIALS CO., LTD.",
      "Winbond Materials Co.,Ltd.",
      "Winbond Hardeners Co.,Ltd.",
      "Winbond Hardeners Co., Ltd."
    ]
  }
]);

export function normalizeLegalEntityPunctuation(value = "") {
  return String(value || "")
    .replace(/\bCo\.?\s*,?\s*Ltd\.?/gi, "Co., Ltd.")
    .replace(/\bLtd\.?/gi, "Ltd.")
    .replace(/\bInc\.?/gi, "Inc.")
    .replace(/\s+\|/g, " |")
    .replace(/\|\s+/g, "| ")
    .replace(/\s+/g, " ")
    .trim();
}

function knownDropdownAliasEntry(value = "") {
  const normalized = normalizeDropdownMatchText(value);

  if (!normalized) {
    return null;
  }

  return KNOWN_DROPDOWN_ALIASES.find((entry) => [
    entry.canonical,
    ...(entry.aliases ?? [])
  ].some((candidate) => normalizeDropdownMatchText(candidate) === normalized)) ?? null;
}

export function dropdownValueCandidates(value = "", extraAliases = []) {
  const rawValues = [
    value,
    normalizeLegalEntityPunctuation(value),
    ...splitOptionValues(value),
    ...extraAliases
  ];
  const known = knownDropdownAliasEntry(value);

  if (known) {
    rawValues.push(known.canonical, ...(known.aliases ?? []));
  }

  return [...new Map(rawValues
    .map((candidate) => normalizeLegalEntityPunctuation(candidate))
    .filter(Boolean)
    .map((candidate) => [normalizeDropdownMatchText(candidate), candidate])).values()];
}

export function normalizeKnownDropdownValue(value = "") {
  const known = knownDropdownAliasEntry(value);

  if (known) {
    return normalizeLegalEntityPunctuation(known.aliases?.[0] || known.canonical);
  }

  return normalizeLegalEntityPunctuation(value);
}

function dropdownOptionParts(optionText = "") {
  return [
    String(optionText || ""),
    ...String(optionText || "").split(/[|;\n]+/),
    ...String(optionText || "").split(/[|;\n]+/).map((part) => part.replace(/^[^:]{1,30}:\s*/, ""))
  ]
    .map((part) => part.trim())
    .filter(Boolean);
}

export function dropdownOptionMatchScore({ value = "", optionText = "", disambiguator = "", allowContains = true } = {}) {
  const needle = normalizeDropdownMatchText(value);
  const option = normalizeDropdownMatchText(optionText);
  const disambiguationNeedle = normalizeDropdownMatchText(disambiguator);

  if (!needle || !option) {
    return 0;
  }

  const parts = dropdownOptionParts(optionText).map(normalizeDropdownMatchText).filter(Boolean);
  const partMatches = parts.some((part) => part === needle);
  const partStarts = parts.some((part) => part.startsWith(`${needle} `));
  const optionContains = option.includes(needle);
  const needleTokens = needle.split(" ").filter((token) => token.length > 1);
  const optionTokens = new Set(option.split(" ").filter(Boolean));
  const tokenCoverage = needleTokens.length >= 2 && needleTokens.every((token) => optionTokens.has(token));

  let score = 0;

  if (option === needle) {
    score = 100;
  } else if (partMatches) {
    score = 96;
  } else if (partStarts) {
    score = 92;
  } else if (allowContains && optionContains) {
    score = 88;
  } else if (allowContains && tokenCoverage) {
    score = 82;
  }

  if (score && disambiguationNeedle && option.includes(disambiguationNeedle)) {
    score += 4;
  }

  return score;
}

export function bestDropdownOptionMatch({ value = "", options = [], disambiguator = "", allowContains = true, minScore = 82 } = {}) {
  const candidates = dropdownValueCandidates(value);
  const scored = (options ?? [])
    .map((optionText) => {
      const score = Math.max(0, ...candidates.map((candidate) => dropdownOptionMatchScore({
        value: candidate,
        optionText,
        disambiguator,
        allowContains
      })));

      return {
        optionText: String(optionText || "").trim(),
        score
      };
    })
    .filter((item) => item.optionText && item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.optionText.length - b.optionText.length);

  return scored[0] ?? null;
}

export function dropdownSelectionMatches({ expected = "", actual = "", disambiguator = "", allowContains = true, minScore = 82 } = {}) {
  if (!expected || !actual) {
    return false;
  }

  return dropdownValueCandidates(expected).some((candidate) => dropdownOptionMatchScore({
    value: candidate,
    optionText: actual,
    disambiguator,
    allowContains
  }) >= minScore);
}

export function isUnavailableTransportValue(value = "") {
  return /\b(not\s+available|unavailable|unknown|missing|not\s+provided|not\s+listed|tbd|to\s+be\s+determined|review)\b/i.test(String(value || ""));
}

export function isNonRegulatedTransportValue(value = "") {
  const text = String(value || "").trim();

  if (!text || isUnavailableTransportValue(text)) {
    return false;
  }

  return /\b(non[-\s]*haz|non[-\s]*hazardous|not\s+regulated|not\s+applicable|not\s+restricted|not\s+subject|not\s+dangerous|not\s+classified|not\s+assigned|no\s+un|none)\b/i.test(text);
}

export function normalizeUnNumberDropdownValue(value = "") {
  const text = String(value ?? "").trim();
  const unMatch = text.match(/\b(UN|NA)\s*-?\s*(\d{4})\b/i);

  if (unMatch) {
    return `${unMatch[1].toUpperCase()}${unMatch[2]}`;
  }

  if (isNonRegulatedTransportValue(text)) {
    return "NON-HAZ / NOT REGULATED";
  }

  return isUnavailableTransportValue(text) ? "" : text;
}

export function normalizePackingGroupDropdownValue(value = "", context = {}) {
  const text = String(value ?? "").trim();
  const contextValues = [
    text,
    context.unNumber,
    context.hazardClass,
    context.properShippingName,
    context.specialDesignation
  ].filter(Boolean).join(" ");
  const normalized = text.toLowerCase();

  if (!text && !isNonRegulatedTransportValue(contextValues)) {
    return "";
  }

  if (isNonRegulatedTransportValue(contextValues)) {
    return "NOT REGULATED";
  }

  if (/\b(iii|3)\b/i.test(normalized) || /\blow\s+danger\b/i.test(normalized)) {
    return "III - Low danger";
  }

  if (/\b(ii|2)\b/i.test(normalized) || /\bmedium\s+danger\b/i.test(normalized)) {
    return "II - Medium danger";
  }

  if (/\b(i|1)\b/i.test(normalized) || /\bhigh\s+danger\b/i.test(normalized)) {
    return "I - High danger";
  }

  return isUnavailableTransportValue(text) ? "" : text;
}

export function normalizeHazardClassDropdownValues(value = "") {
  const values = splitOptionValues(value);
  const mapped = values.flatMap((entry) => {
    const text = String(entry || "").trim();

    if (!text || isUnavailableTransportValue(text) || isNonRegulatedTransportValue(text)) {
      return [];
    }

    const normalized = text.toLowerCase();
    const matchers = [
      [/^1\b|explosive/i, "1 - Explosives"],
      [/^2\.1\b|flammable\s+gas/i, "2.1 - Flammable Gases"],
      [/^2\.2\b|non[-\s]*flammable.*gas|non[-\s]*toxic\s+gas/i, "2.2 - Non-Flammable, Non-Toxic Gases"],
      [/^2\.3\b|toxic\s+gas/i, "2.3 - Toxic Gases"],
      [/^3\b|flammable\s+liquid/i, "3 - Flammable Liquids"],
      [/^4\.1\b|flammable\s+solid/i, "4.1 - Flammable Solids"],
      [/^4\.2\b|spontaneously\s+combustible/i, "4.2 - Spontaneously Combustible"],
      [/^4\.3\b|dangerous\s+when\s+wet/i, "4.3 - Dangerous When Wet"],
      [/^5\.1\b|oxidizer/i, "5.1 - Oxidizers"],
      [/^5\.2\b|organic\s+peroxide/i, "5.2 - Organic Peroxides"],
      [/^6\.1\b|toxic\s+substance/i, "6.1 - Toxic Substances"],
      [/^6\.2\b|infectious\s+substance/i, "6.2 - Infectious Substances"],
      [/^7\b|radioactive/i, "7 - Radioactive Material"],
      [/^8\b|corrosive/i, "8 - Corrosives"],
      [/^9\b|miscellaneous/i, "9 - Miscellaneous Dangerous Goods"]
    ];
    const match = matchers.find(([pattern]) => pattern.test(normalized));

    return [match?.[1] || text];
  });

  return [...new Set(mapped)];
}

function packageUnitSuffix(context = {}) {
  const unit = normalizeUnitOfMeasureDropdownValue(
    typeof context === "string" ? context : context.unitOfMeasure || context.unit || ""
  );

  return ["kg", "lb", "ea"].includes(unit) ? unit : "";
}

function packageOption(base, unit = "", labels = {}) {
  if (!unit) {
    return base;
  }

  return labels[unit] || `${base} (${unit})`;
}

export function normalizePackagingDropdownValue(value = "", context = {}) {
  const text = String(value ?? "").trim();
  const normalized = text.toLowerCase();
  const unit = packageUnitSuffix(context);

  if (!text) {
    return "";
  }

  if (/\([^)]{1,8}\)/.test(text)) {
    return text;
  }

  if (/\bdrums?\b/.test(normalized)) {
    return packageOption("Drum", unit);
  }

  if (/\bpails?\b/.test(normalized)) {
    return packageOption("Pail", unit);
  }

  if (/\b(totes?|ibc|intermediate bulk)\b/.test(normalized)) {
    return packageOption("Totes", unit);
  }

  if (/\b(bulk|iso\s*tanks?|tankers?)\b/.test(normalized)) {
    return packageOption("ISO Container", unit);
  }

  if (/\bbags?\b/.test(normalized)) {
    return packageOption("Bag", unit, {
      lb: "Bags (lb)"
    });
  }

  if (/\bbox(es)?\b/.test(normalized)) {
    return packageOption("Box", unit);
  }

  return text;
}

export function normalizePackagingTypeDropdownValue(value = "") {
  const text = String(value ?? "").trim();
  const normalized = text.toLowerCase();

  if (!text) {
    return "";
  }

  if (/^var|variable/.test(normalized)) {
    return "Variable";
  }

  if (/^fix|fixed/.test(normalized)) {
    return "Fixed";
  }

  return text;
}

export function normalizeSupplierTypeDropdownValue(value = "") {
  return normalizePackagingTypeDropdownValue(value);
}

export function normalizeUnitOfMeasureDropdownValue(value = "") {
  const text = splitOptionValues(value)[0] || String(value ?? "").trim();
  const normalized = text.toLowerCase();

  if (!text) {
    return "";
  }

  if (/\b(kgs?|kilograms?)\b/i.test(normalized)) {
    return "kg";
  }

  if (/\b(lbs?|pounds?)\b/i.test(normalized)) {
    return "lb";
  }

  if (/\b(each|unit|units|ea)\b/i.test(normalized)) {
    return "ea";
  }

  if (/\b(gallons?|gal)\b/i.test(normalized)) {
    return "gal";
  }

  if (/\b(liters?|litres?|l)\b/i.test(normalized)) {
    return "L";
  }

  return text;
}

export function normalizeShelfCycleProductAutomationFields(fields = {}) {
  const unitOfMeasure = normalizeUnitOfMeasureDropdownValue(fields.unitOfMeasure);
  const normalizedFields = {
    ...fields,
    productFamily: normalizeKnownDropdownValue(fields.productFamily),
    supplier: normalizeKnownDropdownValue(fields.supplier),
    packagingType: normalizePackagingTypeDropdownValue(fields.packagingType),
    packaging: normalizePackagingDropdownValue(fields.packaging, { unitOfMeasure }),
    unitOfMeasure,
    supplierType: normalizeSupplierTypeDropdownValue(fields.supplierType),
    unNumber: normalizeUnNumberDropdownValue(fields.unNumber),
    packingGroup: normalizePackingGroupDropdownValue(fields.packingGroup, fields)
  };
  const hazardClassValues = normalizeHazardClassDropdownValues(fields.hazardClass);

  if (hazardClassValues.length) {
    normalizedFields.hazardClass = hazardClassValues.join(", ");
  }

  return normalizedFields;
}
