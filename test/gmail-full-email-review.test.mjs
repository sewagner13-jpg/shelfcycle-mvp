import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFullEmailReview,
  extractGmailMessageText,
  fetchGmailThreadReadOnly,
  sanitizeEmailBody,
  stageEmailDecision
} from "../src/lib/gmail-full-email-review.mjs";

import {
  applyFullEmailDecision,
  readFullEmailReview
} from "../src/lib/full-email-review-service.mjs";

function encode(value = "") {
  return Buffer.from(value, "utf8").toString("base64url");
}

function message({
  id,
  from,
  subject = "Pricing request",
  date = "Sat, 20 Jun 2026 10:00:00 -0400",
  internalDate = "1781964000000",
  unread = false,
  body = "",
  mimeType = "text/plain"
} = {}) {
  return {
    id,
    threadId: "thread-1",
    internalDate,
    labelIds: unread ? ["INBOX", "UNREAD"] : ["INBOX"],
    payload: {
      mimeType,
      headers: [
        { name: "From", value: from },
        { name: "Subject", value: subject },
        { name: "Date", value: date }
      ],
      body: { data: encode(body) }
    }
  };
}

test("sanitizeEmailBody strips signatures, legal disclaimers, and quoted history", () => {
  const source = [
    "Sean,",
    "Please quote 4 drums of Resin X for July delivery.",
    "",
    "Thanks,",
    "Jordan Lee",
    "Purchasing Manager",
    "+1 555 222 1000",
    "jordan@example.com",
    "",
    "Confidentiality Notice: This message is intended only for the recipient.",
    "",
    "On Fri, Jun 19, 2026 at 9:00 AM Sean wrote:",
    "> Older message"
  ].join("\n");

  assert.equal(
    sanitizeEmailBody(source),
    "Sean,\nPlease quote 4 drums of Resin X for July delivery."
  );
});

test("extractGmailMessageText prefers plain text over duplicate HTML alternatives", () => {
  const gmailMessage = {
    payload: {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: encode("Plain source") } },
        { mimeType: "text/html", body: { data: encode("<p>HTML source</p>") } }
      ]
    }
  };

  assert.equal(extractGmailMessageText(gmailMessage), "Plain source");
});

test("buildFullEmailReview selects the latest unread external message and separates history", () => {
  const thread = {
    id: "thread-1",
    messages: [
      message({
        id: "read-old",
        from: "Sean Wagner <sean@clear-edge.net>",
        internalDate: "1781950000000",
        body: "Our prior response."
      }),
      message({
        id: "unread-old",
        from: "Jordan Lee <jordan@acmechem.com>",
        internalDate: "1781960000000",
        unread: true,
        body: "First unread request.\n\nRegards,\nJordan"
      }),
      message({
        id: "unread-latest",
        from: "Jordan Lee <jordan@acmechem.com>",
        internalDate: "1781970000000",
        unread: true,
        body: "Can you also include lead time?\n\nBest,\nJordan"
      })
    ]
  };

  const review = buildFullEmailReview(thread, {
    externalParticipants: [{ email: "jordan@acmechem.com" }],
    internalDomains: ["clear-edge.net"],
    checkedAt: "2026-06-21T14:00:00.000Z"
  });

  assert.equal(review.latestRelevantMessageId, "unread-latest");
  assert.deepEqual(review.earlierUnreadMessageIds, ["unread-old"]);
  assert.deepEqual(review.readHistoryMessageIds, ["read-old"]);
  assert.equal(review.counts.earlierUnread, 1);
  assert.equal(review.messages[2].cleanBody, "Can you also include lead time?");
  assert.equal(review.gmailMutationAllowed, false);
});

test("stageEmailDecision replaces the prior message decision without Gmail mutation", () => {
  const first = stageEmailDecision([], {
    messageId: "message-1",
    decision: "follow-up",
    selectedAt: "2026-06-21T14:00:00.000Z"
  });
  const second = stageEmailDecision(first, {
    messageId: "message-1",
    decision: "FYI",
    selectedAt: "2026-06-21T15:00:00.000Z"
  });

  assert.equal(second.length, 1);
  assert.equal(second[0].decision, "fyi");
  assert.equal(second[0].status, "resolved");
  assert.equal(second[0].gmailMutationPerformed, false);
});

test("fetchGmailThreadReadOnly makes a GET request with format full", async () => {
  let captured = null;
  const result = await fetchGmailThreadReadOnly({
    threadId: "thread/with spaces",
    config: {},
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return {
        ok: true,
        json: async () => ({ id: "thread/with spaces", messages: [] })
      };
    }
  });

  assert.equal(result.id, "thread/with spaces");
  assert.equal(captured.options.method, "GET");
  assert.match(captured.url, /threads\/thread%2Fwith%20spaces\?format=full$/);
  assert.equal(captured.options.headers.authorization, "Bearer test-token");
});

test("readFullEmailReview stores only the sanitized snapshot and reuses it until refresh", async () => {
  let fetchCount = 0;
  const action = {
    id: "action-1",
    threadId: "thread-1",
    externalParticipants: [{ email: "jordan@acmechem.com" }]
  };
  const fetchThread = async () => {
    fetchCount += 1;
    return {
      id: "thread-1",
      messages: [
        message({
          id: "message-1",
          from: "Jordan Lee <jordan@acmechem.com>",
          unread: true,
          body: "Please send pricing.\n\nBest,\nJordan\n\nOn Fri, Sean wrote:\nOld body"
        })
      ]
    };
  };

  const first = await readFullEmailReview({
    action,
    gmailConfig: { user: "sean@clear-edge.net" },
    fetchThread,
    now: () => "2026-06-21T14:00:00.000Z"
  });
  const second = await readFullEmailReview({
    action,
    state: first.state,
    gmailConfig: { user: "sean@clear-edge.net" },
    fetchThread,
    now: () => "2026-06-21T15:00:00.000Z"
  });

  assert.equal(fetchCount, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(second.review.messages[0].cleanBody, "Please send pricing.");
  assert.equal("payload" in second.review.messages[0], false);
  assert.equal(second.state.sourceReviewState.reviewCount, 2);
  assert.equal(second.state.sourceReviewState.gmailMutationPerformed, false);
});

test("applyFullEmailDecision requires a checked source and stages without Gmail mutation", () => {
  assert.throws(
    () => applyFullEmailDecision({ action: { threadId: "thread-1" }, state: {}, messageId: "message-1", decision: "FYI" }),
    (error) => error.code === "SOURCE_REVIEW_REQUIRED" && error.statusCode === 409
  );

  const result = applyFullEmailDecision({
    action: { threadId: "thread-1" },
    state: {
      review: {
        threadId: "thread-1",
        sanitized: true,
        gmailMutationAllowed: false,
        messages: [{ id: "message-1", cleanBody: "Checked source" }]
      }
    },
    messageId: "message-1",
    decision: "Opportunity",
    now: () => "2026-06-21T16:00:00.000Z"
  });

  assert.equal(result.decision.decision, "opportunity");
  assert.equal(result.decision.status, "staged");
  assert.equal(result.gmailMutationPerformed, false);
});
