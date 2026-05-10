import test from "node:test";
import assert from "node:assert/strict";

import {
  researchCompanyPublicInfo,
  researchCustomerPublicInfo,
  resolveCustomerWebEnrichmentConfig
} from "../src/lib/customer-web-enrichment.mjs";

test("resolveCustomerWebEnrichmentConfig enables only when an API key exists", () => {
  assert.equal(resolveCustomerWebEnrichmentConfig({ enabled: true, apiKey: "test-key" }).enabled, true);
  assert.equal(resolveCustomerWebEnrichmentConfig({ enabled: true, apiKey: "" }).enabled, false);
  assert.equal(resolveCustomerWebEnrichmentConfig({ enabled: false, apiKey: "test-key" }).enabled, false);
});

test("researchCustomerPublicInfo calls Responses web search and preserves existing fields when research is blank", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });

    return {
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            fields: {
              name: "Surface Koatings, Inc",
              email: "",
              website: "https://surfacekoatings.com",
              phoneNumber: "",
              streetAddress: "123 Industrial Way",
              streetAddress2: "",
              city: "Newberry",
              stateRegion: "SC",
              zip: "29108",
              country: "United States"
            },
            confidence: 0.86,
            citations: [
              { title: "Surface Koatings", url: "https://surfacekoatings.com/contact" }
            ],
            sourceNotes: ["Address found on public contact page."],
            warnings: ["No public email verified."]
          })
        };
      }
    };
  };

  const result = await researchCustomerPublicInfo({
    reviewAction: {
      subject: "Surface Koatings contact",
      externalParticipants: [{ email: "erin@surfacekoatings.com", domain: "surfacekoatings.com" }]
    },
    fields: {
      name: "Surface Koatings, Inc",
      email: "erin@surfacekoatings.com"
    },
    config: { enabled: true, apiKey: "test-key", model: "test-model" },
    fetchImpl
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].body.model, "test-model");
  assert.equal(calls[0].body.tools[0].type, "web_search");
  assert.equal(calls[0].body.text.format.type, "json_schema");
  assert.equal(result.ok, true);
  assert.equal(result.fields.email, "erin@surfacekoatings.com");
  assert.equal(result.fields.city, "Newberry");
  assert.equal(result.citations[0].url, "https://surfacekoatings.com/contact");
});

test("researchCompanyPublicInfo can research supplier public fields without internal terms", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });

    return {
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            fields: {
              name: "Siegwerk",
              email: "",
              website: "https://www.siegwerk.com",
              phone: "+49 2241 3040",
              street1: "Alfred-Keller-Strasse 55",
              street2: "",
              city: "Siegburg",
              country: "Germany",
              stateRegion: "",
              zip: "53721"
            },
            confidence: 0.82,
            citations: [
              { title: "Siegwerk Contact", url: "https://www.siegwerk.com/en/contact/" }
            ],
            sourceNotes: ["Supplier headquarters details found on public website."],
            warnings: ["No public direct supplier contact email verified."]
          })
        };
      }
    };
  };

  const result = await researchCompanyPublicInfo({
    recordType: "supplier",
    reviewAction: {
      subject: "Pigment supplier follow-up",
      externalParticipants: [{ email: "kaylib.rhinehart@siegwerk.com", domain: "siegwerk.com" }]
    },
    fields: {
      name: "Siegwerk",
      email: "kaylib.rhinehart@siegwerk.com"
    },
    config: { enabled: true, apiKey: "test-key", model: "test-model" },
    fetchImpl
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.text.format.name, "clearedge_supplier_public_research");
  assert.ok(calls[0].body.input.includes("New Supplier form"));
  assert.ok(calls[0].body.input.includes("Payment Terms"));
  assert.equal(result.ok, true);
  assert.equal(result.fields.email, "kaylib.rhinehart@siegwerk.com");
  assert.equal(result.fields.phone, "+49 2241 3040");
  assert.equal(result.fields.street1, "Alfred-Keller-Strasse 55");
  assert.equal(result.citations[0].url, "https://www.siegwerk.com/en/contact/");
});
