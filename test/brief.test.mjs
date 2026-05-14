import test from "node:test";
import assert from "node:assert/strict";

import { buildDailyBrief } from "../src/lib/daily-brief.mjs";
import { analyzeThread } from "../src/lib/email-triage.mjs";
import { createKnowledgeBundle } from "../src/lib/knowledge-bundle.mjs";

function encodeBody(text = "") {
  return Buffer.from(text, "utf8").toString("base64url");
}

function makeMessage({
  id,
  threadId,
  from,
  to,
  subject,
  body,
  snippet,
  timestamp,
  labelIds = []
}) {
  return {
    id,
    threadId,
    labelIds,
    snippet,
    internalDate: String(timestamp),
    payload: {
      headers: [
        { name: "From", value: from },
        { name: "To", value: to },
        { name: "Subject", value: subject }
      ],
      body: {
        data: encodeBody(body)
      }
    }
  };
}

function decodedChatGptPromptFromBrief(brief = "") {
  const match = brief.match(/href="https:\/\/chatgpt\.com\/\?q=([^"]+)"/);

  assert.ok(match, "Expected a ChatGPT decision link in the brief.");
  return decodeURIComponent(match[1].replace(/&amp;/g, "&"));
}

test("createKnowledgeBundle builds lookup maps from reference data", () => {
  const bundle = createKnowledgeBundle({
    referenceData: {
      customers: [{ name: "Sun Coatings", website: "https://suncoatings.example" }],
      contacts: [
        { name: "Courtney Quinn", email: "cquinn@suncoatings.example", mobilePhone: "(813) 555-0111", companyType: "Customer" },
        { name: "Scott Waterman", email: "scott.waterman@ncs.co.za", companyName: "NCS Resins", companyType: "Supplier" },
        { name: "Accounting", email: "accounting@accessrudolftech.com", companyName: "ACCESS Rudolf", companyType: "Customer" },
        { name: "COA", email: "coa@accessrudolftech.com", officePhone: "704-555-0199", companyName: "ACCESS Rudolf Technologies", companyType: "Supplier" }
      ],
      products: [{ code: "G301", name: "ACCESS Organosilane G301", supplier: "ACCESS Rudolf Technologies" }],
      locations: [],
      clearedgeIntelligence: [
        {
          entity: "ACCESS Organosilane G301",
          aliases: ["G301", "VTMO"],
          supplier: "ACCESS Rudolf Technologies"
        }
      ]
    },
    opsVendors: [{ name: "ADP", domain: "adp.com" }],
    internalUsers: [{ name: "Sean Wagner", email: "sean@clear-edge.net" }]
  });

  assert.ok(bundle.lookups.customerDomains.includes("suncoatings.example"));
  assert.ok(bundle.lookups.contactEmails.includes("cquinn@suncoatings.example"));
  assert.ok(bundle.lookups.customerContactEmails.includes("cquinn@suncoatings.example"));
  assert.ok(bundle.lookups.supplierContactEmails.includes("scott.waterman@ncs.co.za"));
  assert.ok(bundle.lookups.customerContactPhones.includes("8135550111"));
  assert.ok(bundle.lookups.supplierContactPhones.includes("7045550199"));
  assert.ok(bundle.lookups.supplierDomains.includes("ncs.co.za"));
  assert.ok(bundle.lookups.supplierNames.includes("NCS Resins"));
  assert.ok(bundle.lookups.supplierNames.includes("ACCESS Rudolf Technologies"));
  assert.ok(!bundle.lookups.customerDomains.includes("accessrudolftech.com"));
  assert.ok(bundle.lookups.opsVendorDomains.includes("adp.com"));
  assert.ok(bundle.lookups.opsVendorNames.includes("ADP"));
  assert.ok(bundle.lookups.notebookEntityAliases.includes("G301"));
  assert.ok(bundle.normalizedProducts.length === 1);
  assert.equal(bundle.clearedgeIntelligence[0].entity, "ACCESS Organosilane G301");
});

test("analyzeThread classifies customer thread and detects waiting state", () => {
  const bundle = createKnowledgeBundle({
    referenceData: {
      customers: [{ name: "Sun Coatings", website: "https://suncoatings.example" }],
      contacts: [{ name: "Courtney Quinn", email: "cquinn@suncoatings.example", companyType: "Customer" }],
      products: [{ code: "G301", name: "ACCESS Organosilane G301", supplier: "ACCESS Rudolf Technologies" }],
      locations: []
    },
    internalUsers: [{ name: "Sean Wagner", email: "sean@clear-edge.net" }]
  });
  const thread = {
    id: "thread-1",
    messages: [
      makeMessage({
        id: "m1",
        threadId: "thread-1",
        from: "Courtney Quinn <cquinn@suncoatings.example>",
        to: "Sean Wagner <sean@clear-edge.net>",
        subject: "Re: ACCESS Organosilane G301",
        body: "Can you send pricing and an SDS for G301?",
        snippet: "Can you send pricing and an SDS for G301?",
        timestamp: Date.UTC(2026, 4, 2, 12, 0, 0)
      }),
      makeMessage({
        id: "m2",
        threadId: "thread-1",
        from: "Sean Wagner <sean@clear-edge.net>",
        to: "Courtney Quinn <cquinn@suncoatings.example>",
        subject: "Re: ACCESS Organosilane G301",
        body: "Yes, I will send pricing and the SDS this afternoon.",
        snippet: "Yes, I will send pricing and the SDS this afternoon.",
        timestamp: Date.UTC(2026, 4, 2, 15, 0, 0)
      })
    ]
  };

  const result = analyzeThread(thread, bundle);

  assert.equal(result.relationship.relationship, "customer");
  assert.equal(result.state.state, "waiting_on_other_side");
  assert.ok(result.analysis.draftNote.summary.includes("ACCESS Organosilane G301"));
});

