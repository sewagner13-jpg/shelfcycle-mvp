import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readdir, rm } from "node:fs/promises";

// Point the server's .local state at a scratch directory before it is imported, so these tests
// never write workflow runs into the real project state.
const localDir = await mkdtemp(path.join(os.tmpdir(), "shelfcycle-local-server-"));
process.env.SHELFCYCLE_LOCAL_DIR = localDir;

const { startServer } = await import("../src/server/server.mjs");
const { HOSTED_SITE_ORIGIN, checkLocalRequest } = await import("../src/server/http-utils.mjs");

const workflowRunsDir = path.join(localDir, "workflow-runs");
const EVIL_ORIGIN = "https://evil.example";
let server;
let port;

before(async () => {
  server = startServer({ port: 0 });

  if (!server.listening) {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  }

  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(localDir, { recursive: true, force: true });
});

// node:http instead of fetch so the test controls the Host and Origin headers exactly.
function send({ method = "GET", path: requestPath = "/health", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      method,
      path: requestPath,
      headers: {
        host: `localhost:${port}`,
        ...headers
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;

        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }

        resolve({ status: response.statusCode, headers: response.headers, text, json: parsed });
      });
    });

    request.on("error", reject);

    if (body !== undefined) {
      request.write(body);
    }

    request.end();
  });
}

async function workflowRunFiles() {
  return await readdir(workflowRunsDir).catch(() => []);
}

const submitPayload = JSON.stringify({
  reviewActionId: "review-1",
  token: "token-from-latest-brief",
  actionId: "action-1",
  actionType: "customer_note",
  approvedByUser: true
});

test("local server listens on loopback only", async () => {
  assert.equal(server.address().address, "127.0.0.1");

  const externalAddress = Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === "IPv4" && !entry.internal)?.address;

  if (!externalAddress) {
    return;
  }

  const outcome = await new Promise((resolve) => {
    const socket = net.connect({ host: externalAddress, port });
    socket.setTimeout(2000);
    socket.once("connect", () => {
      socket.destroy();
      resolve("connected");
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve("timeout");
    });
    socket.once("error", (error) => resolve(error.code));
  });

  assert.notEqual(outcome, "connected", `server must not accept connections on ${externalAddress}`);
});

test("cross-origin preflight from an origin not on the allow-list is refused", async () => {
  const response = await send({
    method: "OPTIONS",
    path: "/api/shelfcycle/submit-action",
    headers: {
      origin: EVIL_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  });

  assert.equal(response.status, 403);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.equal(response.json.error.code, "ORIGIN_NOT_ALLOWED");
});

test("cross-origin POST from an origin not on the allow-list is refused before any route runs", async () => {
  const runsBefore = await workflowRunFiles();

  for (const contentType of ["application/json", "text/plain"]) {
    const response = await send({
      method: "POST",
      path: "/api/shelfcycle/submit-action",
      headers: { origin: EVIL_ORIGIN, "content-type": contentType },
      body: submitPayload
    });

    assert.equal(response.status, 403, contentType);
    assert.equal(response.headers["access-control-allow-origin"], undefined, contentType);
    assert.equal(response.json.error.code, "ORIGIN_NOT_ALLOWED", contentType);
  }

  assert.deepEqual(await workflowRunFiles(), runsBefore, "a refused request must not start a workflow run");
});

test("cross-origin read of the latest brief from an origin not on the allow-list is refused", async () => {
  for (const requestPath of ["/api/daily-brief/latest", "/api/daily-brief/latest.html"]) {
    const response = await send({ path: requestPath, headers: { origin: EVIL_ORIGIN } });

    assert.equal(response.status, 403, requestPath);
    assert.equal(response.headers["access-control-allow-origin"], undefined, requestPath);
  }
});

test("text/plain POST to submit-action is rejected before the approval check", async () => {
  const runsBefore = await workflowRunFiles();

  for (const headers of [
    { "content-type": "text/plain" },
    { "content-type": "text/plain;charset=UTF-8", origin: `http://localhost:${port}` },
    {}
  ]) {
    const response = await send({
      method: "POST",
      path: "/api/shelfcycle/submit-action",
      headers,
      body: submitPayload
    });

    assert.equal(response.status, 415, JSON.stringify(headers));
    assert.equal(response.json.error.code, "UNSUPPORTED_CONTENT_TYPE");
  }

  // The route records a workflow run before it checks approval, so no new run means it never ran.
  assert.deepEqual(await workflowRunFiles(), runsBefore);
});

test("DNS-rebinding requests with a foreign Host header are refused", async () => {
  const runsBefore = await workflowRunFiles();
  const getResponse = await send({
    path: "/api/daily-brief/latest",
    headers: { host: `attacker.example:${port}` }
  });

  assert.equal(getResponse.status, 403);
  assert.equal(getResponse.json.error.code, "HOST_NOT_ALLOWED");

  const postResponse = await send({
    method: "POST",
    path: "/api/shelfcycle/submit-action",
    headers: {
      host: `attacker.example:${port}`,
      origin: `http://attacker.example:${port}`,
      "content-type": "application/json"
    },
    body: submitPayload
  });

  assert.equal(postResponse.status, 403);
  assert.equal(postResponse.json.error.code, "HOST_NOT_ALLOWED");
  assert.deepEqual(await workflowRunFiles(), runsBefore);
});

test("same-origin JSON POST still reaches the existing approval check", async () => {
  const runsBefore = await workflowRunFiles();

  for (const hostname of ["localhost", "127.0.0.1"]) {
    const origin = `http://${hostname}:${port}`;
    const response = await send({
      method: "POST",
      path: "/api/shelfcycle/submit-action",
      headers: {
        host: `${hostname}:${port}`,
        origin,
        "content-type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        reviewActionId: "review-1",
        token: "token",
        actionId: "action-1",
        actionType: "customer_note",
        approvedByUser: false
      })
    });

    assert.equal(response.status, 400, origin);
    assert.equal(response.json.error.code, "APPROVAL_REQUIRED", origin);
    assert.equal(response.headers["access-control-allow-origin"], origin);
    assert.match(response.headers.vary, /Origin/);
  }

  assert.ok((await workflowRunFiles()).length > runsBefore.length, "the approval check records a workflow run");
});

