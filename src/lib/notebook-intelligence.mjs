import { matchEntity } from "./match.mjs";
import { compactWhitespace, firstNonEmpty, normalizeText, safeArray, uniqueStrings } from "./normalize.mjs";

const MONEY_RE = /\$\s*\d+(?:\.\d+)?(?:\s*\/\s*[A-Z]{1,4})?/gi;

function normalizeStringList(...values) {
  return uniqueStrings(
    values.flatMap((value) => {
      if (Array.isArray(value)) {
        return value;
      }

      if (value && typeof value === "object") {
        return [];
      }

      return [value];
    })
  );
}

function normalizeSpecs(masterSpecs = {}) {
  return {
    casNumber: compactWhitespace(firstNonEmpty(masterSpecs.casNumber, masterSpecs.cas, masterSpecs["cas#"])),
    purity: compactWhitespace(firstNonEmpty(masterSpecs.purity, masterSpecs.assay)),
    flashPoint: compactWhitespace(firstNonEmpty(masterSpecs.flashPoint, masterSpecs["flash point"], masterSpecs.flash_point))
  };
}

function normalizeNotebookEntry(entry = {}) {
  const masterSpecs = normalizeSpecs(entry.masterSpecs ?? entry.master_specs ?? {});
  const entity = compactWhitespace(
    firstNonEmpty(entry.entity, entry.name, entry.productName, entry.primaryChemicalEntity, entry.sku, entry.productCode)
  );
  const aliases = normalizeStringList(
    entity,
    entry.sku,
    entry.productCode,
    entry.casNumber,
    entry.cas,
    entry.aliases,
    entry.productAliases
  );
  const supplierNames = normalizeStringList(entry.supplierNames, entry.suppliers, entry.supplier, entry.supplierName);
  const historicalNotes = normalizeStringList(entry.historicalNotes, entry.notes, entry.tribalKnowledge, entry.summary);
  const logisticsNuances = normalizeStringList(entry.logisticsNuances, entry.logistics, entry.carrierNuances, entry.carrierNuance);
  const commercialBenchmarks = normalizeStringList(
    entry.commercialBenchmarks,
    entry.commercialNotes,
    entry.priceBenchmarks,
    entry.pricingNotes
  );
  const complianceNotes = normalizeStringList(entry.complianceNotes, entry.masterSpecNotes, entry.qualityNotes);
  const customerNames = normalizeStringList(entry.customerNames, entry.customers, entry.customer);
  const lastKnownGoodPrice = compactWhitespace(
    firstNonEmpty(entry.lastKnownGoodPrice, entry.lastKnownPrice, entry.priceBenchmark, entry.last_price)
  );

  return {
    id: compactWhitespace(firstNonEmpty(entry.id, entity)) || entity,
    entity,
    aliases,
    supplierNames,
    customerNames,
    lastKnownGoodPrice,
    masterSpecs,
    historicalNotes,
    logisticsNuances,
    commercialBenchmarks,
    complianceNotes
  };
}

export function normalizeNotebookIntelligence(value = []) {
  const entries = Array.isArray(value) ? value : safeArray(value.entries ?? value.items);

  return entries
    .map(normalizeNotebookEntry)
    .filter((entry) => entry.entity);
}

export function deriveNotebookEntityAliases(entries = []) {
  return uniqueStrings(
    entries.flatMap((entry) => [entry.entity, ...safeArray(entry.aliases), ...safeArray(entry.supplierNames)])
  );
}

function topProductMatch(result = {}) {
  return result.matches?.product?.[0]?.candidate ?? result.matches?.products?.[0]?.candidate ?? null;
}

function detectEntityFromNotebook(text = "", entries = []) {
  return matchEntity(text, entries, ["entity", "aliases", "supplierNames"], {
    minScore: 0.48,
    limit: 1
  })[0]?.candidate ?? null;
}

