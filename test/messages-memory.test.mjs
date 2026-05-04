import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import { buildMessagesMemorySection } from "../src/lib/messages-memory.mjs";

test("buildMessagesMemorySection summarizes urgent business texts and stores sanitized candidates", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "messages-memory-store-"));
  const storagePath = path.join(tempDir, "messages-memory-store.json");

  try {
    const section = await buildMessagesMemorySection({
      config: {
        enabled: true,
        storagePath,
        businessKeywords: ["pricing", "sds", "benzyl alcohol"],
        urgentKeywords: ["today", "urgent"]
      },
      analyzedThreads: [
        {
          threadId: "messages-chat-1",
          relationship: { relationship: "supplier", subtype: "core_supplier" },
          state: { state: "needs_attention" },
          silo: { name: "commercial" },
          lastTimestamp: Date.UTC(2026, 4, 4, 10, 0, 0),
          subject: "Text thread with +17329836870",
          externalParticipants: [{ name: "Kunal Butala", email: "+17329836870", domain: "" }],
          sourceRecords: [
            {
              messageId: 100,
              timestamp: Date.UTC(2026, 4, 4, 9, 0, 0),
              text: "Need SDS and pricing on benzyl alcohol today.",
              isFromMe: false,
              hasAttachment: false
            }
          ],
          analysis: {
            rawExtracts: {
              keyPoints: ["Need SDS and pricing on benzyl alcohol today."]
            },
            roleWorklists: {
              owner: [],
              sales: ["Send SDS and pricing response today."],
              procurement: []
            },
            draftNote: {
              summary: "Need SDS and pricing on benzyl alcohol today."
            }
          }
        },
        {
          threadId: "messages-chat-2",
          relationship: { relationship: "solicitation", subtype: "newsletter" },
          state: { state: "informational" },
          silo: { name: "noise" },
          lastTimestamp: Date.UTC(2026, 4, 4, 8, 0, 0),
          subject: "Promo",
          externalParticipants: [{ name: "Promo", email: "+18005550199", domain: "" }],
          sourceRecords: [
            {
              messageId: 101,
              timestamp: Date.UTC(2026, 4, 4, 8, 0, 0),
              text: "Weekend special offer",
              isFromMe: false,
              hasAttachment: false
            }
          ],
          analysis: {
            rawExtracts: { keyPoints: ["Weekend special offer"] },
            roleWorklists: { owner: [], sales: [], procurement: [] },
            draftNote: { summary: "Weekend special offer" }
          }
        }
      ]
    });

    assert.equal(section.section, "Message Memory");
    assert.equal(section.urgent_items.length, 1);
    assert.equal(section.business_threads.length, 1);
    assert.equal(section.unanswered_messages.length, 1);
    assert.ok(section.memory_candidates.some((item) => item.memoryType === "document_request"));
    assert.ok(section.suggested_followups.some((item) => item.summary.includes("Send SDS and pricing response today.")));
    assert.equal(section.low_priority_summary.length, 1);

    const saved = JSON.parse(await readFile(storagePath, "utf8"));
    assert.ok(Array.isArray(saved.candidates));
    assert.ok(saved.candidates.length >= 1);
    assert.equal(saved.candidates[0].evidenceSnippet, "");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