test("analyzeThread treats unknown business inquiries as potential customers instead of suppliers", () => {
  const bundle = createKnowledgeBundle({
    referenceData: {
      customers: [],
      contacts: [],
      products: [{ code: "G301", name: "ACCESS Organosilane G301" }],
      locations: []
    },
    internalUsers: [{ name: "Sean Wagner", email: "sean@clear-edge.net" }]
  });
  const thread = {
    id: "thread-potential-customer",
    messages: [
      makeMessage({
        id: "m-potential",
        threadId: "thread-potential-customer",
        from: "New Buyer <buyer@newcoatings.example>",
        to: "Sean Wagner <sean@clear-edge.net>",
        subject: "G301 quote and SDS request",
        body: "Can you quote ACCESS Organosilane G301 and send the SDS? We may need a sample next week.",
        snippet: "Can you quote G301 and send the SDS?",
        timestamp: Date.UTC(2026, 4, 2, 12, 0, 0)
      })
    ]
  };

  const result = analyzeThread(thread, bundle);

  assert.equal(result.relationship.relationship, "customer");
  assert.equal(result.relationship.subtype, "potential_customer");
  assert.ok(result.relationship.reasons[0].includes("business inquiry"));
});

test("analyzeThread keeps generic PO and SDS language out of supplier identity matching", () => {
  const bundle = createKnowledgeBundle({
    referenceData: {
      customers: [{ name: "Sun Coatings", website: "https://suncoatings.example" }],
      contacts: [{ name: "Courtney Quinn", email: "cquinn@suncoatings.example", companyType: "Customer" }],
      products: [],
      locations: []
    },
    suppliers: [{ name: "St. Louis Group", domain: "thestlouisgroup.com" }],
    internalUsers: [{ name: "Sean Wagner", email: "sean@clear-edge.net" }]
  });
  const thread = {
    id: "thread-customer-po",
    messages: [
      makeMessage({
        id: "m-customer-po",
        threadId: "thread-customer-po",
        from: "Courtney Quinn <cquinn@suncoatings.example>",
        to: "Sean Wagner <sean@clear-edge.net>",
        subject: "PO and SDS request",
        body: "Please confirm our PO and send the SDS. We also discussed St. Louis Group freight timing.",
        snippet: "Please confirm our PO and send the SDS.",
        timestamp: Date.UTC(2026, 4, 2, 12, 0, 0)
      })
    ]
  };

  const result = analyzeThread(thread, bundle);

  assert.equal(result.relationship.relationship, "customer");
  assert.equal(result.relationship.subtype, "core_customer");
});

test("analyzeThread turns extracted Gmail signatures into supplier and contact create candidates", () => {
  const thread = {
    id: "thread-green-chemical",
    messages: [
      {
        id: "msg-green-chemical",
        threadId: "thread-green-chemical",
        internalDate: String(Date.parse("2026-05-12T10:00:00Z")),
        snippet: "It was a pleasure talking with you at the show. I have CCed our Monomer Salesperson.",
        payload: {
          headers: [
            { name: "From", value: "Doyun Kim <dykim1@korgc.com>" },
            { name: "To", value: "Sean Wagner <sean@clear-edge.net>" },
            { name: "Subject", value: "RE: Green Chemical/ ClearEdge ACS follow-up" }
          ],
          body: {
            data: encodeBody("It was a pleasure talking with you at the show. I have CCed our Monomer Salesperson.")
          }
        }
      }
    ],
    workspaceArtifacts: {
      attachments: [],
      driveFileIds: [],
      driveFiles: [],
      driveScopeAvailable: true,
      driveError: "",
      emailSignatures: [
        {
          personName: "Doyun Kim",
          title: "Manager | Chemical Sales team",
          email: "dykim1@korgc.com",
          phone: "+82-2-3158-8827",
          mobilePhone: "+82-10-8824-7318",
          faxPhone: "+82-2-3158-8820",
          companyName: "Green Chemical",
          website: "http://www.korgc.com",
          streetAddress: "15F, Changgang Building, 86, Mapo-daero, Mapo-gu, Seoul, Korea (04168)",
          city: "Seoul",
          zip: "04168",
          country: "Korea",
          confidence: 0.9
        }
      ]
    }
  };
  const analyzed = analyzeThread(thread, {
    internalDomains: ["clear-edge.net"],
    customers: [],
    suppliers: [],
    contacts: [],
    products: [],
    locations: [],
    lookups: {
      supplierDomains: [],
      supplierContactEmails: [],
      customerDomains: [],
      customerContactEmails: []
    }
  });

  const supplier = analyzed.analysis.suggestedCreates.find((item) => item.type === "supplier");
  const contact = analyzed.analysis.suggestedCreates.find((item) => item.type === "contact");

  assert.equal(supplier.companyName, "Green Chemical");
  assert.equal(supplier.website, "http://www.korgc.com");
  assert.equal(supplier.street1.includes("Mapo-daero"), true);
  assert.equal(contact.name, "Doyun Kim");
  assert.equal(contact.title, "Manager | Chemical Sales team");
  assert.equal(contact.mobilePhone, "+82-10-8824-7318");
});

