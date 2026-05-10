import test from "node:test";
import assert from "node:assert/strict";
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
