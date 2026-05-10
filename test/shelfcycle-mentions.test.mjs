import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMentionInsertionPlan,
  collectNoteMentionCandidates
} from "../src/lib/shelfcycle-mentions.mjs";

function reviewActionWithMatches() {
  return {
    matches: {
      contacts: [
        {
          candidate: {
            id: "contact-1",
            name: "Erin Christos",
            email: "erin@surfkoat.com",
            title: "Purchasing Manager"
          }
        },
        {
          candidate: {
            id: "contact-1",
            name: "Erin Christos",
            email: "erin@surfkoat.com"
          }
        }
      ],
      products: [
        {
          candidate: {
            id: "product-drum",
            code: "RucoB591-D",
            name: "Rucolac B-591"
          }
        },
        {
          candidate: {
            id: "product-tote",
            code: "RucoB591-T",
            name: "Rucolac B-591"
          }
        }
      ]
    }
  };
}

test("collectNoteMentionCandidates includes customer, deduped contacts, and matched products", () => {
  const mentions = collectNoteMentionCandidates(reviewActionWithMatches(), {
    selectedTarget: {
      kind: "customer",
      id: "customer-1",
      label: "Surface Koatings, Inc"
    }
  });

  assert.deepEqual(mentions.map((mention) => `${mention.kind}:${mention.label}`), [
    "customer:Surface Koatings, Inc",
    "contact:Erin Christos",
    "product:RucoB591-D",
    "product:RucoB591-T"
  ]);
});

test("buildMentionInsertionPlan replaces natural occurrences and appends missing related records", () => {
  const mentions = collectNoteMentionCandidates(reviewActionWithMatches(), {
    selectedTarget: {
      kind: "customer",
      id: "customer-1",
      label: "Surface Koatings, Inc"
    }
  });
  const plan = buildMentionInsertionPlan(
    "Erin Christos confirmed Surface Koatings prefers drums for Rucolac B-591.",
    mentions
  );

  assert.equal(plan.segments.filter((segment) => segment.type === "mention").length, 4);
  assert.ok(plan.plainText.includes("@Erin Christos confirmed @Surface Koatings, Inc"));
  assert.ok(plan.plainText.includes("@RucoB591-D"));
  assert.ok(plan.plainText.includes("Related records:\n@RucoB591-T\n"));
});

test("buildMentionInsertionPlan starts appended related mentions on a new line", () => {
  const plan = buildMentionInsertionPlan("Follow up with Erin.", [
    {
      kind: "contact",
      id: "contact-1",
      label: "Blake Grindstaff",
      aliases: ["Blake Grindstaff"],
      source: "matches.contacts"
    },
    {
      kind: "product",
      id: "product-1",
      label: "RucoB591-T",
      aliases: ["RucoB591-T"],
      source: "matches.products"
    }
  ]);

  assert.match(plan.plainText, /\n\nRelated records:\n@Blake Grindstaff\n@RucoB591-T\n$/);
});

test("buildMentionInsertionPlan sorts aliases longest-first", () => {
  const plan = buildMentionInsertionPlan("Rucolac B-591 needs follow-up.", [
    {
      kind: "product",
      id: "product-1",
      label: "RucoB591-D",
      aliases: ["B-591", "Rucolac B-591"],
      source: "matches.products"
    }
  ]);

  assert.equal(plan.plainText, "@RucoB591-D needs follow-up.");
});
