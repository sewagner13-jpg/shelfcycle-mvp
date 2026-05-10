import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBriefAiRefinement,
  buildBriefAiPayload,
  refineBriefWithAi,
  requestBriefAiRefinement,
  resolveBriefAiConfig
} from "../src/lib/brief-ai-refiner.mjs";

function sampleThread(overrides = {}) {
  return {
    threadId: "thread-123",
    subject: "PO #23017 Benzyl Alcohol",
    source: "gmail",
    relationship: { relationship: "customer", subtype: "core_customer" },
    state: { state: "needs_attention" },
    silo: { name: "commercial" },
    priorityScore: 95,
    externalParticipants: [{ name: "Kunal Butala", email: "kunal@example.com", domain: "example.com" }],
    analysis: {
      rawExtracts: {
        keyPoints: ["Customer sent PO for benzyl alcohol totes."],
        actionItems: ["Confirm PO and release details."]
      },
      roleWorklists: {
        owner: [],
        sales: ["Confirm PO and send release information."],
        procurement: ["Validate inventory and freight path."]
      },
      matches: {
        products: [{ candidate: { code: "BENZYL", name: "Benzyl Alcohol" } }]
      },
      suggestedCreates: [],
      warnings: [],
      draftNote: {
        summary: "PO received for benzyl alcohol totes."
      }
    },
    workspaceArtifacts: {
      attachments: [{ filename: "PO23017.pdf", mimeType: "application/pdf" }]
    },
    events: [
      {
        from: { name: "Kunal Butala", email: "kunal@example.com" },
        timestamp: Date.UTC(2026, 4, 4, 13, 0, 0),
        snippet: "Please process PO #23017 for 20 totes of benzyl alcohol."
      }
    ],
    summary: "PO received for benzyl alcohol totes.",
    ...overrides
  };
}

test("resolveBriefAiConfig enables only when an API key is available", () => {
  assert.equal(resolveBriefAiConfig({ enabled: true, apiKey: "test-key" }).enabled, true);
  assert.equal(resolveBriefAiConfig({ enabled: true, apiKey: "" }).enabled, false);
  assert.equal(resolveBriefAiConfig({ enabled: false, apiKey: "test-key" }).enabled, false);
});

test("resolveBriefAiConfig sets a bounded request timeout", () => {
  assert.equal(resolveBriefAiConfig({ enabled: true, apiKey: "test-key", timeoutMs: 1234 }).timeoutMs, 1234);
  assert.equal(resolveBriefAiConfig({ enabled: true, apiKey: "test-key", timeoutMs: 0 }).timeoutMs, 60000);
});

test("buildBriefAiPayload sends concise owner/operator context without raw full thread dumps", () => {
  const payload = buildBriefAiPayload({
    analyzedThreads: [sampleThread()],
    messageMemory: {
      business_threads: [{ contact: "+18035550100", summary: "Asked about SDS." }]
    }
  });

  assert.equal(payload.company, "ClearEdge Solutions");
  assert.equal(payload.threads.length, 1);
  assert.equal(payload.threads[0].threadId, "thread-123");
  assert.deepEqual(payload.threads[0].matchedEntities.products, ["Benzyl Alcohol"]);
  assert.deepEqual(payload.threads[0].attachments, ["PO23017.pdf"]);
  assert.ok(payload.goal.includes("owner/operator"));
});

test("buildBriefAiPayload only sends Needs Sean and Waiting on others threads for AI summaries", () => {
  const payload = buildBriefAiPayload({
    analyzedThreads: [
      sampleThread({ threadId: "needs", state: { state: "needs_attention" } }),
      sampleThread({ threadId: "waiting", state: { state: "waiting_on_other_side" } }),
      sampleThread({ threadId: "info", state: { state: "informational" } }),
      sampleThread({
        threadId: "noise",
        state: { state: "needs_attention" },
        relationship: { relationship: "solicitation", subtype: "newsletter" }
      })
    ]
  });

  assert.deepEqual(payload.threads.map((item) => item.threadId), ["needs", "waiting"]);
  assert.ok(payload.aiSummaryScope.includes("needs_attention"));
});

