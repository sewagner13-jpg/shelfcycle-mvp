import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeInput } from "../src/lib/analyze.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplePath = path.resolve(__dirname, "../data/examples/reference-data.json");

async function loadExampleData() {
  return JSON.parse(await readFile(examplePath, "utf8"));
}

test("analyzeInput builds a note draft from transcript text", async () => {
  const referenceData = await loadExampleData();
  const result = analyzeInput({
    workflow: "call_report",
    referenceData,
    text: `
      Meeting transcript
      Sean: I spoke with Courtney Quinn at Sun Coatings about ACCESS Organosilane G301.
      Courtney: We need pricing and a sample this week.
      Sean: I will send pricing and line up a follow-up call.
    `
  });

  assert.equal(result.workflow, "call_report");
  assert.ok(result.draftNote.summary.includes("Sun Coatings"));
  assert.ok(result.draftNote.summary.includes("Products Discussed"));
  assert.ok(result.writePlan.destination.includes("Notes"));
});

test("analyzeInput flags TDS uploads as potential existing product updates", async () => {
  const referenceData = await loadExampleData();
  const result = analyzeInput({
    referenceData,
    text: `
      Technical Data Sheet
      Product Name: ACCESS Organosilane G301
      Supplier: ACCESS Rudolf Technologies
      CAS: 2768-02-7
    `
  });

  assert.equal(result.workflow, "new_product");
  assert.ok(result.writePlan.attachments.some((item) => item.includes("TDS")));
});

test("analyzeInput builds role-based worklists for call reports", async () => {
  const referenceData = await loadExampleData();
  const result = analyzeInput({
    workflow: "call_report",
    referenceData,
    text: `
      Call with Sun Coatings about ACCESS Organosilane G301.
      They need pricing, an SDS, and a sample this week.
      Next step: send pricing and line up the follow-up call.
    `
  });

  assert.ok(result.roleWorklists.sales.some((item) => item.includes("pricing")));
  assert.ok(result.roleWorklists.procurement.some((item) => item.includes("supplier")));
  assert.ok(result.automationIdeas.some((item) => item.includes("follow-up email")));
});

test("analyzeInput builds role-based worklists for product intake", async () => {
  const referenceData = await loadExampleData();
  const result = analyzeInput({
    referenceData,
    text: `
      Technical Data Sheet
      Product Name: ACCESS Organosilane G301
      Supplier: ACCESS Rudolf Technologies
      CAS: 2768-02-7
      Hazard Class: 3
    `
  });

  assert.ok(result.roleWorklists.owner.some((item) => item.includes("stocked")));
  assert.ok(result.roleWorklists.procurement.some((item) => item.includes("CAS")));
  assert.ok(result.automationIdeas.some((item) => item.includes("product launch checklist")));
});

test("analyzeInput turns an email thread into a note and follow-up draft", async () => {
  const referenceData = await loadExampleData();
  const result = analyzeInput({
    referenceData,
    text: `
      From: Sean Wagner <sean@clear-edge.net>
      To: Courtney Quinn <cquinn@suncoatings.example>
      Subject: Re: ACCESS Organosilane G301

      Hi Courtney,

      We still need pricing and an SDS for G301. Please also line up a sample this week.
    `
  });

  assert.equal(result.workflow, "email_thread");
  assert.equal(result.writePlan.fields.type, "Email");
  assert.ok(result.followUpDraft.subject.includes("ACCESS Organosilane G301"));
  assert.equal(result.followUpDraft.to, "cquinn@suncoatings.example");
});

test("analyzeInput enriches drafts with ClearEdge Intelligence and flags contradictions", async () => {
  const referenceData = await loadExampleData();
  referenceData.clearedgeIntelligence = [
    {
      entity: "ACCESS Organosilane G301",
      aliases: ["G301", "VTMO"],
      supplier: "ACCESS Rudolf Technologies",
      lastKnownGoodPrice: "$2.45/lb",
      masterSpecs: {
        casNumber: "2768-02-7"
      },
      logisticsNuances: ["Woodland Group prefers OBL surrender before release."],
      commercialBenchmarks: ["Previous tote business moved at $2.45/lb before freight."],
      historicalNotes: ["Prior qualification moved quickly when SDS and sample landed together."]
    }
  ];

  const result = analyzeInput({
    referenceData,
    text: `
      Technical Data Sheet
      Product Name: ACCESS Organosilane G301
      Supplier: ACCESS Rudolf Technologies
      CAS: 1111-11-1
      Current quote target is $2.65/lb.
    `
  });

  assert.equal(result.intelligenceContext.status, "matched");
  assert.ok(result.intelligenceContext.brief.includes("### ClearEdge Intelligence Brief"));
  assert.ok(result.warnings.some((item) => item.includes("CAS mismatch")));
  assert.ok(result.warnings.some((item) => item.includes("Price differs from ClearEdge benchmark")));
});

