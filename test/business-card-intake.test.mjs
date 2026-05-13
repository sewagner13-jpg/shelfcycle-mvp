import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeBusinessCard,
  createBusinessCardReviewAction,
  extractBusinessCardWithAi,
  parseBusinessCardTextFallback
} from "../src/lib/business-card-intake.mjs";

test("parseBusinessCardTextFallback extracts basic contact and company fields", () => {
  const fields = parseBusinessCardTextFallback(`
    Blake Grindstaff
    Sales Manager
    Surface Koatings, Inc
    blake@surfacekoatings.com
    803-555-1212
    www.surfacekoatings.com
    123 Industrial Drive
    Newberry, SC 29108
  `);

  assert.equal(fields.personName, "Blake Grindstaff");
  assert.equal(fields.title, "Sales Manager");
  assert.equal(fields.companyName, "Surface Koatings, Inc");
  assert.equal(fields.email, "blake@surfacekoatings.com");
  assert.equal(fields.website, "https://www.surfacekoatings.com");
  assert.equal(fields.city, "Newberry");
  assert.equal(fields.stateRegion, "SC");
});

test("parseBusinessCardTextFallback extracts international phone numbers", () => {
  const fields = parseBusinessCardTextFallback(`
    Doyun Kim
    Manager | Chemical Sales team
    Green Chemical
    Tel: +82-2-3158-8827
    C.P +82-10-8824-7318
    http://www.korgc.com
  `);

  assert.equal(fields.personName, "Doyun Kim");
  assert.equal(fields.companyName, "Green Chemical");
  assert.equal(fields.phone, "+82-2-3158-8827");
  assert.equal(fields.mobilePhone, "+82-10-8824-7318");
  assert.equal(fields.website, "http://www.korgc.com");
});