test("analyzeThread keeps supplier contacts out of the customer bucket", () => {
  const bundle = createKnowledgeBundle({
    referenceData: {
      customers: [{ name: "Sun Coatings", website: "https://suncoatings.example" }],
      contacts: [{ name: "Scott Waterman", email: "scott.waterman@ncs.co.za", companyName: "NCS Resins", companyType: "Supplier" }],
      products: [],
      locations: []
    },
    suppliers: [{ name: "NCS Resins", domain: "ncs.co.za" }],
    internalUsers: [{ name: "Sean Wagner", email: "sean@clear-edge.net" }]
  });
  const thread = {
    id: "thread-2",
    messages: [
      makeMessage({
        id: "m3",
        threadId: "thread-2",
        from: "Scott Waterman <scott.waterman@ncs.co.za>",
        to: "Sean Wagner <sean@clear-edge.net>",
        subject: "443PAMVS pricing update",
        body: "Please find updated pricing and lead time attached.",
        snippet: "Please find updated pricing and lead time attached.",
        timestamp: Date.UTC(2026, 4, 2, 12, 0, 0)
      })
    ]
  };

  const result = analyzeThread(thread, bundle);

  assert.equal(result.relationship.relationship, "supplier");
  assert.equal(result.state.state, "needs_attention");
});

test("analyzeThread prioritizes the latest inbound supplier sender over customer mentions", () => {
  const bundle = createKnowledgeBundle({
    referenceData: {
      customers: [{ name: "Sun Coatings", website: "https://suncoatings.example" }],
      contacts: [{ name: "Courtney Quinn", email: "cquinn@suncoatings.example", companyType: "Customer" }],
      products: [{ code: "RUCOSAN-100", name: "RUCOSAN B-SR 100", supplier: "ACCESS Rudolf Technologies" }],
      locations: []
    },
    suppliers: [{ name: "ACCESS Rudolf Technologies", domain: "accessrudolftech.com" }],
    internalUsers: [{ name: "Sean Wagner", email: "sean@clear-edge.net" }]
  });
  const thread = {
    id: "thread-3",
    messages: [
      makeMessage({
        id: "m4",
        threadId: "thread-3",
        from: "Jason Netherton <jason@accessrudolftech.com>",
        to: "Sean Wagner <sean@clear-edge.net>",
        subject: "Re: RUCOSAN quote",
        body: "Sun Coatings wants pricing on RUCOSAN B-SR 100 and tote availability.",
        snippet: "Sun Coatings wants pricing on RUCOSAN B-SR 100 and tote availability.",
        timestamp: Date.UTC(2026, 4, 3, 17, 47, 0)
      })
    ]
  };

  const result = analyzeThread(thread, bundle);

  assert.equal(result.relationship.relationship, "supplier");
  assert.equal(result.relationship.subtype, "core_supplier");
});

test("analyzeThread classifies ops-vendor finance mail separately from core supplier mail", () => {
  const bundle = createKnowledgeBundle({
    referenceData: {
      customers: [],
      contacts: [],
      products: [],
      locations: []
    },
    opsVendors: [{ name: "ADP", domain: "adp.com" }],
    internalUsers: [{ name: "Sean Wagner", email: "sean@clear-edge.net" }]
  });
  const thread = {
    id: "thread-4",
    messages: [
      makeMessage({
        id: "m5",
        threadId: "thread-4",
        from: "RUN Payroll Invoice <run.payroll.invoice@adp.com>",
        to: "Sean Wagner <sean@clear-edge.net>",
        subject: "Your ADP Invoice 719926296",
        body: "Your payment of $82.18 is due and will be debited from your account.",
        snippet: "Your payment of $82.18 is due and will be debited from your account.",
        timestamp: Date.UTC(2026, 4, 3, 4, 19, 0)
      })
    ]
  };

  const result = analyzeThread(thread, bundle);

  assert.equal(result.relationship.relationship, "supplier");
  assert.equal(result.relationship.subtype, "ops_vendor");
  assert.equal(result.silo.name, "institutional");
  assert.equal(result.state.state, "needs_attention");
});

