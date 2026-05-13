import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function netlifyFunctionPaths() {
  const functionsDir = path.join(projectRoot, "netlify", "functions");
  const files = (await readdir(functionsDir)).filter((file) => file.endsWith(".mjs"));
  const paths = new Set();

  for (const file of files) {
    const source = await readFile(path.join(functionsDir, file), "utf8");

    for (const match of source.matchAll(/path:\s*["'`]([^"'`]+)["'`]/g)) {
      paths.add(match[1]);
    }
  }

  return paths;
}

test("SDS/TDS PDF extraction exists in both local and hosted API surfaces", async () => {
  const serverSource = await readFile(path.join(projectRoot, "src", "server", "server.mjs"), "utf8");
  const appSource = await readFile(path.join(projectRoot, "public", "app.js"), "utf8");
  const hostedPaths = await netlifyFunctionPaths();
  const route = "/api/product-document/extract";

  assert.match(appSource, new RegExp(route.replaceAll("/", "\\/")));
  assert.match(serverSource, new RegExp(`url\\.pathname === ["'\`]${route.replaceAll("/", "\\/")}["'\`]`));
  assert.equal(hostedPaths.has(route), true);
});

test("SDS/TDS analyze exists in both local and hosted API surfaces", async () => {
  const serverSource = await readFile(path.join(projectRoot, "src", "server", "server.mjs"), "utf8");
  const appSource = await readFile(path.join(projectRoot, "public", "app.js"), "utf8");
  const hostedPaths = await netlifyFunctionPaths();
  const route = "/api/analyze";

  assert.match(appSource, new RegExp(route.replaceAll("/", "\\/")));
  assert.match(serverSource, new RegExp(`url\\.pathname === ["'\`]${route.replaceAll("/", "\\/")}["'\`]`));
  assert.equal(hostedPaths.has(route), true);
});