export function detectPrimaryChemicalEntity({ result = {}, text = "", referenceData = {} } = {}) {
  const product = topProductMatch(result);

  if (product) {
    return {
      name: compactWhitespace(firstNonEmpty(product.name, product.code)),
      code: compactWhitespace(product.code),
      supplier: compactWhitespace(product.supplier),
      casNumber: compactWhitespace(firstNonEmpty(product.casNumber, product.cas)),
      source: "product_match"
    };
  }

  if (result.fields?.productName) {
    return {
      name: compactWhitespace(result.fields.productName),
      code: "",
      supplier: compactWhitespace(result.fields?.supplier),
      casNumber: compactWhitespace(result.fields?.casNumber),
      source: "parsed_document"
    };
  }

  const notebookEntry = detectEntityFromNotebook(text, referenceData.notebookIntelligence ?? []);

  if (notebookEntry) {
    return {
      name: notebookEntry.entity,
      code: "",
      supplier: notebookEntry.supplierNames?.[0] ?? "",
      casNumber: notebookEntry.masterSpecs?.casNumber ?? "",
      source: "notebook_match"
    };
  }

  return null;
}

function buildNotebookQuery(primaryEntity = {}, text = "") {
  return [
    primaryEntity.name,
    primaryEntity.code,
    primaryEntity.supplier,
    primaryEntity.casNumber,
    text
  ]
    .filter(Boolean)
    .join(" ");
}

function extractCurrentSpecs(result = {}, text = "") {
  const joined = `${text}\n${result.rawExtracts?.lines?.join("\n") ?? ""}`;

  return {
    casNumber: compactWhitespace(
      firstNonEmpty(result.fields?.casNumber, (joined.match(/\b\d{2,7}-\d{2}-\d\b/) ?? [])[0])
    ),
    purity: compactWhitespace((joined.match(/\bpurity\b\s*[:\-]?\s*([^\n;,]+)/i) ?? [])[1] ?? ""),
    flashPoint: compactWhitespace((joined.match(/\bflash point\b\s*[:\-]?\s*([^\n;,]+)/i) ?? [])[1] ?? "")
  };
}

function extractCurrentPrice(text = "") {
  return compactWhitespace((text.match(MONEY_RE) ?? [])[0] ?? "");
}

function compareAgainstNotebook({ result = {}, text = "", entry = {} } = {}) {
  const contradictions = [];
  const currentSpecs = extractCurrentSpecs(result, text);
  const currentPrice = extractCurrentPrice(text);

  if (entry.masterSpecs?.casNumber && currentSpecs.casNumber && normalizeText(entry.masterSpecs.casNumber) !== normalizeText(currentSpecs.casNumber)) {
    contradictions.push(
      `CAS mismatch: current ${currentSpecs.casNumber} vs Notebook ${entry.masterSpecs.casNumber}.`
    );
  }

  if (entry.masterSpecs?.purity && currentSpecs.purity && normalizeText(entry.masterSpecs.purity) !== normalizeText(currentSpecs.purity)) {
    contradictions.push(
      `Purity mismatch: current ${currentSpecs.purity} vs Notebook ${entry.masterSpecs.purity}.`
    );
  }

  if (entry.masterSpecs?.flashPoint && currentSpecs.flashPoint && normalizeText(entry.masterSpecs.flashPoint) !== normalizeText(currentSpecs.flashPoint)) {
    contradictions.push(
      `Flash point mismatch: current ${currentSpecs.flashPoint} vs Notebook ${entry.masterSpecs.flashPoint}.`
    );
  }

  if (entry.lastKnownGoodPrice && currentPrice && normalizeText(entry.lastKnownGoodPrice) !== normalizeText(currentPrice)) {
    contradictions.push(
      `Price differs from Notebook benchmark: current ${currentPrice} vs last known good ${entry.lastKnownGoodPrice}.`
    );
  }

  return {
    contradictions,
    currentSpecs,
    currentPrice
  };
}