test("analyzeThread routes shipment coordination mail into the logistics silo", () => {
  const bundle = createKnowledgeBundle({
    referenceData: {
      customers: [],
      contacts: [{ name: "Sofia Holguin Gomez", email: "sofia@thestlouisgroup.com", companyName: "St. Louis Group", companyType: "Supplier" }],
      products: [],
      locations: []
    },
    suppliers: [{ name: "St. Louis Group", domain: "thestlouisgroup.com" }],
    internalUsers: [{ name: "Sean Wagner", email: "sean@clear-edge.net" }]
  });
  const thread = {
    id: "thread-5",
    messages: [
      makeMessage({
        id: "m6",
        threadId: "thread-5",
        from: "Sofia Holguin Gomez <sofia@thestlouisgroup.com>",
        to: "Sean Wagner <sean@clear-edge.net>",
        subject: "Container WHSU22286209 pickup appointment",
        body: "Carrier could not make it. Need to schedule appointment for live unload at the port.",
        snippet: "Need to schedule appointment for live unload at the port.",
        timestamp: Date.UTC(2026, 4, 3, 15, 30, 0)
      })
    ]
  };

  const result = analyzeThread(thread, bundle);

  assert.equal(result.relationship.relationship, "supplier");
  assert.equal(result.silo.name, "logistics");
  assert.ok(result.silo.matchedKeywords.includes("WHSU22286209"));
});

test("analyzeThread routes technical-document threads into the compliance silo", () => {
  const bundle = createKnowledgeBundle({
    referenceData: {
      customers: [{ name: "Sun Coatings", website: "https://suncoatings.example" }],
      contacts: [{ name: "Courtney Quinn", email: "cquinn@suncoatings.example", companyType: "Customer" }],
      products: [{ code: "MEA", name: "Monoethanolamine" }],
      locations: []
    },
    internalUsers: [{ name: "Sean Wagner", email: "sean@clear-edge.net" }]
  });
  const thread = {
    id: "thread-6",
    workspaceArtifacts: {
      attachments: [{ filename: "MEA-SDS.pdf", mimeType: "application/pdf" }],
      driveFileIds: [],
      driveFiles: [],
      driveScopeAvailable: true,
      driveError: ""
    },
    messages: [
      makeMessage({
        id: "m7",
        threadId: "thread-6",
        from: "Courtney Quinn <cquinn@suncoatings.example>",
        to: "Sean Wagner <sean@clear-edge.net>",
        subject: "MEA SDS request",
        body: "Please send the latest SDS and specifications for MEA.",
        snippet: "Please send the latest SDS and specifications for MEA.",
        timestamp: Date.UTC(2026, 4, 3, 16, 0, 0)
      })
    ]
  };

  const result = analyzeThread(thread, bundle);

  assert.equal(result.relationship.relationship, "customer");
  assert.equal(result.silo.name, "compliance");
});

test("analyzeThread classifies a text thread by matched contact phone", () => {
  const bundle = createKnowledgeBundle({
    referenceData: {
      customers: [{ name: "MAK Chemicals" }],
      contacts: [{ name: "Kunal Butala", mobilePhone: "732-983-6870", companyName: "MAK Chemicals", companyType: "Supplier" }],
      products: [],
      locations: []
    },
    internalUsers: [{ name: "Sean Wagner", email: "sean@clear-edge.net" }]
  });
  const thread = {
    id: "messages-chat-1",
    source: "messages",
    messages: [
      makeMessage({
        id: "sms-1",
        threadId: "messages-chat-1",
        from: "+17329836870",
        to: "Sean Wagner <sean@clear-edge.net>",
        subject: "Text thread with +17329836870",
        body: "Can you confirm benzyl alcohol availability for pickup Friday morning?",
        snippet: "Can you confirm benzyl alcohol availability for pickup Friday morning?",
        timestamp: Date.UTC(2026, 4, 4, 14, 0, 0)
      })
    ]
  };

  const result = analyzeThread(thread, bundle);

  assert.equal(result.source, "messages");
  assert.equal(result.relationship.relationship, "supplier");
  assert.equal(result.state.state, "needs_attention");
});

