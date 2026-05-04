import test from "node:test";
import assert from "node:assert/strict";

import { addExclusion, filterAnalyzedThreads, normalizeBriefControl } from "../src/lib/brief-control.mjs";

test("normalizeBriefControl normalizes do-not-include values", () => {
  const control = normalizeBriefControl({
    exclude: {
      emails: [" Buyer@Example.com "],
      domains: ["https://promo.example/path"],
      phones: ["(803) 555-1212"],
      keywords: [" Newsletter "]
    }
  });

  assert.deepEqual(control.exclude.emails, ["buyer@example.com"]);
  assert.deepEqual(control.exclude.domains, ["promo.example"]);
  assert.deepEqual(control.exclude.phones, ["8035551212"]);
  assert.deepEqual(control.exclude.keywords, ["newsletter"]);
});

test("filterAnalyzedThreads excludes matching participants and keywords", () => {
  const control = normalizeBriefControl({
    exclude: {
      domains: ["spam.example"],
      phones: ["8035551212"],
      keywords: ["newsletter"]
    }
  });
  const items = [
    {
      subject: "Customer quote",
      externalParticipants: [{ email: "buyer@customer.example", domain: "customer.example" }],
      analysis: { rawExtracts: { keyPoints: ["Need quote"] } }
    },
    {
      subject: "Promo",
      externalParticipants: [{ email: "sales@spam.example", domain: "spam.example" }],
      analysis: { rawExtracts: { keyPoints: ["Cold outreach"] } }
    },
    {
      subject: "Text thread",
      externalParticipants: [{ email: "+18035551212", domain: "" }],
      analysis: { rawExtracts: { keyPoints: ["Need quote"] } }
    },
    {
      subject: "Weekly newsletter",
      externalParticipants: [{ email: "known@customer.example", domain: "customer.example" }],
      analysis: { rawExtracts: { keyPoints: ["Newsletter"] } }
    }
  ];

  assert.deepEqual(filterAnalyzedThreads(items, control), [items[0]]);
});

test("addExclusion updates the requested exclusion bucket", () => {
  const control = addExclusion(normalizeBriefControl(), {
    type: "phone",
    value: "(704) 555-0100"
  });

  assert.deepEqual(control.exclude.phones, ["7045550100"]);
});
