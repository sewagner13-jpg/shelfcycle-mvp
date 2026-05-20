import path from "node:path";
import { readFile } from "node:fs/promises";

export const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type"
};

export function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...CORS_HEADERS
  });
  response.end(JSON.stringify(payload, null, 2));
}

export function html(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    ...CORS_HEADERS
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
      "content-type": "text/plain; charset=utf-8",
      ...CORS_HEADERS
    });
    response.end("Not found");
  };
}