test("buildDailyBrief groups analyzed threads into actionable sections", () => {
  const analyzedThreads = [
    {
      threadId: "191abc123def4567",
      relationship: { relationship: "customer", subtype: "potential_customer" },
      silo: { name: "commercial" },
      state: { state: "needs_attention" },
      priorityScore: 100,
      lastTimestamp: Date.UTC(2026, 4, 2, 16, 0, 0),
      subject: "Re: G301 pricing",
      externalParticipants: [{ name: "Courtney Quinn", email: "cquinn@suncoatings.example", domain: "suncoatings.example" }],
      events: [
        {
          from: { name: "Courtney Quinn", email: "cquinn@suncoatings.example" },
          timestamp: Date.UTC(2026, 4, 1, 14, 0, 0),
          snippet: "Initial request: Sun Coatings asked for G301 pricing, SDS, and sample timing."
        },
        {
          from: { name: "Sean Wagner", email: "sean@clear-edge.net" },
          timestamp: Date.UTC(2026, 4, 1, 15, 0, 0),
          snippet: "Sean replied that he would check pricing and documents."
        },
        {
          from: { name: "Courtney Quinn", email: "cquinn@suncoatings.example" },
          timestamp: Date.UTC(2026, 4, 2, 16, 0, 0),
          snippet: "Follow-up: Courtney still needs the quote and current SDS before placing the order."
        }
      ],
      reviewUrl: "https://clearedge-daily-brief.netlify.app/review-action.html?id=abc&token=def",
      workspaceArtifacts: {
        attachments: [{ filename: "G301-SDS.pdf", mimeType: "application/pdf", messageId: "m1", attachmentId: "att1" }],
        driveFileIds: [],
        driveFiles: [],
        driveScopeAvailable: true,
        driveError: ""
      },
      briefAi: {
        action: "Review pricing and decide whether to quote Sun Coatings.",
        why: "Sun Coatings needs pricing and a current SDS for G301.",
        keyDetails: ["SDS is attached.", "Pricing is still unresolved."],
        confidence: 0.84
      },
      analysis: {
        rawExtracts: { keyPoints: ["Pricing and SDS still needed"] },
        roleWorklists: {
          owner: [],
          sales: ["Draft the pricing follow-up for Sun Coatings."],
          procurement: ["Confirm current cost basis, pack size, and supplier availability before quoting."]
        },
        suggestedCreates: [],
        warnings: [],
        draftNote: { title: "2026-05-02 - Re: G301 pricing" }
      }
    }
  ];

  const brief = buildDailyBrief({
    analyzedThreads,
    organization: "ClearEdge Solutions"
  });

  assert.ok(brief.includes("Top Actions"));
  assert.ok(brief.includes("Courtney Quinn"));
  assert.ok(brief.includes("potential customer / commercial"));
  assert.ok(brief.includes("Relationship handling"));
  assert.ok(brief.includes("Treat as potential customer/prospect"));
  assert.ok(brief.includes("<strong>Summary:</strong>"));
  assert.ok(brief.includes("<li>Sun Coatings needs pricing and a current SDS for G301.</li>"));
  assert.ok(brief.includes(">Open PDFs</a>"));
  assert.ok(brief.includes("/open-pdfs.html?id=abc&amp;token=def"));
  assert.ok(brief.includes(">Gmail</a>"));
  assert.ok(brief.includes(">Review Packet</a>"));
  assert.ok(brief.includes(">Decide in ChatGPT</a>"));
  assert.ok(!brief.includes("Gmail: https://"));
  assert.ok(!brief.includes("Review: https://"));
  assert.ok(!brief.includes("Decide in ChatGPT: https://"));
  assert.ok(brief.includes("ShelfCycle Follow-Through"));

  const chatGptPrompt = decodedChatGptPromptFromBrief(brief);

  assert.ok(chatGptPrompt.includes("Do not base the recommendation only on the most recent email."));
  assert.ok(chatGptPrompt.includes("Entire email chain summary:"));
  assert.ok(chatGptPrompt.includes("Message timeline from the chain:"));
  assert.ok(chatGptPrompt.includes("Initial request: Sun Coatings asked for G301 pricing"));
  assert.ok(chatGptPrompt.includes("Follow-up: Courtney still needs the quote"));
  assert.ok(chatGptPrompt.includes("PDFs and documents mentioned or attached:"));
  assert.ok(chatGptPrompt.includes("G301-SDS.pdf (PDF)"));
  assert.ok(chatGptPrompt.includes("Possible next-step options to consider:"));
  assert.ok(chatGptPrompt.includes("what may need to be entered into ShelfCycle after approval"));
});

