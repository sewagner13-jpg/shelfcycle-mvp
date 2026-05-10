import test from "node:test";
import assert from "node:assert/strict";

import {
  buildShelfCycleReadyNote,
  normalizeShelfCycleNoteText
} from "../src/lib/shelfcycle-ready-note.mjs";

test("buildShelfCycleReadyNote turns AI owner-read data into concise ShelfCycle note sections", () => {
  const note = buildShelfCycleReadyNote({
    subject: "Re: Dioctyltin Oxide?",
    summary: "Supplier sent document context for dioctyltin oxide.",
    externalParticipants: [{ name: "Joerg Duebel", email: "joerg@example.com" }],
    briefAi: {
      action: "Review the document request and decide whether to attach SDS, TDS, COA, or specs to the product record.",
      why: "Supplier thread contains compliance follow-through for dioctyltin oxide.",
      keyDetails: ["Dioctyltin Oxide", "Document request", "SDS/TDS/COA/spec review"],
      shelfCycleCandidate: {
        shouldConsider: true,
        title: "Dioctyltin Oxide document follow-up",
        summary: "Record whether the required product documents were received and attached.",
        fields: ["Product: Dioctyltin Oxide", "Documents: SDS, TDS, COA, specs"]
      }
    },
    workspaceArtifacts: {
      attachments: [{ filename: "Dioctyltin-Oxide-SDS.pdf", mimeType: "application/pdf" }]
    }
  });

  assert.equal(note.title, "Dioctyltin Oxide document follow-up");
  assert.equal(note.source, "openai_brief_ai");
  assert.ok(note.summary.includes("Summary:\n- Supplier thread contains compliance follow-through for dioctyltin oxide."));
  assert.ok(note.summary.includes("Decision / status:\n- Record whether the required product documents were received and attached."));
  assert.ok(note.summary.includes("Key variables:"));
  assert.ok(note.summary.includes("- Product: Dioctyltin Oxide"));
  assert.ok(note.summary.includes("Documents referenced:\n- Dioctyltin-Oxide-SDS.pdf"));
  assert.ok(note.summary.includes("Source:\n- Email/thread: Re: Dioctyltin Oxide?"));
});

test("normalizeShelfCycleNoteText preserves useful line breaks while cleaning whitespace and entities", () => {
  assert.equal(
    normalizeShelfCycleNoteText("Summary:\r\n- PO &amp; ETA   confirmed.\n\n\nNext step:\n- Send SDS."),
    "Summary:\n- PO & ETA confirmed.\n\nNext step:\n- Send SDS."
  );
});

test("buildShelfCycleReadyNote keeps legacy review packets readable", () => {
  const note = buildShelfCycleReadyNote({
    subject: "Re: Ottopol K-12T Update",
    summary: [
      "Interaction Type: Email",
      "",
      "Subject: Ottopol K-12T Update",
      "",
      "External Participants:",
      "- Robert Gellner",
      "",
      "Matched Contacts:",
      "- Alexei Shamaev",
      "",
      "Key Points:",
      "- Robert asked whether Alexei evaluated Ottopol K-12T and if it met expectations.",
      "- Alexei said performance of the cationic resin is acceptable and pricing is needed.",
      "",
      "Next Steps:",
      "- Alexei needs pricing before the discussion can move forward."
    ].join("\n"),
    externalParticipants: [{ name: "Robert Gellner" }]
  });

  assert.ok(note.summary.includes("Summary:\n- Robert asked whether Alexei evaluated Ottopol K-12T and if it met expectations."));
  assert.ok(note.summary.includes("- Alexei said performance of the cationic resin is acceptable and pricing is needed."));
  assert.ok(note.summary.includes("Decision / status:\n- Product performance was reported as acceptable; pricing is the open follow-up."));
  assert.ok(note.summary.includes("Next step:\n- Review pricing needs and decide what pricing response should be sent."));
  assert.ok(!note.summary.includes("Interaction Type: Email"));
  assert.ok(!note.summary.includes("Matched Contacts:"));
});
