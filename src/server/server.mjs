import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeInput } from "../lib/analyze.mjs";
import { importCsv } from "../lib/csv-import.mjs";
import { createKnowledgeBundle } from "../lib/knowledge-bundle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const publicRoot = path.join(projectRoot, "public");
const dataRoot = path.join(projectRoot, "data");

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
        const result = analyzeInput(payload);
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
        const result = createKnowledgeBundle(payload);
        json(response, 200, result);
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