test("buildDailyBrief suppresses bogus ShelfCycle follow-through for solicitations and ops vendors", () => {
  const analyzedThreads = [
    {
      relationship: { relationship: "solicitation", subtype: "newsletter" },
      silo: { name: "noise" },
      state: { state: "needs_attention" },
      lastTimestamp: Date.UTC(2026, 4, 4, 12, 0, 0),
      subject: "Trade Show Offers",
      externalParticipants: [{ name: "Promo Sender", email: "promo@example.com", domain: "example.com" }],
      analysis: {
        rawExtracts: { keyPoints: ["Cold outreach about trade show displays"] },
        roleWorklists: {
          owner: [],
          sales: ["Create 1 missing contact record(s) before the next follow-up."],
          procurement: []
        },
        suggestedCreates: [{ type: "contact", email: "promo@example.com" }],
        warnings: [],
        draftNote: { title: "2026-05-04 - Trade Show Offers" }
      }
    },
    {
      relationship: { relationship: "supplier", subtype: "ops_vendor" },
      silo: { name: "institutional" },
      state: { state: "needs_attention" },
      lastTimestamp: Date.UTC(2026, 4, 4, 11, 0, 0),
      subject: "Your ADP Invoice",
      externalParticipants: [{ name: "ADP", email: "run.payroll.invoice@adp.com", domain: "adp.com" }],
      analysis: {
        rawExtracts: { keyPoints: ["Invoice is due and will be debited"] },
        roleWorklists: {
          owner: [],
          sales: ["Turn the note into a follow-up queue for the account."],
          procurement: []
        },
        suggestedCreates: [{ type: "contact", email: "run.payroll.invoice@adp.com" }],
        warnings: [],
        draftNote: { title: "2026-05-04 - Your ADP Invoice" }
      },
      summary: "Your payment is due and will be debited from your account."
    },
    {
      relationship: { relationship: "customer", subtype: "core_customer" },
      silo: { name: "commercial" },
      state: { state: "needs_attention" },
      priorityScore: 100,
      lastTimestamp: Date.UTC(2026, 4, 4, 10, 0, 0),
      subject: "Re: G301 pricing",
      externalParticipants: [{ name: "Courtney Quinn", email: "cquinn@suncoatings.example", domain: "suncoatings.example" }],
      reviewUrl: "https://clearedge-daily-brief.netlify.app/review-action.html?id=abc&token=def",
      analysis: {
        rawExtracts: { keyPoints: ["Pricing and SDS still needed"] },
        roleWorklists: {
          owner: [],
          sales: ["Draft the pricing follow-up for Sun Coatings."],
          procurement: ["Confirm current cost basis, pack size, and supplier availability before quoting."]
        },
        suggestedCreates: [{ type: "contact", email: "newbuyer@suncoatings.example" }],
        warnings: [],
        draftNote: { title: "2026-05-04 - Re: G301 pricing", summary: "Pricing and SDS still needed" }
      }
    }
  ];

  const brief = buildDailyBrief({
    analyzedThreads,
    organization: "ClearEdge Solutions"
  });

  assert.ok(brief.includes("Review with finance or ops; no ShelfCycle update needed."));
  assert.ok(brief.includes("1 likely solicitation(s) hidden."));
  assert.ok(brief.includes("2026-05-04 - Re: G301 pricing"));
  assert.ok(brief.includes(">Review Packet</a>"));
  assert.ok(!brief.includes("Review whether 2026-05-04 - Your ADP Invoice should be logged as a ShelfCycle note or follow-up task."));
  assert.ok(!brief.includes("Review whether 2026-05-04 - Trade Show Offers should be logged as a ShelfCycle note or follow-up task."));
  assert.ok(!brief.includes("Create or review 1 new contact record(s) from 2026-05-04 - Trade Show Offers."));
});

test("buildDailyBrief surfaces ClearEdge intelligence on matched commercial threads", () => {
  const analyzedThreads = [
    {
      relationship: { relationship: "supplier", subtype: "core_supplier" },
      silo: { name: "commercial" },
      state: { state: "needs_attention" },
      priorityScore: 92,
      lastTimestamp: Date.UTC(2026, 4, 4, 9, 0, 0),
      subject: "RUCOLAC B-321 pricing",
      externalParticipants: [{ name: "Jason Netherton", email: "jason@accessrudolftech.com", domain: "accessrudolftech.com" }],
      reviewUrl: "https://clearedge-daily-brief.netlify.app/review-action.html?id=ghi&token=jkl",
      analysis: {
        rawExtracts: { keyPoints: ["Pricing update came in for RUCOLAC B-321."] },
        roleWorklists: {
          owner: [],
          sales: ["Review the new price move before quoting customers."],
          procurement: ["Confirm current supplier availability and packaging."]
        },
        suggestedCreates: [],
        warnings: [],
        draftNote: { title: "2026-05-04 - RUCOLAC B-321 pricing", summary: "Pricing update came in for RUCOLAC B-321." },
        intelligenceContext: {
          status: "matched",
          matchedEntry: {
            lastKnownGoodPrice: "$12.86/lb (SO 030)",
            commercialBenchmarks: ["$13.13/lb for SO 120 packaging."],
            logisticsNuances: ["FOB Rock Hill, SC"],
            complianceNotes: []
          }
        }
      }
    }
  ];

  const brief = buildDailyBrief({
    analyzedThreads,
    organization: "ClearEdge Solutions"
  });

  assert.ok(brief.includes("Price $12.86/lb (SO 030) / $13.13/lb for SO 120 packaging."));
});

