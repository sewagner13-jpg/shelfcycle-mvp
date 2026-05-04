import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { importCsv } from "../../src/lib/csv-import.mjs";
import { createKnowledgeBundle } from "../../src/lib/knowledge-bundle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_INTELLIGENCE_PATH = path.join(PROJECT_ROOT, "data/clearedge-intelligence.json");
const LEGACY_NOTEBOOK_PATH = path.join(PROJECT_ROOT, "data/clearedge-brain-notebook-intelligence.json");

function parseArgs(argv = []) {
  const args = {
    inputs: [],
    out: "",
    overrides: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--input") {
      args.inputs.push(argv[index + 1]);
      index += 1;
      continue;
    }

    if (value === "--out") {
      args.out = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--overrides") {
      args.overrides = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

async function loadJson(filePath) {
  const contents = await readFile(filePath, "utf8");
  return JSON.parse(contents);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadReferenceData(inputPaths = []) {
  const referenceData = {
    products: [],
    customers: [],
    contacts: [],
    locations: [],
    clearedgeIntelligence: []
  };

  for (const inputPath of inputPaths) {
    if (!inputPath) {
      continue;
    }

    if (inputPath.endsWith(".json")) {
      const payload = await loadJson(inputPath);

      for (const key of ["products", "customers", "contacts", "locations"]) {
        if (Array.isArray(payload[key])) {
          referenceData[key].push(...payload[key]);
        }
      }

      const intelligenceEntries = payload.clearedgeIntelligence ?? payload.notebookIntelligence;

      if (Array.isArray(intelligenceEntries)) {
        referenceData.clearedgeIntelligence.push(...intelligenceEntries);
      }

      continue;
    }

    const csvText = await readFile(inputPath, "utf8");
    const imported = importCsv({
      csvText,
      fileName: path.basename(inputPath)
    });

    referenceData[imported.entityType].push(...imported.records);
  }

  return referenceData;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.inputs.length || !args.out) {
    throw new Error("Usage: node apps/local-sync/export-knowledge.mjs --input file1 --input file2 --out output.json [--overrides overrides.json]");
  }

  const defaultIntelligencePath =
    (await fileExists(DEFAULT_INTELLIGENCE_PATH))
      ? DEFAULT_INTELLIGENCE_PATH
      : (await fileExists(LEGACY_NOTEBOOK_PATH))
        ? LEGACY_NOTEBOOK_PATH
        : "";
  const projectIntelligenceInputs =
    defaultIntelligencePath &&
    !args.inputs.some((inputPath) => path.resolve(inputPath) === defaultIntelligencePath)
      ? [defaultIntelligencePath]
      : [];

  const referenceData = await loadReferenceData([...args.inputs, ...projectIntelligenceInputs]);
  const overrides = args.overrides ? await loadJson(args.overrides) : {};
  const bundle = createKnowledgeBundle({
    referenceData,
    suppliers: overrides.suppliers ?? [],
    opsVendors: overrides.opsVendors ?? [],
    internalUsers: overrides.internalUsers ?? [],
    internalDomains: overrides.internalDomains ?? ["clear-edge.net"],
    metadata: overrides.metadata ?? {}
  });

  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(bundle, null, 2));
  console.log(`Knowledge bundle written to ${args.out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