test("resolveBriefAiConfig supports explicit AI summary target states", () => {
  assert.deepEqual(
    resolveBriefAiConfig({
      enabled: true,
      apiKey: "test-key",
      targetStates: ["needs_attention"]
    }).targetStates,
    ["needs_attention"]
  );
});

test("requestBriefAiRefinement calls OpenAI Responses API and parses structured output", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });

    return {
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            threads: [
              {
                threadId: "thread-123",
                action: "Confirm the PO and release plan.",
                why: "Customer sent a real PO for benzyl alcohol totes.",
                keyDetails: ["20 totes", "Benzyl Alcohol"],
                ownerLens: "Revenue order with inventory and freight implications.",
                shelfCycleCandidate: {
                  shouldConsider: true,
                  recordType: "customer note",
                  title: "PO #23017 Benzyl Alcohol",
                  summary: "Review PO and release details before entering a ShelfCycle note.",
                  fields: ["PO #23017", "Benzyl Alcohol"]
                },
                riskNote: "Confirm inventory before promising ship timing.",
                priorityReason: "Active order.",
                confidence: 0.92
              }
            ],
            messageMemory: {
              summary: "No urgent texts.",
              action: "No text action.",
              shelfCycleCandidate: "None."
            }
          })
        };
      }
    };
  };

  const result = await requestBriefAiRefinement({
    payload: buildBriefAiPayload({ analyzedThreads: [sampleThread()] }),
    config: { enabled: true, apiKey: "test-key", model: "test-model" },
    fetchImpl
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].body.model, "test-model");
  assert.equal(calls[0].body.text.format.type, "json_schema");
  assert.equal(result.threads[0].action, "Confirm the PO and release plan.");
});

test("requestBriefAiRefinement aborts slow OpenAI requests", async () => {
  const fetchImpl = async (_url, options = {}) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  await assert.rejects(
    requestBriefAiRefinement({
      payload: buildBriefAiPayload({ analyzedThreads: [sampleThread()] }),
      config: { enabled: true, apiKey: "test-key", timeoutMs: 5 },
      fetchImpl
    }),
    /timed out after 5ms/
  );
});

test("refineBriefWithAi attaches owner-read fields to analyzed threads", async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        output_text: JSON.stringify({
          threads: [
            {
              threadId: "thread-123",
              action: "Confirm the PO and release plan.",
              why: "Customer sent a real PO for benzyl alcohol totes.",
              keyDetails: ["20 totes", "Benzyl Alcohol"],
              ownerLens: "Revenue order with inventory and freight implications.",
              shelfCycleCandidate: {
                shouldConsider: true,
                recordType: "customer note",
                title: "PO #23017 Benzyl Alcohol",
                summary: "Review PO and release details before entering a ShelfCycle note.",
                fields: ["PO #23017", "Benzyl Alcohol"]
              },
              riskNote: "Confirm inventory before promising ship timing.",
              priorityReason: "Active order.",
              confidence: 0.92
            }
          ],
          messageMemory: {
            summary: "Text asked for SDS.",
            action: "Review text SDS request.",
            shelfCycleCandidate: "Consider contact memory after approval."
          }
        })
      };
    }
  });

  const result = await refineBriefWithAi({
    analyzedThreads: [sampleThread()],
    messageMemory: { business_threads: [{ contact: "+18035550100", summary: "Asked about SDS." }] },
    config: { enabled: true, apiKey: "test-key" },
    fetchImpl
  });

  assert.equal(result.status, "refined");
  assert.equal(result.analyzedThreads[0].briefAi.action, "Confirm the PO and release plan.");
  assert.equal(result.analyzedThreads[0].analysis.briefAi.why, "Customer sent a real PO for benzyl alcohol totes.");
  assert.equal(result.messageMemory.briefAi.action, "Review text SDS request.");
});

test("applyBriefAiRefinement leaves unmatched threads unchanged", () => {
  const thread = sampleThread({ threadId: "unmatched" });
  const result = applyBriefAiRefinement({
    analyzedThreads: [thread],
    refinement: {
      threads: [],
      messageMemory: {
        summary: "",
        action: "",
        shelfCycleCandidate: ""
      }
    }
  });

  assert.equal(result.analyzedThreads[0], thread);
});
