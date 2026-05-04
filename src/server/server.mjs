import http from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { analyzeInput } from "../lib/analyze.mjs";
import { importCsv } from "../lib/csv-import.mjs";
import { createKnowledgeBundle } from "../lib/knowledge-bundle.mjs";
import { getNoteSubmissionTarget } from "../lib/shelfcycle-submit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const publicRoot = path.join(projectRoot, "public");
const dataRoot = path.join(projectRoot, "data");
const DEFAULT_INTELLIGENCE_FILE = path.join(dataRoot, "clearedge-intelligence.json");
const LEGACY_INTELLIGENCE_FILE = path.join(dataRoot, "clearedge-brain-notebook-intelligence.json");
const AUTOMATION_RUNNER_PATH = path.join(projectRoot, "src/lib/shelfcycle-automation-runner.mjs");
const LOCAL_DAILY_BRIEF_RUNNER_PATH = path.join(projectRoot, "apps/daily-brief/run-local-scheduled.mjs");
const execFileAsync = promisify(execFile);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function readBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

async function serveStatic(requestPath, response) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const root = safePath.startsWith("/data/") ? dataRoot : publicRoot;
  const localPath = path.join(root, safePath.replace(/^\/(?:data\/)?/, ""));

  try {
    const contents = await readFile(localPath);
    const extension = path.extname(localPath);

    response.writeHead(200, {
      "content-type": MIME_TYPES[extension] ?? "application/octet-stream"
    });
    response.end(contents);
  } catch {
    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8"
    });
    response.end("Not found");
  }
}

async function fetchReviewAction(reviewUrl = "") {
  const url = String(reviewUrl).trim();

  if (!url) {
    throw new Error("Missing reviewUrl.");
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Could not load review action from ${url}.`);
  }

  const payload = await response.json();

  if (!payload?.action) {
    throw new Error("Review action response did not include an action payload.");
  }

  return payload.action;
}

function runDetachedLoginWindow() {
  const child = spawn(process.execPath, [AUTOMATION_RUNNER_PATH, "login"], {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore"
  });

  child.unref();
}

async function executeNoteSubmission(action = {}) {
  const submission = getNoteSubmissionTarget(action);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shelfcycle-submit-"));
  const payloadPath = path.join(tempDir, "note-payload.json");

  try {
    await writeFile(payloadPath, JSON.stringify(submission, null, 2));
    const { stdout } = await execFileAsync(process.execPath, [AUTOMATION_RUNNER_PATH, "create-note", "--payload", payloadPath], {
      cwd: projectRoot
    });

    return {
      submission,
      result: JSON.parse(stdout.trim() || "{}")
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function requestLocalDailyBrief(payload = {}) {
  const args = [LOCAL_DAILY_BRIEF_RUNNER_PATH];
  const dryRun = Boolean(payload.dryRun);
  const hours = optionalNumber(payload.hours);
  const maxMessages = optionalNumber(payload.maxMessages);
  const maxMessageThreads = optionalNumber(payload.maxMessageThreads);

  if (dryRun) {
    args.push("--dry-run");
  }

  if (hours) {
    args.push("--hours", String(hours));
  }

  if (maxMessages) {
    args.push("--max-messages", String(maxMessages));
  }

  if (maxMessageThreads) {
    args.push("--max-message-threads", String(maxMessageThreads));
  }

  const { stdout } = await execFileAsync(process.execPath, args, {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024
  });

  return JSON.parse(stdout.trim() || "{}");
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function mergeIntelligenceEntries(existing = [], incoming = []) {
  const byEntity = new Map();

  for (const entry of [...existing, ...incoming]) {
    const entity = entry?.entity;

    if (!entity || byEntity.has(entity)) {
      continue;
    }

    byEntity.set(entity, entry);
  }

  return [...byEntity.values()];
}

async function loadProjectIntelligenceEntries() {
  const payload =
    (await readJsonIfPresent(DEFAULT_INTELLIGENCE_FILE)) ??
    (await readJsonIfPresent(LEGACY_INTELLIGENCE_FILE)) ??
    {};

  return payload.clearedgeIntelligence ?? payload.notebookIntelligence ?? [];
}

async function mergeProjectIntelligence(referenceData = {}) {
  const projectEntries = await loadProjectIntelligenceEntries();
  const existingEntries = referenceData.clearedgeIntelligence ?? referenceData.notebookIntelligence ?? [];
  const mergedEntries = mergeIntelligenceEntries(existingEntries, projectEntries);

  return {
    ...referenceData,
    clearedgeIntelligence: mergedEntries
  };
}

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (
        request.method === "GET" &&
        (
          url.pathname === "/" ||
          url.pathname.startsWith("/data/") ||
          url.pathname.startsWith("/app") ||
          url.pathname.endsWith(".css") ||
          url.pathname.endsWith(".js") ||
          url.pathname.endsWith(".html")
        )
      ) {
        await serveStatic(url.pathname, response);
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/analyze") {
        const payload = await readBody(request);
        const result = analyzeInput({
          ...payload,
          referenceData: await mergeProjectIntelligence(payload.referenceData ?? {})
        });
        json(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/import-csv") {
        const payload = await readBody(request);
        const result = importCsv(payload);
        json(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/export-knowledge") {
        const payload = await readBody(request);
        const result = createKnowledgeBundle({
          ...payload,
          referenceData: await mergeProjectIntelligence(payload.referenceData ?? {})
        });
        json(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/load-review-action") {
        const payload = await readBody(request);
        const action = payload.action ?? (await fetchReviewAction(payload.reviewUrl));
        json(response, 200, { ok: true, action });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/shelfcycle/open-session") {
        runDetachedLoginWindow();
        json(response, 200, {
          ok: true,
          message: "A local ShelfCycle browser window has been opened. Log in if prompted, then return here."
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/shelfcycle/create-note") {
        const payload = await readBody(request);
        const action = payload.action ?? (await fetchReviewAction(payload.reviewUrl));
        const result = await executeNoteSubmission(action);
        json(response, 200, {
          ok: true,
          ...result
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/daily-brief/request") {
        const payload = await readBody(request);
        const result = await requestLocalDailyBrief(payload);
        json(response, 200, {
          ok: true,
          result
        });
        return;
      }

      response.writeHead(404, {
        "content-type": "text/plain; charset=utf-8"
      });
      response.end("Not found");
    } catch (error) {
      json(response, 500, {
        error: error instanceof Error ? error.message : "Unexpected server error"
      });
    }
  });
}

export function startServer({ port = 4318 } = {}) {
  const server = createServer();

  server.listen(port, () => {
    console.log(`ShelfCycle MVP listening on http://localhost:${port}`);
  });

  return server;
}
