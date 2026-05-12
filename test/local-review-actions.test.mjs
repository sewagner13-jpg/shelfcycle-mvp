import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import {
  attachLocalReviewActions,
  loadLocalReviewAction,
  sanitizeReviewAction
} from "../src/lib/local-review-actions.mjs";

test("attachLocalReviewActions creates local approval-first review URLs for core business threads", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-review-actions-"));

  try {
    const threads = [
      {
        threadId: "thread-1",
        subject: "G301 pricing",
        relationship: { relationship: "customer", subtype: "core_customer" },
        silo: { name: "commercial" },
        state: { state: "needs_attention" },
        externalParticipants: [{ name: "Buyer", email: "buyer@example.com", domain: "example.com" }],
        analysis: {
          draftNote: { title: "G301 pricing", summary: "Buyer needs pricing." },
          roleWorklists: { owner: [], sales: ["Send pricing."], procurement: [] },
          suggestedCreates: [],
          warnings: [],
          matches: {}
        }
      },
      {
        threadId: "thread-2",
        subject: "Promo",
        relationship: { relationship: "solicitation", subtype: "newsletter" },
        silo: { name: "noise" },
        state: { state: "informational" },
        externalParticipants: [],
        analysis: { roleWorklists: { owner: [], sales: [], procurement: [] } }
      }
    ];

    const enhanced = await attachLocalReviewActions(threads, {
      storageDir: tempDir,
      baseUrl: "http://localhost:4318"
    });

    assert.ok(enhanced[0].reviewUrl.startsWith("http://localhost:4318/review-action.html?id="));
    assert.ok(enhanced[0].proposedActions.some((item) => item.actionType === "customer_create" && item.executable));
    assert.ok(enhanced[0].executableActions.some((item) => item.actionType === "customer_create"));
    assert.equal(enhanced[0].reviewAction.viewToken, undefined);
    assert.equal(enhanced[1].reviewUrl, undefined);

    const url = new URL(enhanced[0].reviewUrl);
    const action = await loadLocalReviewAction(tempDir, url.searchParams.get("id"));
    assert.equal(action.subject, "G301 pricing");
    assert.equal(action.viewToken, url.searchParams.get("token"));
    assert.ok(action.chatGptUrl.startsWith("https://chatgpt.com/?q="));
    assert.equal(sanitizeReviewAction(action).viewToken, undefined);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function startSyncServer(handler) {
  const server = http.createServer(handler);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        endpoint: `http://127.0.0.1:${address.port}/api/review-action-sync`
      });
    });
  });
}

function sampleThread() {
  return {
    threadId: "thread-1",
    subject: "G301 pricing",
    relationship: { relationship: "customer", subtype: "core_customer" },
    silo: { name: "commercial" },
    state: { state: "needs_attention" },
    externalParticipants: [{ name: "Buyer", email: "buyer@example.com", domain: "example.com" }],
    analysis: {
      draftNote: { title: "G301 pricing", summary: "Buyer needs pricing." },
      roleWorklists: { owner: [], sales: ["Send pricing."], procurement: [] },
      suggestedCreates: [],
      warnings: [],
      matches: {}
    }
  };
}

test("attachLocalReviewActions uses hosted review URLs after successful sync", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-review-actions-"));
  const seen = [];
  const { server, endpoint } = await startSyncServer(async (request, response) => {
    const chunks = [];

    for await (const chunk of request) {
      chunks.push(chunk);
    }

    seen.push({
      authorization: request.headers.authorization,
      payload: JSON.parse(Buffer.concat(chunks).toString("utf8"))
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, synced: 1 }));
  });

  try {
    const enhanced = await attachLocalReviewActions([sampleThread()], {
      storageDir: tempDir,
      baseUrl: "https://clearedge-daily-brief.netlify.app",
      localBaseUrl: "http://localhost:4318",
      syncEndpoint: endpoint,
      syncToken: "test-token"
    });

    assert.ok(enhanced[0].reviewUrl.startsWith("https://clearedge-daily-brief.netlify.app/review-action.html?id="));
    assert.equal(enhanced[0].reviewSync.ok, true);
    assert.equal(seen[0].authorization, "Bearer test-token");
    assert.equal(seen[0].payload.action.subject, "G301 pricing");
  } finally {
    server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("attachLocalReviewActions falls back to local URLs when hosted sync is unavailable", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "local-review-actions-"));

  try {
    const enhanced = await attachLocalReviewActions([sampleThread()], {
      storageDir: tempDir,
      baseUrl: "https://clearedge-daily-brief.netlify.app",
      localBaseUrl: "http://localhost:4318"
    });

    assert.ok(enhanced[0].reviewUrl.startsWith("http://localhost:4318/review-action.html?id="));
    assert.equal(enhanced[0].reviewSync.ok, false);
    assert.match(enhanced[0].reviewSync.message, /missing/i);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
