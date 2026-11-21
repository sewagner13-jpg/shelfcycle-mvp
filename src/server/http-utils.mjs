import path from "node:path";
import { readFile } from "node:fs/promises";

export const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

// The hosted site calls this local backend from the browser on purpose (public/app.js,
// public/business-card.js), so it is the one non-local origin allowed through CORS.
export const HOSTED_SITE_ORIGIN = "https://clearedge-daily-brief.netlify.app";

// Loopback only. Binding to every interface exposes approval-gated ShelfCycle writes to the LAN.
export const LOCAL_BIND_HOST = "127.0.0.1";

const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"];

export function allowedOriginsForPort(port) {
  return new Set([
    HOSTED_SITE_ORIGIN,
    ...LOCAL_HOSTNAMES.map((hostname) => `http://${hostname}:${port}`)
  ]);
}

export function allowedHostsForPort(port) {
  return new Set(LOCAL_HOSTNAMES.map((hostname) => `${hostname}:${port}`));
}

export function isJsonContentType(value = "") {
  return String(value).split(";")[0].trim().toLowerCase() === "application/json";
}

// CORS headers for one request: the request Origin is echoed only when it is on the allow-list.
// Vary: Origin is always sent because the response depends on the Origin header.
export function corsHeadersFor(origin, allowedOrigins) {
  const headers = { vary: "Origin" };

  if (origin && allowedOrigins.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
  }

  return headers;
}

// Decides whether a request may reach the routes at all.
// - Host must be localhost:<port> or 127.0.0.1:<port>, which blocks DNS rebinding (a page on an
//   attacker's hostname that resolves to 127.0.0.1 would otherwise count as same-origin).
// - An Origin header, when present, must be on the allow-list. Node callers send none.
// - POST bodies must be declared application/json, so a cross-origin text/plain "simple"
//   request, which browsers send without a preflight, is refused before any route runs.
export function checkLocalRequest(request, { port }) {
  const origin = request.headers.origin;
  const allowedOrigins = allowedOriginsForPort(port);
  const corsHeaders = corsHeadersFor(origin, allowedOrigins);
  const host = String(request.headers.host || "").toLowerCase();

  if (!allowedHostsForPort(port).has(host)) {
    return {
      ok: false,
      statusCode: 403,
      code: "HOST_NOT_ALLOWED",
      message: `Host ${host || "(missing)"} is not allowed. Use http://localhost:${port}.`,
      corsHeaders
    };
  }

  if (origin !== undefined && !allowedOrigins.has(origin)) {
    return {
      ok: false,
      statusCode: 403,
      code: "ORIGIN_NOT_ALLOWED",
      message: `Origin ${origin || "(empty)"} is not allowed to call the local ShelfCycle MVP.`,
      corsHeaders
    };
  }

  if (request.method === "POST" && !isJsonContentType(request.headers["content-type"])) {
    return {
      ok: false,
      statusCode: 415,
      code: "UNSUPPORTED_CONTENT_TYPE",
      message: "POST requests must send content-type: application/json.",
      corsHeaders
    };
  }

  return { ok: true, corsHeaders };
}

export function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

export function html(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8"
  });
  response.end(body);
}

export async function readBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

export function createStaticFileServer({ publicRoot, dataRoot } = {}) {
  return async function serveStatic(requestPath, response) {
    const safePath = requestPath === "/" ? "/index.html" : requestPath;
    const localPaths = safePath.startsWith("/data/")
      ? [
        path.join(publicRoot, safePath.replace(/^\//, "")),
        path.join(dataRoot, safePath.replace(/^\/data\//, ""))
      ]
      : [path.join(publicRoot, safePath.replace(/^\//, ""))];

    for (const localPath of localPaths) {
      try {
        const contents = await readFile(localPath);
        const extension = path.extname(localPath);

        response.writeHead(200, {
          "content-type": MIME_TYPES[extension] ?? "application/octet-stream"
        });
        response.end(contents);
        return;
      } catch {
        // Try the next static candidate.
      }
    }

    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8"
    });
    response.end("Not found");
  };
}