test("buildDailyBrief surfaces unique ClearEdge intelligence learning prompts and contradictions in a coverage appendix", () => {
  const analyzedThreads = [
    {
      relationship: { relationship: "customer", subtype: "core_customer" },
      silo: { name: "commercial" },
      state: { state: "needs_attention" },
      priorityScore: 90,
      lastTimestamp: Date.UTC(2026, 4, 4, 10, 0, 0),
      subject: "Re: Mystery Resin XYZ",
      externalParticipants: [{ name: "Buyer", email: "buyer@example.com", domain: "example.com" }],
      analysis: {
        rawExtracts: { keyPoints: ["Need pricing for unknown resin"] },
        roleWorklists: { owner: [], sales: [], procurement: [] },
        suggestedCreates: [],
        warnings: [],
        draftNote: { title: "2026-05-04 - Re: Mystery Resin XYZ" },
        learningPrompt: 'Should "Mystery Resin XYZ" be added to the ClearEdge Intelligence library for future historical context?',
        intelligenceContext: {
          status: "no_historical_context",
          primaryChemicalEntity: { name: "Mystery Resin XYZ" },
          matchedEntry: null,
          contradictions: []
        }
      }
    },
    {
      relationship: { relationship: "supplier", subtype: "core_supplier" },
      silo: { name: "commercial" },
      state: { state: "needs_attention" },
      priorityScore: 80,
      lastTimestamp: Date.UTC(2026, 4, 4, 9, 0, 0),
      subject: "Re: Mystery Resin XYZ pricing",
      externalParticipants: [{ name: "Supplier", email: "rep@supplier.example", domain: "supplier.example" }],
      analysis: {
        rawExtracts: { keyPoints: ["Quote came back high"] },
        roleWorklists: { owner: [], sales: [], procurement: [] },
        suggestedCreates: [],
        warnings: [],
        draftNote: { title: "2026-05-04 - Re: Mystery Resin XYZ pricing" },
        learningPrompt: 'Should "Mystery Resin XYZ" be added to the ClearEdge Intelligence library for future historical context?',
        intelligenceContext: {
          status: "no_historical_context",
          primaryChemicalEntity: { name: "Mystery Resin XYZ" },
          matchedEntry: null,
          contradictions: []
        }
      }
    },
    {
      relationship: { relationship: "supplier", subtype: "core_supplier" },
      silo: { name: "commercial" },
      state: { state: "needs_attention" },
      priorityScore: 95,
      lastTimestamp: Date.UTC(2026, 4, 4, 8, 0, 0),
      subject: "RUCOLAC B-321 quote update",
      externalParticipants: [{ name: "Jason", email: "jason@accessrudolftech.com", domain: "accessrudolftech.com" }],
      analysis: {
        rawExtracts: { keyPoints: ["Quote came in different than ClearEdge Intelligence"] },
        roleWorklists: { owner: [], sales: [], procurement: [] },
        suggestedCreates: [],
        warnings: [],
        draftNote: { title: "2026-05-04 - RUCOLAC B-321 quote update" },
        intelligenceContext: {
          status: "matched",
          primaryChemicalEntity: { name: "RUCOLAC B-321" },
          matchedEntry: { entity: "RUCOLAC B-321", lastKnownGoodPrice: "$12.86/lb (SO 030)" },
          contradictions: ["Price differs from ClearEdge benchmark: current $14.20/lb vs last known good $12.86/lb (SO 030)."]
        }
      }
    }
  ];

  const brief = buildDailyBrief({
    analyzedThreads,
    organization: "ClearEdge Solutions"
  });

  assert.ok(brief.includes("ClearEdge Intelligence Coverage"));
  assert.ok(brief.includes("Add to Intelligence Library"));
  assert.ok(brief.includes("Should &quot;Mystery Resin XYZ&quot; be added to the ClearEdge Intelligence library"));
  assert.ok(brief.includes("Reconcile with Intelligence"));
  assert.ok(brief.includes("Price differs from ClearEdge benchmark"));

  const promptOccurrences = brief.match(/Should &quot;Mystery Resin XYZ&quot; be added/g) ?? [];
  assert.equal(promptOccurrences.length, 1, "duplicate learning prompts should be de-duplicated");
});

test("buildDailyBrief omits the ClearEdge Intelligence coverage section when there is nothing to surface", () => {
  const analyzedThreads = [
    {
      relationship: { relationship: "customer", subtype: "core_customer" },
      silo: { name: "commercial" },
      state: { state: "needs_attention" },
      priorityScore: 80,
      lastTimestamp: Date.UTC(2026, 4, 4, 10, 0, 0),
      subject: "Re: Routine pricing question",
      externalParticipants: [{ name: "Buyer", email: "buyer@example.com", domain: "example.com" }],
      analysis: {
        rawExtracts: { keyPoints: ["Routine pricing question"] },
        roleWorklists: { owner: [], sales: [], procurement: [] },
        suggestedCreates: [],
        warnings: [],
        draftNote: { title: "2026-05-04 - Re: Routine pricing question" }
      }
    }
  ];

  const brief = buildDailyBrief({
    analyzedThreads,
    organization: "ClearEdge Solutions"
  });

  assert.ok(!brief.includes("ClearEdge Intelligence Coverage"));
  assert.ok(!brief.includes("Add to Intelligence Library"));
  assert.ok(!brief.includes("Reconcile with Intelligence"));
});

