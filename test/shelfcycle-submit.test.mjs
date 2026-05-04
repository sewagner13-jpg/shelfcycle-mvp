import test from "node:test";
import assert from "node:assert/strict";

import { collectExecutableActions, getNoteSubmissionTarget } from "../src/lib/shelfcycle-submit.mjs";

test("getNoteSubmissionTarget builds a customer note submission payload", () => {
  const target = getNoteSubmissionTarget({
    subject: "Re: G301 pricing",
    draftNote: {
      title: "2026-05-04 - Re: G301 pricing",
      type: "Email",
      summary: "Pricing and SDS still needed."
    },
    writePlan: {
      fields: {
        date: "2026-05-04",
        type: "Email",
        title: "2026-05-04 - Re: G301 pricing",
        summary: "Pricing and SDS still needed."
      }
    },
    matches: {
      customer: [
        {
          score: 0.99,
          candidate: {
            id: "cust-123",
            name: "Sun Coatings"
          }
        }
      ]
    }
  });

  assert.equal(target.customerId, "cust-123");
  assert.equal(target.customerName, "Sun Coatings");
  assert.equal(target.fields.type, "Email");
  assert.equal(target.url, "https://app.shelfcycle.com/org-clearedge/customers/cust-123/notes");
});

test("getNoteSubmissionTarget prefers approved AI ShelfCycle candidate text when available", () => {
  const target = getNoteSubmissionTarget({
    subject: "Re: PO #23017 Benzyl Alcohol",
    briefAi: {
      action: "Confirm the PO and release plan.",
      why: "Customer sent a real PO for benzyl alcohol totes.",
      keyDetails: ["20 totes", "FOB Savannah"],
      shelfCycleCandidate: {
        shouldConsider: true,
        recordType: "customer note",
        title: "PO #23017 Benzyl Alcohol",
        summary: "Record PO and release details after approval.",
        fields: ["PO #23017", "Benzyl Alcohol", "20 totes"]
      }
    },
    draftNote: {
      title: "Old draft title",
      type: "Email",
      summary: "Original parser summary."
    },
    matches: {
      customer: [
        {
          score: 0.99,
          candidate: {
            id: "cust-123",
            name: "Sun Coatings"
          }
        }
      ]
    }
  });

  assert.equal(target.fields.title, "PO #23017 Benzyl Alcohol");
  assert.ok(target.fields.summary.includes("ShelfCycle candidate: Record PO and release details after approval."));
  assert.ok(target.fields.summary.includes("Recommended action: Confirm the PO and release plan."));
  assert.ok(target.fields.summary.includes("Suggested field: PO #23017"));
  assert.ok(target.fields.summary.includes("Original draft: Original parser summary."));
});

test("collectExecutableActions exposes note creation only when a matched customer id exists", () => {
  const executable = collectExecutableActions({
    draftNote: {
      title: "Draft title",
      summary: "Draft summary"
    },
    matches: {
      customer: [
        {
          candidate: {
            id: "cust-123",
            name: "Sun Coatings"
          }
        }
      ]
    }
  });

  assert.equal(executable.length, 1);
  assert.equal(executable[0].key, "create_note");
});

test("collectExecutableActions stays empty when the note cannot be submitted safely", () => {
  const executable = collectExecutableActions({
    draftNote: {
      title: "Draft title",
      summary: "Draft summary"
    },
    matches: {
      customer: [
        {
          candidate: {
            name: "Sun Coatings"
          }
        }
      ]
    }
  });

  assert.equal(executable.length, 0);
});