test("analyzeBusinessCard proposes customer prospect plus contact when no customer match exists", async () => {
  const result = await analyzeBusinessCard({
    text: `
      Jane Buyer
      Purchasing Manager
      New Coatings LLC
      jane@newcoatings.example
      555-555-1212
      newcoatings.example
    `,
    relationshipHint: "customer_prospect",
    useWebResearch: false,
    referenceData: {
      customers: [],
      suppliers: [],
      contacts: []
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.fields.relationshipType, "customer_prospect");
  assert.equal(result.suggestedCreates.some((item) => item.type === "customer" && item.prospect === true), true);
  assert.equal(result.suggestedCreates.some((item) => item.type === "contact" && item.companyType === "Customer"), true);
  const action = createBusinessCardReviewAction({ analysis: result, baseUrl: "http://localhost:4318" });
  const customerAction = action.proposedActions.find((item) => item.actionType === "customer_create");
  const contactAction = action.proposedActions.find((item) => item.actionType === "contact_create");
  assert.equal(customerAction.fieldValues.email, "");
  assert.equal(customerAction.fieldValues.phoneNumber, "");
  assert.equal(contactAction.fieldValues.email, "jane@newcoatings.example");
  assert.equal(contactAction.fieldValues.phone, "555-555-1212");
});

test("analyzeBusinessCard proposes supplier plus supplier contact when hinted supplier", async () => {
  const result = await analyzeBusinessCard({
    text: `
      Kunal Butala
      Sales Director
      MAK Chemicals
      kunal@makchem.example
      Mobile: 555-555-2222
      makchem.example
    `,
    relationshipHint: "supplier",
    useWebResearch: false,
    referenceData: {
      customers: [],
      suppliers: [],
      contacts: []
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.fields.relationshipType, "supplier");
  assert.equal(result.suggestedCreates.some((item) => item.type === "supplier"), true);
  const contact = result.suggestedCreates.find((item) => item.type === "contact");
  assert.equal(contact.companyType, "Supplier");
  assert.equal(contact.phone, "555-555-2222");
  assert.deepEqual(contact.documentTypes, ["Purchase Orders", "Bills", "Marketing", "Logistics", "Warehouse", "Call Reports"]);
  const action = createBusinessCardReviewAction({ analysis: result, baseUrl: "http://localhost:4318" });
  const supplierAction = action.proposedActions.find((item) => item.actionType === "supplier_create");
  const contactAction = action.proposedActions.find((item) => item.actionType === "contact_create");
  assert.equal(supplierAction.fieldValues.email, "kunal@makchem.example");
  assert.equal(supplierAction.fieldValues.phone, "555-555-2222");
  assert.equal(supplierAction.fieldValues.website, "https://makchem.example");
  assert.equal(contactAction.fieldValues.email, "kunal@makchem.example");
  assert.equal(contactAction.fieldValues.phone, "555-555-2222");
});

test("analyzeBusinessCard avoids duplicate company create when existing customer matches", async () => {
  const result = await analyzeBusinessCard({
    text: `
      Erin Christos
      Purchasing
      Surface Koatings, Inc
      erin@surfacekoatings.com
    `,
    relationshipHint: "customer_prospect",
    useWebResearch: false,
    referenceData: {
      customers: [
        {
          id: "customer-123",
          name: "Surface Koatings, Inc",
          website: "https://surfacekoatings.com"
        }
      ],
      suppliers: [],
      contacts: []
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.suggestedCreates.some((item) => item.type === "customer"), false);
  assert.equal(result.suggestedCreates.some((item) => item.type === "contact"), true);
  assert.equal(result.existingCustomer.name, "Surface Koatings, Inc");
});

test("analyzeBusinessCard contact-only mode adds contact to an existing customer without creating customer", async () => {
  const result = await analyzeBusinessCard({
    text: `
      Blake Grindstaff
      Sales Manager
      Surface Koatings, Inc
      blake@surfacekoatings.com
    `,
    entryMode: "existing_customer_contact",
    existingCompanyLabel: "Surface Koatings, Inc",
    useWebResearch: false,
    referenceData: {
      customers: [],
      suppliers: [],
      contacts: []
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.fields.relationshipType, "customer_prospect");
  assert.equal(result.suggestedCreates.some((item) => item.type === "customer"), false);
  const contact = result.suggestedCreates.find((item) => item.type === "contact");
  assert.equal(contact.companyType, "Customer");
  assert.equal(contact.companyName, "Surface Koatings, Inc");
  assert.equal(result.existingCompanyTarget.kind, "customer");
  const action = createBusinessCardReviewAction({ analysis: result, baseUrl: "http://localhost:4318" });
  assert.equal(action.proposedActions.some((item) => item.actionType === "customer_create"), false);
  const contactAction = action.proposedActions.find((item) => item.actionType === "contact_create");
  assert.equal(contactAction.executable, true);
  assert.equal(contactAction.selectedTarget.label, "Surface Koatings, Inc");
});

test("analyzeBusinessCard contact-only mode uses extracted company as existing target when no separate label is typed", async () => {
  const result = await analyzeBusinessCard({
    text: `
      Rick Greene
      Regional Sales Manager
      Prom USA, Inc.
      rgreene@prombiocides.com
    `,
    entryMode: "existing_customer_contact",
    useWebResearch: false,
    referenceData: {
      customers: [],
      suppliers: [],
      contacts: []
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.suggestedCreates.some((item) => item.type === "customer"), false);
  assert.equal(result.existingCompanyTarget.label, "Prom USA, Inc.");
  const action = createBusinessCardReviewAction({ analysis: result, baseUrl: "http://localhost:4318" });
  const contactAction = action.proposedActions.find((item) => item.actionType === "contact_create");
  assert.equal(contactAction.executable, true);
  assert.equal(contactAction.selectedTarget.label, "Prom USA, Inc.");
});

test("analyzeBusinessCard contact-only mode adds contact to an existing supplier without creating supplier", async () => {
  const result = await analyzeBusinessCard({
    text: `
      Kunal Butala
      Sales Director
      MAK Chemicals
      kunal@makchem.example
    `,
    entryMode: "existing_supplier_contact",
    existingCompanyLabel: "MAK Chemicals",
    useWebResearch: false,
    referenceData: {
      customers: [],
      suppliers: [],
      contacts: []
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.fields.relationshipType, "supplier");
  assert.equal(result.suggestedCreates.some((item) => item.type === "supplier"), false);
  const contact = result.suggestedCreates.find((item) => item.type === "contact");
  assert.equal(contact.companyType, "Supplier");
  assert.equal(contact.companyName, "MAK Chemicals");
  assert.equal(result.existingCompanyTarget.kind, "supplier");
  const action = createBusinessCardReviewAction({ analysis: result, baseUrl: "http://localhost:4318" });
  assert.equal(action.proposedActions.some((item) => item.actionType === "supplier_create"), false);
  const contactAction = action.proposedActions.find((item) => item.actionType === "contact_create");
  assert.equal(contactAction.executable, true);
  assert.equal(contactAction.selectedTarget.label, "MAK Chemicals");
});

test("createBusinessCardReviewAction produces approval-first review packet with executable actions", async () => {
  const analysis = await analyzeBusinessCard({
    text: `
      Blake Grindstaff
      Sales Manager
      Surface Koatings, Inc
      blake@surfacekoatings.com
    `,
    relationshipHint: "customer_prospect",
    useWebResearch: false,
    referenceData: {
      customers: [],
      suppliers: [],
      contacts: []
    }
  });
  const action = createBusinessCardReviewAction({ analysis, baseUrl: "http://localhost:4318" });

  assert.equal(action.workflow, "business_card");
  assert.ok(action.reviewUrl.includes("/review-action.html?id="));
  assert.equal(action.proposedActions.some((item) => item.actionType === "customer_create" && item.executable), true);
  assert.equal(action.proposedActions.some((item) => item.actionType === "contact_create"), true);
  assert.match(action.writePlan.warning, /No ShelfCycle write/);
});

test("extractBusinessCardWithAi uses Responses image input, web search, and preserves blanks", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });

    return {
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            fields: {
              personName: "Blake Grindstaff",
              title: "Sales Manager",
              email: "blake@surfacekoatings.com",
              phone: "",
              mobilePhone: "",
              faxPhone: "",
              companyName: "Surface Koatings, Inc",
              website: "https://surfacekoatings.com",
              streetAddress: "",
              streetAddress2: "",
              city: "",
              stateRegion: "",
              zip: "",
              country: "",
              relationshipSuggestion: "customer_prospect",
              confidence: 0.84
            },
            citations: [
              { title: "Surface Koatings", url: "https://surfacekoatings.com" }
            ],
            sourceNotes: ["Website verified."],
            warnings: ["No public address verified."]
          })
        };
      }
    };
  };

  const result = await extractBusinessCardWithAi({
    imageDataUrl: "data:image/png;base64,abc123",
    text: "Blake Grindstaff Surface Koatings",
    relationshipHint: "customer_prospect",
    useWebResearch: true,
    config: { enabled: true, apiKey: "test-key", model: "test-model" },
    fetchImpl
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, "test-model");
  assert.equal(calls[0].body.tools[0].type, "web_search");
  assert.equal(calls[0].body.input[0].content.some((item) => item.type === "input_image"), true);
  assert.equal(result.ok, true);
  assert.equal(result.fields.phone, "");
  assert.equal(result.fields.website, "https://surfacekoatings.com");
  assert.equal(result.warnings[0], "No public address verified.");
});

test("analyzeBusinessCard returns a structured failure when image-only AI extraction times out", async () => {
  const fetchImpl = async (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => reject(new Error("aborted by test")), { once: true });
  });

  const result = await analyzeBusinessCard({
    imageDataUrl: "data:image/jpeg;base64,abc123",
    text: "",
    relationshipHint: "supplier",
    useWebResearch: false,
    config: {
      enabled: true,
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 1
    },
    fetchImpl
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "OPENAI_VISION_FAILED");
  assert.match(result.warnings.join(" "), /timed out after 1ms/);
});
