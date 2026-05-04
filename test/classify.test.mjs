import test from "node:test";
import assert from "node:assert/strict";

import { detectWorkflow } from "../src/lib/classify.mjs";

test("detectWorkflow prefers product flow for SDS-like text", () => {
  const result = detectWorkflow(`
    Safety Data Sheet
    Product Name: ACCESS Organosilane G301
    CAS: 2768-02-7
    UN/NA Number: UN1993
  `);

  assert.equal(result.workflow, "new_product");
  assert.ok(result.confidence > 0.4);
});

test("detectWorkflow prefers contact flow for contact blocks", () => {
  const result = detectWorkflow(`
    Courtney Quinn
    Purchasing
    Sun Coatings
    cquinn@suncoatings.example
    (813) 367-4444 x1903
  `);

  assert.equal(result.workflow, "new_contact");
});

test("detectWorkflow prefers email thread flow for mail headers", () => {
  const result = detectWorkflow(`
    From: Sean Wagner <sean@clear-edge.net>
    To: Kaylib Rhinehart <kaylib.rhinehart@siegwerk.com>
    Subject: Re: Silica TDS 220/230 and 932

    Please send the SDS and pricing for the offset.
  `);

  assert.equal(result.workflow, "email_thread");
});

test("detectWorkflow adds a chemical signal when known terms are present", () => {
  const result = detectWorkflow(
    `
      Internal recap
      Product discussed: RUCOSAN B-SR 100
      Need updated pricing and SDS.
    `,
    {
      knownChemicalTerms: ["RUCOSAN B-SR 100", "Benzyl Alcohol"]
    }
  );

  assert.ok(result.signals.some((item) => item.includes("RUCOSAN B-SR 100")));
});
