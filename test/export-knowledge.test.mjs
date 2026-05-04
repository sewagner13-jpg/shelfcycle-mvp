import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = "/Users/seanwagner/Documents/Playground/shelfcycle-mvp";

test("export-knowledge auto-merges the project Notebook intelligence file", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "clearedge-export-"));
  const inputPath = path.join(tempDir, "reference-data.json");
  const outputPath = path.join(tempDir, "bundle.json");

  await writeFile(
    inputPath,
    JSON.stringify(
      {
        customers: [{ name: "Sun Coatings", website: "https://suncoatings.example" }],
        contacts: [{ name: "Courtney Quinn", email: "cquinn@suncoatings.example", companyType: "Customer" }],
        products: [{ code: "G301", name: "ACCESS Organosilane G301", supplier: "ACCESS Rudolf Technologies" }],
        locations: []
      },
      null,
      2
    )
  );

  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  await execFileAsync(
    "node",
    [
      path.join(projectRoot, "apps/local-sync/export-knowledge.mjs"),
      "--input",
      inputPath,
      "--out",
      outputPath,
      "--overrides",
      path.join(projectRoot, "data/examples/knowledge-overrides.json")
    ],
    {
      cwd: projectRoot
    }
  );

  const bundle = JSON.parse(await readFile(outputPath, "utf8"));

  assert.ok(bundle.notebookIntelligence.length >= 12);
  assert.ok(bundle.lookups.notebookEntityAliases.includes("RUCOLAC B-321"));
});
