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

test("buildShelfCycleReadyNote strips unrelated intelligence blocks from legacy email notes", () => {
  const note = buildShelfCycleReadyNote({
    subject: "RE: Green Chemical/ ClearEdge ACS follow-up",
    externalParticipants: [
      { name: "Reminder", email: "reminder@superhuman.com", domain: "superhuman.com" },
      { email: "jhkim2@korgc.com", domain: "korgc.com" }
    ],
    draftNote: {
      type: "Email",
      title: "2026-05-12 - Green Chemical/ ClearEdge ACS follow-up",
      summary: [
        "### ClearEdge Intelligence Brief",
        "Primary Chemical Entity: RUCOLAC B-321",
        "Commercial Benchmark: $12.86/lb",
        "",
        "Thread Summary:",
        "This email thread with Reminder and jhkim2@korgc.com should be treated as a single business interaction. Main takeaway: Green Chemical followed up after ACS and introduced the monomer salesperson for EO/PO derivatives. Recommended next step: Decide whether to create Green Chemical as a supplier and add the correct contact.",
        "",
        "Key Points:",
        "- Green Chemical followed up after ACS.",
        "- Mr. Shin will follow up on EO/PO derivatives.",
        "",
        "Next Steps:",
        "- Decide whether to add Green Chemical in ShelfCycle."
      ].join("\n")
    }
  });

  assert.ok(note.summary.includes("Summary:\n- Green Chemical followed up after ACS and introduced the monomer salesperson for EO/PO derivatives."));
  assert.ok(note.summary.includes("Next step:\n- Decide whether to create Green Chemical as a supplier and add the correct contact."));
  assert.ok(note.summary.includes("Primary outside party: jhkim2@korgc.com"));
  assert.ok(!note.summary.includes("RUCOLAC"));
  assert.ok(!note.summary.includes("$12.86"));
  assert.ok(!note.summary.includes("Primary outside party: Reminder"));
});

test("buildShelfCycleReadyNote turns noisy sample-request packets into an operator-ready note", () => {
  const note = buildShelfCycleReadyNote({
    subject: "RE: Quaker color samples",
    externalParticipants: [{ name: "Jason Netherton", email: "JasonN@accessrudolftech.com" }],
    draftNote: {
      type: "Email",
      title: "2026-05-12 - Quaker color samples",
      customerName: "ACCESS Rudolf",
      summary: [
        "### ClearEdge Intelligence Brief",
        "Primary Chemical Entity: RUCOLAC B-321",
        "Commercial Benchmark: $12.86/lb (SO 030)",
        "Master Specs: Purity 100% solids",
        "",
        "Thread Summary:",
        "This email thread with ART at ACCESS Rudolf about \"Quaker color samples\" should be treated as a single business interaction. Main takeaway: Jason - Please send the B-233 and the 43000 offset to the following : All the best, Devin Hicks C: 770-851-3938 E: Devin@Clear-Edge.net https://www.clear-edge.net/. Recommended next step: Jason - Please send the B-233 and the 43000 offset to the following : All the best, Devin Hicks C: 770-851-3938 E: Devin@Clear-Edge.net https://www.clear-edge.net/.",
        "",
        "Interaction Type: Email",
        "",
        "Subject: Quaker color samples",
        "",
        "Primary Customer: ACCESS Rudolf",
        "",
        "Key Points:",
        "- Jason - Please send the B-233 and the 43000 offset to the following : All the best, Devin Hicks C: 770-851-3938 E: Devin@Clear-Edge.net https://www.clear-edge.net/",
        "- Old school CRM- bar room napkins and bidness cards. Who needs AI bullshit?? Jason Netherton CASE Director - North America JasonN@accessrudolftech.com D: +1 (803) 909-5613 M: +1 (262) 818-6287 ART",
        "- Extracted Gmail Signatures:",
        "- Jason Netherton | CASE Director - North America | ACCESS Rudolf Technologies, LP | JasonN@accessrudolftech.com | +1 803-909-5613 | https://accessrudolftech.com",
        "",
        "Next Steps:",
        "- Jason - Please send the B-233 and the 43000 offset to the following : All the best, Devin Hicks C: 770-851-3938 E: Devin@Clear-Edge.net https://www.clear-edge.net/"
      ].join("\n")
    }
  });

  assert.ok(note.summary.includes("Summary:\n- Jason was asked to send"));
  assert.ok(note.summary.includes("B-233"));
  assert.ok(note.summary.includes("43000 offset"));
  assert.ok(note.summary.includes("Decision / status:\n- Sample/material follow-up is open"));
  assert.ok(note.summary.includes("Next step:\n- Send or confirm the requested sample/material follow-up"));
  assert.ok(!note.summary.includes("RUCOLAC"));
  assert.ok(!note.summary.includes("Devin@Clear-Edge.net"));
  assert.ok(!note.summary.includes("Old school CRM"));
  assert.ok(!note.summary.includes("Extracted Gmail Signatures"));
});