test("buildDailyBrief can group top actions by company and business type", () => {
  const analyzedThreads = [
    {
      relationship: { relationship: "customer", subtype: "core_customer" },
      silo: { name: "commercial" },
      state: { state: "needs_attention" },
      priorityScore: 95,
      lastTimestamp: Date.UTC(2026, 4, 6, 10, 0, 0),
      subject: "PO 12345 - G301",
      externalParticipants: [{ name: "Courtney Quinn", email: "cquinn@suncoatings.example", domain: "suncoatings.example" }],
      reviewUrl: "http://localhost:4318/review-action.html?id=abc&token=def",
      proposedActions: [
        {
          id: "abc-customer_create",
          actionType: "customer_create",
          displayLabel: "Create customer in ShelfCycle",
          executable: true,
          fieldValues: { name: "Sun Coatings" }
        }
      ],
      analysis: {
        matches: { customer: [{ candidate: { name: "Sun Coatings" } }] },
        rawExtracts: { keyPoints: ["Customer sent PO 12345 for G301."] },
        roleWorklists: { owner: [], sales: [], procurement: [] },
        suggestedCreates: [],
        warnings: [],
        draftNote: { title: "2026-05-06 - PO 12345 - G301", summary: "Customer sent PO 12345 for G301." }
      }
    },
    {
      relationship: { relationship: "supplier", subtype: "core_supplier" },
      silo: { name: "compliance" },
      state: { state: "needs_attention" },
      priorityScore: 90,
      lastTimestamp: Date.UTC(2026, 4, 6, 9, 0, 0),
      subject: "SDS for RUCOLAC B-321",
      externalParticipants: [{ name: "Jason Netherton", email: "jason@accessrudolftech.com", domain: "accessrudolftech.com" }],
      analysis: {
        matches: { supplier: [{ candidate: { name: "ACCESS Rudolf Technologies" } }] },
        rawExtracts: { keyPoints: ["Supplier sent SDS for RUCOLAC B-321."] },
        roleWorklists: { owner: [], sales: [], procurement: [] },
        suggestedCreates: [],
        warnings: [],
        draftNote: { title: "2026-05-06 - SDS for RUCOLAC B-321", summary: "Supplier sent SDS for RUCOLAC B-321." }
      }
    }
  ];

  const byCompany = buildDailyBrief({
    analyzedThreads,
    organization: "ClearEdge Solutions",
    groupBy: "company",
    dateRange: { hours: 72 }
  });
  const byType = buildDailyBrief({
    analyzedThreads,
    organization: "ClearEdge Solutions",
    groupBy: "type"
  });

  assert.ok(byCompany.includes("Organized by Company"));
  assert.ok(byCompany.includes("Range: last 72 hour(s)"));
  assert.ok(byCompany.includes("<h3>Sun Coatings</h3>"));
  assert.ok(byCompany.includes("<h3>ACCESS Rudolf Technologies</h3>"));
  assert.ok(byCompany.includes("Create Customer"));
  assert.ok(byCompany.includes("review-submit.html"));
  assert.ok(byCompany.includes("ShelfCycle status"));
  assert.ok(byCompany.includes("Existing customer: Sun Coatings"));
  assert.ok(byCompany.includes("Existing supplier: ACCESS Rudolf Technologies"));
  assert.ok(byType.includes("Organized by Business type"));
  assert.ok(byType.includes("<h3>Orders / POs</h3>"));
  assert.ok(byType.includes("<h3>Product Info / Documents</h3>"));
});

test("buildDailyBrief appends a Message Memory section when provided", () => {
  const brief = buildDailyBrief({
    organization: "ClearEdge Solutions",
    title: "Daily ClearEdge Communications Brief",
    analyzedThreads: [],
    messageMemory: {
      section: "Message Memory",
      urgent_items: [
        {
          contact: "Kunal Butala",
          subject: "Text thread with +17329836870",
          relationship: "supplier",
          silo: "commercial",
          summary: "Requested pickup confirmation for benzyl alcohol.",
          next_step: "Reply with Friday pickup timing."
        }
      ],
      business_threads: [],
      unanswered_messages: [],
      memory_candidates: [
        {
          contact: "Kunal Butala",
          memoryType: "purchase_signal",
          summary: "Kunal Butala signaled an active order, shipment, or pickup need."
        }
      ],
      suggested_followups: [{ summary: "Reply with Friday pickup timing." }],
      low_priority_summary: []
    }
  });

  assert.ok(brief.includes("Daily ClearEdge Communications Brief"));
  assert.ok(brief.includes("Text Messages"));
  assert.ok(brief.includes("Suggested Text Follow-Ups"));
  assert.ok(brief.indexOf("<h2>Text Messages") < brief.indexOf("<h2>Waiting on Others"));
  assert.ok(brief.includes("Reply with Friday pickup timing."));
  assert.ok(!brief.includes("Decide in ChatGPT: https://chatgpt.com/?q="));
});