test("hosted site origin is still allowed for preflight, GET and POST", async () => {
  const preflight = await send({
    method: "OPTIONS",
    path: "/api/shelfcycle/submit-action",
    headers: {
      origin: HOSTED_SITE_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  });

  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], HOSTED_SITE_ORIGIN);
  assert.match(preflight.headers["access-control-allow-methods"], /POST/);
  assert.match(preflight.headers["access-control-allow-headers"], /content-type/);
  assert.match(preflight.headers.vary, /Origin/);

  const health = await send({ path: "/health", headers: { origin: HOSTED_SITE_ORIGIN } });

  assert.equal(health.status, 200);
  assert.equal(health.headers["access-control-allow-origin"], HOSTED_SITE_ORIGIN);
  assert.deepEqual(health.json, { ok: true });

  const post = await send({
    method: "POST",
    path: "/api/shelfcycle/submit-action",
    headers: { origin: HOSTED_SITE_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ reviewActionId: "review-1", approvedByUser: false })
  });

  assert.equal(post.status, 400);
  assert.equal(post.json.error.code, "APPROVAL_REQUIRED");
  assert.equal(post.headers["access-control-allow-origin"], HOSTED_SITE_ORIGIN);
});

test("responses never carry a wildcard CORS header", async () => {
  for (const headers of [{}, { origin: HOSTED_SITE_ORIGIN }, { origin: `http://localhost:${port}` }]) {
    const response = await send({ path: "/health", headers });

    assert.notEqual(response.headers["access-control-allow-origin"], "*");
    assert.match(response.headers.vary, /Origin/);
  }

  const noOrigin = await send({ path: "/health" });
  assert.equal(noOrigin.headers["access-control-allow-origin"], undefined);
});

test("Node callers without an Origin header still work over localhost and 127.0.0.1", async () => {
  // The same local routes scripts/link-health-check.mjs checks, requested the way it requests
  // them; apps/local-runner/install-mac-launchd.mjs fetches /health the same way.
  const routes = [
    "/",
    "/briefs.html",
    "/business-card.html",
    "/product-intake.html",
    "/review-action.html",
    "/review-submit.html",
    "/settings.html",
    "/health",
    "/api/daily-brief/status"
  ];

  for (const hostname of ["localhost", "127.0.0.1"]) {
    for (const route of routes) {
      const response = await fetch(`http://${hostname}:${port}${route}`, {
        method: "GET",
        redirect: "manual",
        cache: "no-store"
      });

      assert.equal(response.status, 200, `${hostname}${route}`);
      await response.arrayBuffer();
    }
  }
});

test("checkLocalRequest treats Host case-insensitively and rejects a null Origin", () => {
  const request = (headers, method = "GET") => ({ method, headers });

  assert.equal(checkLocalRequest(request({ host: "LocalHost:4318" }), { port: 4318 }).ok, true);
  assert.equal(checkLocalRequest(request({ host: "localhost:4319" }), { port: 4318 }).code, "HOST_NOT_ALLOWED");
  assert.equal(checkLocalRequest(request({}), { port: 4318 }).code, "HOST_NOT_ALLOWED");
  assert.equal(checkLocalRequest(request({ host: "localhost:4318", origin: "null" }), { port: 4318 }).code, "ORIGIN_NOT_ALLOWED");
  assert.equal(
    checkLocalRequest(request({ host: "localhost:4318", origin: `${HOSTED_SITE_ORIGIN}.evil.example` }), { port: 4318 }).code,
    "ORIGIN_NOT_ALLOWED"
  );
  assert.equal(
    checkLocalRequest(request({ host: "localhost:4318", "content-type": "Application/JSON" }, "POST"), { port: 4318 }).ok,
    true
  );
});