test("analyzeInput emits a learning prompt when a chemical has no ClearEdge Intelligence history", async () => {
  const referenceData = await loadExampleData();
  referenceData.clearedgeIntelligence = [];

  const result = analyzeInput({
    referenceData,
    text: `
      Technical Data Sheet
      Product Name: ClearEdge New Resin 42
      Supplier: Example Supplier Co
      CAS: 9999-99-9
    `
  });

  assert.equal(result.intelligenceContext.status, "no_historical_context");
  assert.ok(result.learningPrompt.includes("ClearEdge New Resin 42"));
  assert.ok(result.warnings.includes("No Historical Context Found in ClearEdge Intelligence."));
});

test("analyzeInput prepends ClearEdge Intelligence to email-derived note drafts", async () => {
  const referenceData = await loadExampleData();
  referenceData.clearedgeIntelligence = [
    {
      entity: "ACCESS Organosilane G301",
      aliases: ["G301"],
      supplier: "ACCESS Rudolf Technologies",
      lastKnownGoodPrice: "$2.45/lb",
      logisticsNuances: ["Woodland Group prefers OBL surrender before release."],
      commercialBenchmarks: ["Previous tote business moved at $2.45/lb before freight."]
    }
  ];

  const result = analyzeInput({
    referenceData,
    text: `
      From: Courtney Quinn <cquinn@suncoatings.example>
      To: Sean Wagner <sean@clear-edge.net>
      Subject: Re: ACCESS Organosilane G301 pricing

      We still need pricing and an SDS for G301 this week.
    `
  });

  assert.equal(result.workflow, "email_thread");
  assert.equal(result.intelligenceContext.status, "matched");
  assert.ok(result.draftNote.summary.startsWith("### ClearEdge Intelligence Brief"));
  assert.ok(result.draftNote.summary.includes("Commercial Benchmark: $2.45/lb"));
});

test("analyzeInput does not attach product intelligence from supplier name alone", async () => {
  const referenceData = await loadExampleData();
  referenceData.clearedgeIntelligence = [
    {
      entity: "RUCOLAC B-321",
      aliases: ["BYK-345", "TEGO Wet 270"],
      supplierNames: ["Rudolf"],
      lastKnownGoodPrice: "$12.86/lb (SO 030)",
      commercialBenchmarks: ["$13.13/lb for SO 120 packaging."]
    },
    {
      entity: "RUCOLAC B-547",
      aliases: ["BYK-1786", "TEGO Airex 902W"],
      supplierNames: ["Rudolf"],
      lastKnownGoodPrice: "$4.97/lb (C 1000)"
    }
  ];

  const result = analyzeInput({
    referenceData,
    text: `
      From: Jason Netherton <jason@accessrudolftech.com>
      To: Sean Wagner <sean@clear-edge.net>
      Subject: Re: sample request

      We can help on the sample request from Rudolf. Let me know the target product and package.
    `
  });

  assert.notEqual(result.intelligenceContext.status, "matched");
  assert.ok(!result.draftNote.summary.includes("$12.86/lb"));
});

test("analyzeInput uses the specific product identity when a shared supplier has many intelligence entries", async () => {
  const referenceData = await loadExampleData();
  referenceData.clearedgeIntelligence = [
    {
      entity: "RUCOLAC B-321",
      aliases: ["BYK-345", "TEGO Wet 270"],
      supplierNames: ["Rudolf"],
      lastKnownGoodPrice: "$12.86/lb (SO 030)"
    },
    {
      entity: "RUCOLAC B-547",
      aliases: ["BYK-1786", "TEGO Airex 902W"],
      supplierNames: ["Rudolf"],
      lastKnownGoodPrice: "$4.97/lb (C 1000)"
    }
  ];

  const result = analyzeInput({
    referenceData,
    text: `
      From: Jason Netherton <jason@accessrudolftech.com>
      To: Sean Wagner <sean@clear-edge.net>
      Subject: Re: RUCOLAC B-547 pricing

      Please confirm current pricing for RUCOLAC B-547.
    `
  });

  assert.equal(result.intelligenceContext.status, "matched");
  assert.equal(result.intelligenceContext.matchedEntry.entity, "RUCOLAC B-547");
  assert.ok(result.draftNote.summary.includes("$4.97/lb"));
  assert.ok(!result.draftNote.summary.includes("$12.86/lb"));
});