function buildNotebookBrief({ primaryEntity = null, entry = null, comparison = null } = {}) {
  const lines = ["### 🧠 NotebookLM Intelligence Brief"];

  if (!primaryEntity?.name) {
    lines.push("Primary Chemical Entity: unresolved.");
    lines.push("No Historical Context Found in Notebook.");
    return lines.join("\n");
  }

  lines.push(`Primary Chemical Entity: ${primaryEntity.name}`);

  if (!entry) {
    lines.push("No Historical Context Found in Notebook.");
    return lines.join("\n");
  }

  if (entry.lastKnownGoodPrice) {
    lines.push(`Commercial Benchmark: ${entry.lastKnownGoodPrice}`);
  }

  if (entry.masterSpecs?.casNumber || entry.masterSpecs?.purity || entry.masterSpecs?.flashPoint) {
    const specLine = [
      entry.masterSpecs?.casNumber ? `CAS ${entry.masterSpecs.casNumber}` : "",
      entry.masterSpecs?.purity ? `Purity ${entry.masterSpecs.purity}` : "",
      entry.masterSpecs?.flashPoint ? `Flash Point ${entry.masterSpecs.flashPoint}` : ""
    ]
      .filter(Boolean)
      .join(" | ");

    if (specLine) {
      lines.push(`Master Specs: ${specLine}`);
    }
  }

  for (const note of safeArray(entry.historicalNotes).slice(0, 2)) {
    lines.push(`Historical Context: ${note}`);
  }

  for (const note of safeArray(entry.logisticsNuances).slice(0, 2)) {
    lines.push(`Logistics Nuance: ${note}`);
  }

  for (const note of safeArray(entry.commercialBenchmarks).slice(0, 2)) {
    lines.push(`Commercial Note: ${note}`);
  }

  for (const note of safeArray(entry.complianceNotes).slice(0, 2)) {
    lines.push(`Compliance Note: ${note}`);
  }

  if (comparison?.contradictions?.length) {
    lines.push(`Contradictions Detected: ${comparison.contradictions.join(" ")}`);
  } else {
    lines.push("Contradictions Detected: none obvious in the current interaction.");
  }

  return lines.join("\n");
}

export function enrichWithNotebookContext(result = {}, { text = "", referenceData = {} } = {}) {
  const notebookIntelligence = normalizeNotebookIntelligence(referenceData.notebookIntelligence ?? []);
  const primaryEntity = detectPrimaryChemicalEntity({ result, text, referenceData: { ...referenceData, notebookIntelligence } });
  const output = {
    ...result,
    warnings: [...(result.warnings ?? [])]
  };

  if (!primaryEntity) {
    output.notebookContext = {
      status: "missing_primary_entity",
      primaryChemicalEntity: null,
      brief: buildNotebookBrief({})
    };
    output.warnings.push("Primary chemical entity not identified. Review the draft before relying on technical context.");
    return output;
  }

  const notebookMatch = matchEntity(
    buildNotebookQuery(primaryEntity, text),
    notebookIntelligence,
    ["entity", "aliases", "supplierNames", "customerNames"],
    {
      minScore: 0.48,
      limit: 1
    }
  )[0]?.candidate ?? null;

  if (!notebookMatch) {
    output.notebookContext = {
      status: "no_historical_context",
      primaryChemicalEntity: primaryEntity,
      matchedEntry: null,
      contradictions: [],
      brief: buildNotebookBrief({ primaryEntity })
    };
    output.learningPrompt = `Should "${primaryEntity.name}" be added to the NotebookLM source of truth for future historical context?`;
    output.warnings.push("No Historical Context Found in Notebook.");
    return output;
  }

  const comparison = compareAgainstNotebook({
    result,
    text,
    entry: notebookMatch
  });

  output.notebookContext = {
    status: "matched",
    primaryChemicalEntity: primaryEntity,
    matchedEntry: notebookMatch,
    contradictions: comparison.contradictions,
    currentSignals: {
      currentPrice: comparison.currentPrice,
      currentSpecs: comparison.currentSpecs
    },
    brief: buildNotebookBrief({
      primaryEntity,
      entry: notebookMatch,
      comparison
    })
  };

  for (const contradiction of comparison.contradictions) {
    output.warnings.push(contradiction);
  }

  if (output.draftNote?.summary) {
    output.draftNote = {
      ...output.draftNote,
      summary: `${output.notebookContext.brief}\n\n${output.draftNote.summary}`
    };
  }

  return output;
}
