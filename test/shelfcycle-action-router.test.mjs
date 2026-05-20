import test from "node:test";
import assert from "node:assert/strict";

import {
  collectProposedActions,
  findProposedAction,
  SHELFCYCLE_ACTION_TYPES
} from "../src/lib/shelfcycle-action-router.mjs";

function baseReviewAction(overrides = {}) {
  return {
    id: "review-123",
    subject: "Re: G301 pricing",
    summary: "Customer needs pricing and a follow-up note.",
    draftNote: {
      title: "G301 pricing",
      type: "Email",
      summary: "Customer asked for G301 pricing."
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
    },
    ...overrides
  };
}

test("known high-confidence customer match produces executable customer_note", () => {
  const actions = collectProposedActions(baseReviewAction());
  const note = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE);

  assert.equal(note.executable, true);
  assert.equal(note.selectedTarget.id, "cust-123");
  assert.ok(note.fieldValues.note.includes("Summary:\n- Customer asked for G301 pricing."));
  assert.ok(note.fieldValues.note.includes("Next step:\n- Review and decide whether this belongs in ShelfCycle."));
});

test("missing customer target keeps customer_note non-executable", () => {
  const actions = collectProposedActions(baseReviewAction({ matches: { customer: [] } }));
  const note = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE);

  assert.equal(note.executable, false);
  assert.equal(note.selectedTarget, null);
  assert.ok(note.warnings.includes("No resolved ShelfCycle customer target."));
});

test("multiple target candidates require user selection", () => {
  const actions = collectProposedActions(baseReviewAction({
    matches: {
      customer: [
        { score: 0.96, candidate: { id: "cust-1", name: "Sun Coatings" } },
        { score: 0.94, candidate: { id: "cust-2", name: "Sun Chemical" } }
      ]
    }
  }));
  const note = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE);

  assert.equal(note.executable, false);
  assert.equal(note.selectedTarget, null);
  assert.equal(note.targetCandidates.length, 2);
  assert.ok(note.warnings.includes("Select a ShelfCycle customer before submitting."));
});

test("single low-confidence target blocks until user selects it", () => {
  const reviewAction = baseReviewAction({
    matches: {
      customer: [
        { score: 0.7, candidate: { id: "cust-123", name: "Sun Coatings" } }
      ]
    }
  });
  const blocked = collectProposedActions(reviewAction).find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE);
  const selected = findProposedAction(reviewAction, {
    actionId: blocked.id,
    actionType: SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE,
    selectedTarget: {
      kind: "customer",
      id: "cust-123",
      label: "Sun Coatings"
    }
  });

  assert.equal(blocked.executable, false);
  assert.ok(blocked.warnings.includes("Low-confidence target match."));
  assert.equal(selected.executable, true);
});

test("selected searchable customer label can execute customer_note without a stored id", () => {
  const reviewAction = baseReviewAction({
    matches: {
      customer: [
        { score: 0.8, candidate: { name: "MAK Chemicals" } }
      ]
    }
  });
  const blocked = collectProposedActions(reviewAction).find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE);
  const selected = collectProposedActions(reviewAction, {
    selectedTarget: {
      kind: "customer",
      label: "MAK Chemicals"
    }
  }).find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE);

  assert.equal(blocked.executable, false);
  assert.ok(blocked.warnings.includes("Low-confidence target match."));
  assert.equal(selected.executable, true);
  assert.equal(selected.requiredFields.includes("selectedTarget.label"), true);
  assert.equal(selected.selectedTarget.id, "");
  assert.equal(selected.selectedTarget.label, "MAK Chemicals");
});

test("approved customer_note fields override parser-generated note fields", () => {
  const selected = findProposedAction(baseReviewAction(), {
    actionId: "review-123-customer_note",
    actionType: SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE,
    fields: {
      date: "2026-05-05",
      type: "Email",
      title: "Approved PO#18910 note title",
      note: "Approved note body from the review form."
    }
  });

  assert.equal(selected.executable, true);
  assert.equal(selected.fieldValues.date, "2026-05-05");
  assert.equal(selected.fieldValues.type, "Email");
  assert.equal(selected.fieldValues.title, "Approved PO#18910 note title");
  assert.equal(selected.fieldValues.note, "Approved note body from the review form.");
});

test("customer_note carries mention candidates for the approved ShelfCycle note", () => {
  const note = collectProposedActions(baseReviewAction({
    matches: {
      customer: [
        { score: 0.99, candidate: { id: "cust-123", name: "Sun Coatings" } }
      ],
      contacts: [
        { score: 1, candidate: { id: "contact-123", name: "Courtney Quinn", email: "courtney@example.com" } }
      ],
      products: [
        { score: 1, candidate: { id: "product-123", code: "G301-D", name: "ACCESS Organosilane G301" } }
      ]
    }
  })).find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE);

  assert.deepEqual(note.fieldValues.mentions.map((mention) => `${mention.kind}:${mention.label}`), [
    "customer:Sun Coatings",
    "contact:Courtney Quinn",
    "product:G301-D"
  ]);
});

test("suggested contacts become executable when a customer target is resolved", () => {
  const actions = collectProposedActions(baseReviewAction({
    suggestedCreates: [
      {
        type: "contact",
        name: "Kunal Butala",
        companyName: "MAK Chemicals"
      }
    ]
  }));
  const contact = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE);

  assert.equal(contact.executable, true);
  assert.equal(contact.selectedTarget.id, "cust-123");
  assert.equal(contact.fieldValues.name, "Kunal Butala");
  assert.deepEqual(contact.fieldValues.documentTypes, ["AR Statement", "Price Quote", "Sales Confirmation", "Invoice", "Credit Note"]);
});

test("suggested contact create is blocked when the contact already exists in ShelfCycle", () => {
  const actions = collectProposedActions(baseReviewAction({
    matches: {
      customer: [
        { score: 0.99, candidate: { id: "cust-123", name: "Sun Coatings" } }
      ],
      contacts: [
        {
          score: 0.98,
          candidate: {
            id: "contact-123",
            name: "Kunal Butala",
            email: "kunal@example.com",
            companyName: "Sun Coatings",
            companyType: "Customer"
          }
        }
      ]
    },
    suggestedCreates: [
      {
        type: "contact",
        name: "Kunal Butala",
        email: "kunal@example.com",
        companyName: "Sun Coatings"
      }
    ]
  }));
  const contact = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE);
  const contactUpdate = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_UPDATE);

  assert.equal(contact.executable, false);
  assert.equal(contact.displayLabel, "Existing ShelfCycle contact match - review instead of creating");
  assert.ok(contact.warnings.includes("Existing ShelfCycle contact match found; review before creating a duplicate contact."));
  assert.equal(contact.duplicateCandidates[0].email, "kunal@example.com");
  assert.equal(contactUpdate.executable, true);
  assert.equal(contactUpdate.selectedTarget.id, "contact-123");
  assert.equal(contactUpdate.fieldValues.email, "kunal@example.com");
});

test("contact create keeps all customer document types even when input has a partial list", () => {
  const actions = collectProposedActions(baseReviewAction({
    suggestedCreates: [
      {
        type: "contact",
        name: "Kunal Butala",
        companyName: "MAK Chemicals",
        documentTypes: ["Invoice"]
      }
    ]
  }));
  const contact = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE);

  assert.deepEqual(contact.fieldValues.documentTypes, ["AR Statement", "Price Quote", "Sales Confirmation", "Invoice", "Credit Note"]);
});

test("suggested contacts stay blocked without a customer target", () => {
  const actions = collectProposedActions(baseReviewAction({
    matches: { customer: [] },
    suggestedCreates: [
      {
        type: "contact",
        name: "Kunal Butala",
        companyName: "MAK Chemicals"
      }
    ]
  }));
  const contact = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE);

  assert.equal(contact.executable, false);
  assert.ok(contact.warnings.includes("Select a ShelfCycle customer before creating this contact."));
});

test("selected searchable customer label can execute contact create without a stored id", () => {
  const reviewAction = baseReviewAction({
    matches: {
      customer: [
        { score: 0.8, candidate: { name: "MAK Chemicals" } }
      ]
    },
    suggestedCreates: [
      {
        type: "contact",
        name: "Kunal Butala",
        email: "kunal@example.com",
        companyName: "MAK Chemicals"
      }
    ]
  });
  const pending = collectProposedActions(reviewAction).find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE);
  const selected = collectProposedActions(reviewAction, {
    selectedTarget: {
      kind: "customer",
      label: "MAK Chemicals"
    }
  }).find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE);

  assert.equal(pending.executable, true);
  assert.equal(selected.executable, true);
  assert.equal(selected.selectedTarget.id, "");
  assert.equal(selected.selectedTarget.label, "MAK Chemicals");
});

test("business-card contact-only packets infer extracted company as existing contact target", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "business_card",
    businessCard: {
      entryMode: "existing_customer_contact"
    },
    fields: {
      companyName: "Prom USA, Inc."
    },
    matches: {
      customer: []
    },
    suggestedCreates: [
      {
        type: "contact",
        name: "Rick Greene",
        email: "rgreene@prombiocides.com",
        companyName: "Prom USA, Inc.",
        companyType: "Customer"
      }
    ]
  }));
  const contact = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE);

  assert.equal(contact.executable, true);
  assert.equal(contact.selectedTarget.kind, "customer");
  assert.equal(contact.selectedTarget.id, "");
  assert.equal(contact.selectedTarget.label, "Prom USA, Inc.");
});

test("new customer workflow produces executable customer_create when required name is present", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_customer",
    fields: {
      name: "New Chem Buyer LLC",
      website: "https://newchembuyer.example",
      phoneNumber: "555-555-5555"
    },
    matches: {
      customer: []
    }
  }));
  const customer = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE);

  assert.equal(customer.executable, true);
  assert.equal(customer.fieldValues.name, "New Chem Buyer LLC");
  assert.deepEqual(customer.requiredFields, ["fields.name"]);
  assert.equal(customer.fieldValues.missingRequiredFields.length, 0);
  assert.ok(customer.fieldValues.missingRecommendedFields.includes("email"));
});

test("new customer workflow blocks customer_create without required ShelfCycle name", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_customer",
    fields: {
      website: "https://unknown.example"
    },
    matches: {
      customer: []
    }
  }));
  const customer = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE);

  assert.equal(customer.executable, false);
  assert.ok(customer.warnings.includes("Customer creation requires the ShelfCycle required Name field."));
  assert.ok(customer.fieldValues.missingRequiredFields.includes("name"));
});

test("new customer workflow blocks customer_create when an existing customer match may duplicate", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_customer",
    fields: {
      name: "Sun Coatings"
    }
  }));
  const customer = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE);

  assert.equal(customer.executable, false);
  assert.ok(customer.warnings.includes("Possible existing ShelfCycle customer match found; review before creating a duplicate customer."));
  assert.equal(customer.targetCandidates[0].label, "Sun Coatings");
});

test("new customer workflow blocks create when a matched ShelfCycle customer contact already exists", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_customer",
    fields: {
      name: "Everest Systems"
    },
    matches: {
      customer: [],
      supplier: [],
      contacts: [
        {
          score: 0.91,
          candidate: {
            name: "Derek Herald",
            email: "dherald@everestsco.com",
            companyName: "Everest Systems",
            companyType: "Customer"
          }
        }
      ]
    }
  }));
  const customer = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE);

  assert.equal(customer.executable, false);
  assert.equal(customer.displayLabel, "Existing ShelfCycle customer match - review instead of creating");
  assert.ok(customer.warnings.includes("Possible existing ShelfCycle customer match found; review before creating a duplicate customer."));
  assert.equal(customer.duplicateCandidates[0].label, "Everest Systems");
});

test("daily brief customer thread proposes customer create when no strong ShelfCycle customer exists", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "email_thread",
    relationship: {
      relationship: "customer",
      subtype: "prospect_or_customer"
    },
    externalParticipants: [
      {
        name: "Erin Christos",
        email: "erin@surfacekoatings.com",
        domain: "surfacekoatings.com"
      }
    ],
    matches: {
      customer: [],
      supplier: []
    },
    suggestedCreates: [
      {
        type: "contact",
        name: "Erin Christos",
        title: "Purchasing",
        email: "erin@surfacekoatings.com",
        companyName: "Surface Koatings"
      }
    ]
  }));
  const customer = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE);
  const contact = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE);

  assert.equal(customer.executable, true);
  assert.equal(customer.fieldValues.name, "Surface Koatings");
  assert.equal(customer.fieldValues.email, "erin@surfacekoatings.com");
  assert.equal(customer.fieldValues.website, "https://surfacekoatings.com");
  assert.equal(contact.executable, false);
  assert.ok(contact.warnings.includes("Select a ShelfCycle customer before creating this contact."));
});

test("daily brief customer thread does not propose customer create for a strong existing customer id", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "email_thread",
    relationship: {
      relationship: "customer",
      subtype: "core_customer"
    },
    externalParticipants: [
      {
        name: "Erin Christos",
        email: "erin@surfacekoatings.com",
        domain: "surfacekoatings.com"
      }
    ],
    matches: {
      customer: [
        {
          score: 0.96,
          candidate: {
            id: "customer-123",
            name: "Surface Koatings"
          }
        }
      ],
      supplier: []
    }
  }));

  assert.equal(actions.some((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE), false);
});

test("new supplier workflow produces executable supplier_create when required name is present", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_supplier",
    fields: {
      name: "Precision Additives LLC",
      website: "https://precision-additives.example",
      phone: "555-555-2222"
    },
    matches: {
      customer: [],
      supplier: []
    }
  }));
  const supplier = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE);

  assert.equal(supplier.executable, true);
  assert.equal(supplier.fieldValues.name, "Precision Additives LLC");
  assert.deepEqual(supplier.requiredFields, ["fields.name"]);
  assert.equal(supplier.fieldValues.missingRequiredFields.length, 0);
  assert.ok(supplier.fieldValues.missingRecommendedFields.includes("email"));
});

test("business-card supplier create carries visible supplier contact details into supplier fields", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "business_card",
    fields: {
      companyName: "Green Chemical",
      personName: "Doyun Kim",
      title: "Manager | Chemical Sales team",
      email: "dykim1@korgc.com",
      phone: "+82-2-3158-8827",
      mobilePhone: "+82-10-8824-7318",
      website: "http://www.korgc.com",
      streetAddress: "15F, Changgang Building, 86, Mapo-daero",
      city: "Seoul",
      country: "Korea",
      zip: "04168",
      relationshipType: "supplier"
    },
    suggestedCreates: [
      {
        type: "supplier",
        name: "Green Chemical",
        email: "dykim1@korgc.com",
        phone: "+82-2-3158-8827",
        website: "http://www.korgc.com",
        street1: "15F, Changgang Building, 86, Mapo-daero",
        city: "Seoul",
        country: "Korea",
        zip: "04168"
      },
      {
        type: "contact",
        name: "Doyun Kim",
        title: "Manager | Chemical Sales team",
        email: "dykim1@korgc.com",
        phone: "+82-2-3158-8827",
        mobilePhone: "+82-10-8824-7318",
        companyName: "Green Chemical",
        companyType: "Supplier"
      }
    ],
    matches: {
      customer: [],
      supplier: [],
      contacts: []
    }
  }));
  const supplier = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE);

  assert.equal(supplier.executable, true);
  assert.equal(supplier.fieldValues.name, "Green Chemical");
  assert.equal(supplier.fieldValues.email, "dykim1@korgc.com");
  assert.equal(supplier.fieldValues.phone, "+82-2-3158-8827");
  assert.equal(supplier.fieldValues.website, "http://www.korgc.com");
  assert.equal(supplier.fieldValues.street1, "15F, Changgang Building, 86, Mapo-daero");
  assert.equal(supplier.fieldValues.city, "Seoul");
  assert.equal(supplier.fieldValues.country, "Korea");
  assert.equal(supplier.fieldValues.zip, "04168");
});

test("new supplier workflow blocks supplier_create when an existing supplier match may duplicate", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_supplier",
    fields: {
      name: "ACCESS Rudolf Technologies"
    },
    matches: {
      customer: [],
      supplier: [
        {
          score: 0.85,
          candidate: {
            name: "ACCESS Rudolf Technologies",
            domain: "accessrudolftech.com"
          }
        }
      ]
    }
  }));
  const supplier = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE);

  assert.equal(supplier.executable, false);
  assert.ok(supplier.warnings.includes("Possible existing ShelfCycle supplier match found; review before creating a duplicate supplier."));
  assert.equal(supplier.targetCandidates[0].label, "ACCESS Rudolf Technologies");
});

test("existing supplier match offers update action with visible supplier fields", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "business_card",
    relationship: {
      relationship: "supplier",
      subtype: "supplier"
    },
    fields: {
      companyName: "Green Chemical",
      email: "dykim1@korgc.com",
      phone: "+82-2-3158-8827",
      website: "http://www.korgc.com",
      relationshipType: "supplier"
    },
    suggestedCreates: [
      {
        type: "contact",
        name: "Doyun Kim",
        title: "Manager | Chemical Sales team",
        email: "dykim1@korgc.com",
        companyName: "Green Chemical",
        companyType: "Supplier"
      }
    ],
    matches: {
      customer: [],
      supplier: [
        {
          score: 0.96,
          candidate: {
            id: "supplier-123",
            name: "Green Chemical"
          }
        }
      ],
      contacts: []
    }
  }));
  const supplierCreate = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE);
  const supplierUpdate = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_UPDATE);

  assert.equal(Boolean(supplierCreate), false);
  assert.equal(supplierUpdate.executable, true);
  assert.equal(supplierUpdate.selectedTarget.id, "supplier-123");
  assert.equal(supplierUpdate.fieldValues.email, "dykim1@korgc.com");
  assert.equal(supplierUpdate.fieldValues.phone, "+82-2-3158-8827");
  assert.equal(supplierUpdate.fieldValues.website, "http://www.korgc.com");
});

test("business-card supplier candidate offers searchable supplier update without a local ShelfCycle id", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "business_card",
    relationship: {
      relationship: "supplier",
      subtype: "supplier"
    },
    fields: {
      companyName: "WANHUA CHEMICAL (AMERICA) CO., LTD.",
      email: "info@wanhua.example",
      phone: "555-555-1212",
      website: "https://www.whchem.com",
      relationshipType: "supplier"
    },
    suggestedCreates: [
      {
        type: "supplier",
        name: "WANHUA CHEMICAL (AMERICA) CO., LTD.",
        email: "info@wanhua.example",
        phone: "555-555-1212",
        website: "https://www.whchem.com"
      }
    ],
    matches: {
      customer: [],
      supplier: [],
      contacts: []
    }
  }));
  const supplierCreate = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE);
  const supplierUpdate = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_UPDATE);

  assert.equal(supplierCreate.executable, true);
  assert.equal(supplierUpdate.executable, true);
  assert.equal(supplierUpdate.selectedTarget.id, "");
  assert.equal(supplierUpdate.selectedTarget.label, "WANHUA CHEMICAL (AMERICA) CO., LTD.");
  assert.equal(supplierUpdate.fieldValues.email, "info@wanhua.example");
  assert.equal(supplierUpdate.fieldValues.phone, "555-555-1212");
  assert.equal(supplierUpdate.fieldValues.website, "https://www.whchem.com");
});

test("business-card customer prospect does not manufacture a supplier update action", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "business_card",
    relationship: {
      relationship: "customer",
      subtype: "prospect"
    },
    fields: {
      personName: "Gary Kessler",
      companyName: "Kessler Chemical",
      email: "gary@kesslerchemical.com",
      phone: "610-758-9602",
      website: "www.kesslerchemical.com",
      relationshipType: "customer_prospect"
    },
    suggestedCreates: [
      {
        type: "customer",
        name: "Kessler Chemical",
        email: "gary@kesslerchemical.com",
        phone: "610-758-9602",
        website: "www.kesslerchemical.com",
        prospect: true
      },
      {
        type: "contact",
        name: "Gary Kessler",
        email: "gary@kesslerchemical.com",
        companyName: "Kessler Chemical",
        companyType: "Customer"
      }
    ],
    matches: {
      customer: [],
      supplier: [],
      contacts: []
    }
  }));

  assert.equal(actions.some((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_UPDATE), false);
  const customer = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE);

  assert.equal(customer?.executable, true);
  assert.equal(customer.fieldValues.name, "Kessler Chemical");
  assert.equal(customer.fieldValues.website, "www.kesslerchemical.com");
  assert.equal(customer.fieldValues.email, "");
  assert.equal(customer.fieldValues.phoneNumber, "");
});

test("new supplier workflow blocks create when a matched ShelfCycle supplier contact already exists", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_supplier",
    fields: {
      name: "MAK Chemicals"
    },
    matches: {
      customer: [],
      supplier: [],
      contacts: [
        {
          score: 0.9,
          candidate: {
            name: "Kunal Butala",
            email: "kunal@makchem.com",
            companyName: "MAK Chemicals",
            companyType: "Supplier"
          }
        }
      ]
    }
  }));
  const supplier = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE);

  assert.equal(supplier.executable, false);
  assert.equal(supplier.displayLabel, "Existing ShelfCycle supplier match - review instead of creating");
  assert.ok(supplier.warnings.includes("Possible existing ShelfCycle supplier match found; review before creating a duplicate supplier."));
  assert.equal(supplier.duplicateCandidates[0].label, "MAK Chemicals");
});

test("daily brief supplier thread proposes supplier create when no strong ShelfCycle supplier exists", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "email_thread",
    relationship: {
      relationship: "supplier",
      subtype: "core_supplier"
    },
    externalParticipants: [
      {
        name: "Kaylib Rhinehart",
        email: "kaylib.rhinehart@siegwerk.com",
        domain: "siegwerk.com"
      }
    ],
    matches: {
      customer: [],
      supplier: []
    },
    suggestedCreates: [
      {
        type: "contact",
        name: "Kaylib Rhinehart",
        title: "Sales Manager",
        email: "kaylib.rhinehart@siegwerk.com",
        companyName: "Siegwerk"
      }
    ]
  }));
  const supplier = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE);
  const contact = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE);

  assert.equal(supplier.executable, true);
  assert.equal(supplier.fieldValues.name, "Siegwerk");
  assert.equal(supplier.fieldValues.email, "kaylib.rhinehart@siegwerk.com");
  assert.equal(supplier.fieldValues.website, "https://siegwerk.com");
  assert.equal(contact.executable, false);
  assert.ok(contact.warnings.includes("Select a ShelfCycle supplier before creating this contact."));
});

test("supplier create ignores Superhuman reminders and uses dominant business identity", () => {
  const actions = collectProposedActions(baseReviewAction({
    subject: "RE: Green Chemical/ ClearEdge ACS follow-up",
    workflow: "email_thread",
    relationship: {
      relationship: "supplier",
      subtype: "core_supplier"
    },
    externalParticipants: [
      { name: "", email: "jhkim2@korgc.com", domain: "korgc.com" },
      { name: "", email: "dykim1@korgc.com", domain: "korgc.com" },
      { name: "Reminder", email: "reminder@superhuman.com", domain: "superhuman.com" }
    ],
    matches: {
      customer: [],
      supplier: []
    },
    suggestedCreates: [
      {
        type: "contact",
        name: "Reminder",
        email: "reminder@superhuman.com",
        companyName: "Superhuman"
      },
      {
        type: "contact",
        name: "",
        email: "jhkim2@korgc.com",
        companyName: "Korgc"
      }
    ]
  }));
  const supplier = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE);
  const contact = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE);

  assert.equal(supplier.executable, true);
  assert.equal(supplier.fieldValues.name, "Green Chemical");
  assert.equal(supplier.fieldValues.email, "jhkim2@korgc.com");
  assert.equal(supplier.fieldValues.website, "https://korgc.com");
  assert.equal(contact.fieldValues.email, "jhkim2@korgc.com");
  assert.notEqual(contact.fieldValues.email, "reminder@superhuman.com");
});

test("daily brief supplier thread does not propose supplier create for a strong existing supplier id", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "email_thread",
    relationship: {
      relationship: "supplier",
      subtype: "core_supplier"
    },
    externalParticipants: [
      {
        name: "Jason Netherton",
        email: "jason@accessrudolftech.com",
        domain: "accessrudolftech.com"
      }
    ],
    matches: {
      customer: [],
      supplier: [
        {
          score: 0.96,
          candidate: {
            id: "supplier-123",
            name: "ACCESS Rudolf Technologies"
          }
        }
      ]
    }
  }));

  assert.equal(actions.some((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE), false);
});

test("suggested supplier contacts use supplier target and require title", () => {
  const actions = collectProposedActions(baseReviewAction({
    matches: {
      customer: [],
      supplier: [
        {
          score: 0.96,
          candidate: {
            id: "supplier-123",
            name: "MAK Chemicals"
          }
        }
      ]
    },
    suggestedCreates: [
      {
        type: "contact",
        companyType: "Supplier",
        name: "Kunal Butala",
        title: "Sales",
        email: "kunal@example.com",
        companyName: "MAK Chemicals"
      }
    ]
  }));
  const contact = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE);

  assert.equal(contact.executable, true);
  assert.equal(contact.selectedTarget.kind, "supplier");
  assert.equal(contact.selectedTarget.id, "supplier-123");
  assert.equal(contact.fieldValues.companyType, "supplier");
  assert.deepEqual(contact.fieldValues.documentTypes, ["Purchase Orders", "Bills", "Marketing", "Logistics", "Warehouse", "Call Reports"]);
});

test("suggested supplier contacts block when ShelfCycle-required title is missing", () => {
  const actions = collectProposedActions(baseReviewAction({
    matches: {
      customer: [],
      supplier: [
        {
          score: 0.96,
          candidate: {
            id: "supplier-123",
            name: "MAK Chemicals"
          }
        }
      ]
    },
    suggestedCreates: [
      {
        type: "contact",
        companyType: "Supplier",
        name: "Kunal Butala",
        email: "kunal@example.com",
        companyName: "MAK Chemicals"
      }
    ]
  }));
  const contact = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE);

  assert.equal(contact.executable, false);
  assert.ok(contact.warnings.includes("Supplier contact creation requires the ShelfCycle required Title field."));
  assert.ok(contact.requiredFields.includes("fields.title"));
});

test("business-card customer address proposes location after a customer target is selected", () => {
  const reviewAction = baseReviewAction({
    workflow: "business_card",
    fields: {
      companyName: "Surface Koatings",
      personName: "Erin Christos",
      email: "erin@surfacekoatings.com",
      relationshipSuggestion: "customer_prospect",
      streetAddress: "123 Coatings Way",
      city: "Newberry",
      stateRegion: "SC",
      zip: "29108",
      country: "United States"
    },
    matches: {
      customer: [],
      supplier: []
    },
    suggestedCreates: [
      { type: "customer", name: "Surface Koatings" },
      {
        type: "contact",
        name: "Erin Christos",
        email: "erin@surfacekoatings.com",
        companyName: "Surface Koatings",
        companyType: "Customer"
      }
    ]
  });
  const blocked = collectProposedActions(reviewAction).find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.LOCATION_CREATE);
  const selected = collectProposedActions(reviewAction, {
    selectedTarget: {
      kind: "customer",
      id: "customer-123",
      label: "Surface Koatings"
    }
  }).find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.LOCATION_CREATE);

  assert.equal(blocked.executable, false);
  assert.ok(blocked.warnings.includes("Create or select a ShelfCycle customer before creating this location."));
  assert.equal(blocked.fieldValues.name, "Surface Koatings");
  assert.deepEqual(blocked.requiredFields, ["selectedTarget.label", "fields.name"]);
  assert.equal(selected.executable, true);
  assert.equal(selected.selectedTarget.id, "customer-123");
  assert.equal(selected.fieldValues.companyType, "customer");
  assert.equal(selected.fieldValues.streetAddress, "123 Coatings Way");
});

test("business-card supplier address proposes executable supplier location for an existing supplier target", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "business_card",
    fields: {
      companyName: "Kessler Chemical",
      personName: "Pat Kessler",
      title: "Sales",
      email: "pat@kessler.example",
      relationshipSuggestion: "supplier",
      streetAddress: "1 Supplier Road",
      city: "Charlotte",
      stateRegion: "NC",
      zip: "28202",
      country: "United States"
    },
    relationship: {
      relationship: "supplier"
    },
    matches: {
      customer: [],
      supplier: [
        {
          score: 0.96,
          candidate: {
            id: "supplier-123",
            name: "Kessler Chemical"
          }
        }
      ]
    },
    suggestedCreates: [
      {
        type: "contact",
        name: "Pat Kessler",
        title: "Sales",
        email: "pat@kessler.example",
        companyName: "Kessler Chemical",
        companyType: "Supplier"
      }
    ]
  }));
  const location = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.LOCATION_CREATE);

  assert.equal(location.executable, true);
  assert.equal(location.selectedTarget.kind, "supplier");
  assert.equal(location.selectedTarget.id, "supplier-123");
  assert.equal(location.fieldValues.companyType, "supplier");
  assert.equal(location.fieldValues.name, "Kessler Chemical");
});

test("business-card without address does not propose a location action", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "business_card",
    fields: {
      companyName: "No Address LLC",
      personName: "Casey Smith",
      email: "casey@example.com"
    },
    matches: {
      customer: [],
      supplier: []
    },
    suggestedCreates: [
      { type: "customer", name: "No Address LLC" }
    ]
  }));

  assert.equal(actions.some((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.LOCATION_CREATE), false);
});

test("product create/update proposes update for an existing ShelfCycle product match", () => {
  const actions = collectProposedActions(baseReviewAction({
    briefAi: {
      shelfCycleCandidate: {
        shouldConsider: true,
        recordType: "Product",
        fields: [
          "code: RUCOLAC B-591",
          "product_family: RUCOLAC B-591",
          "packaging: Drum",
          "quantity_per_package: 529 lb"
        ]
      }
    },
    matches: {
      customer: [],
      products: [
        {
          score: 0.95,
          candidate: {
            id: "product-123",
            code: "RUCOLAC B-591",
            name: "RUCOLAC B-591"
          }
        }
      ]
    }
  }));
  const product = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE);

  assert.equal(product.executable, true);
  assert.equal(product.displayLabel, "Update existing product code in ShelfCycle");
  assert.equal(product.selectedTarget.id, "product-123");
  assert.equal(product.fieldValues.mode, "update");
  assert.equal(product.duplicateCandidates[0].label, "RUCOLAC B-591");
});

test("product intake can update an explicitly selected existing ShelfCycle product", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_product",
    productIntakeMode: "update",
    productUpdateTarget: {
      kind: "product",
      label: "RUCOLAC B-591",
      confidence: 0.94
    },
    fields: {
      code: "RUCOLAC B-591",
      productFamily: "RUCOLAC B-591",
      packagingType: "Fixed",
      packaging: "Drum (lb)",
      quantityPerPackage: "529",
      supplierType: "Variable",
      casNumber: "98-00-0"
    },
    matches: {
      customer: [],
      product: []
    }
  }));
  const product = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE);

  assert.equal(product.executable, true);
  assert.equal(product.displayLabel, "Update existing product code in ShelfCycle");
  assert.equal(product.selectedTarget.kind, "product");
  assert.equal(product.selectedTarget.label, "RUCOLAC B-591");
  assert.equal(product.fieldValues.mode, "update");
  assert.deepEqual(product.requiredFields, ["selectedTarget.label", "approval.packageSize"]);
});

test("product intake can create a new ShelfCycle product when required fields are present", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_product",
    fields: {
      code: "NEW-D",
      productFamily: "New Product",
      packagingType: "Fixed",
      packaging: "Drum",
      quantityPerPackage: "500 lb",
      supplierType: "Variable",
      sdsPath: "/Users/seanwagner/Documents/Playground/shelfcycle-mvp/.local/product-documents/new-product-sds.pdf"
    },
    matches: {
      customer: [],
      product: [
        {
          score: 0.91,
          candidate: {
            id: "family-product-123",
            code: "NEW-T",
            name: "New Product Tote",
            family: "New Product"
          }
        }
      ]
    }
  }));
  const product = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE);
  const productFamily = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.PRODUCT_FAMILY_CREATE_OR_UPDATE);

  assert.equal(product.executable, true);
  assert.equal(product.displayLabel, "Create product code in ShelfCycle");
  assert.equal(product.fieldValues.mode, "create");
  assert.equal(product.fieldValues.sdsPath, "/Users/seanwagner/Documents/Playground/shelfcycle-mvp/.local/product-documents/new-product-sds.pdf");
  assert.ok(product.requiredFields.includes("approval.packageSize"));
  assert.match(product.fieldValues.reuseGuidance, /Existing Product Family matched/);
  assert.equal(productFamily.executable, false);
  assert.match(productFamily.warnings.join(" "), /Product family appears to exist/);
});

test("product intake allows product-code automation to enter a new product family safely", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_product",
    fields: {
      code: "NEW-D",
      productFamily: "New Unmatched Product",
      packagingType: "Fixed",
      packaging: "Drum",
      quantityPerPackage: "500 lb",
      supplierType: "Variable"
    },
    matches: {
      customer: [],
      product: []
    }
  }));
  const product = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE);
  const productFamily = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.PRODUCT_FAMILY_CREATE_OR_UPDATE);

  assert.equal(product.executable, true);
  assert.equal(product.warnings.length, 0);
  assert.ok(product.requiredFields.includes("approval.packageSize"));
  assert.ok(product.requiredFields.includes("approval.productFamily"));
  assert.equal(product.fieldValues.ensureProductFamily, true);
  assert.equal(product.fieldValues.productFamilyMode, "create_then_select");
  assert.match(product.displayLabel, /product family \+ product code/i);
  assert.match(product.fieldValues.reuseGuidance, /creates the Product Family first/i);
  assert.equal(productFamily.executable, false);
  assert.match(productFamily.warnings.join(" "), /Product Family creation runs inside the approved Product Code workflow/i);
});

test("SDS product intake requires local SDS path before product-code approval", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_product",
    documentType: "SDS",
    fields: {
      documentType: "SDS",
      code: "NEW-D",
      productFamily: "New Product",
      packagingType: "Fixed",
      packaging: "Drum",
      quantityPerPackage: "500 lb",
      supplierType: "Variable"
    },
    matches: {
      customer: [],
      product: []
    }
  }));
  const product = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE);

  assert.equal(product.executable, false);
  assert.ok(product.requiredFields.includes("fields.sdsPath"));
  assert.match(product.warnings.join(" "), /local SDS file path/);
});

test("product intake creates separate product-code actions for multiple package sizes", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_product",
    fields: {
      code: "PH90-475, PH90-40",
      productFamily: "Phenol",
      productName: "Phenol-90%",
      packagingType: "Fixed",
      packaging: "Drum (lb), Pail (lb)",
      quantityPerPackage: "475, 40",
      supplierType: "Fixed",
      supplier: "Kessler Chemical"
    },
    matches: {
      customer: [],
      product: []
    }
  }));
  const products = actions.filter((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE);

  assert.equal(products.length, 2);
  assert.equal(products[0].fieldValues.code, "PH90-475");
  assert.equal(products[0].fieldValues.packaging, "Drum (lb)");
  assert.equal(products[0].fieldValues.quantityPerPackage, "475");
  assert.equal(products[0].executable, true);
  assert.ok(products[0].requiredFields.includes("approval.packageSize"));
  assert.ok(products[0].requiredFields.includes("approval.productFamily"));
  assert.equal(products[1].fieldValues.code, "PH90-40");
  assert.equal(products[1].fieldValues.packaging, "Pail (lb)");
  assert.equal(products[1].fieldValues.quantityPerPackage, "40");
  assert.equal(products[1].executable, true);
  assert.ok(products[1].requiredFields.includes("approval.packageSize"));
  assert.ok(products[1].requiredFields.includes("approval.productFamily"));
  assert.notEqual(products[0].id, products[1].id);
});

test("product intake creates unique product-code action ids when packaging varies under one code", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_product",
    fields: {
      code: "WB-NPGDGE",
      productFamily: "Neopentyl Glycol Diglycidyl Ether",
      packagingType: "Variable",
      packaging: "Drum, IBC, ISO Tank",
      quantityPerPackage: "1000",
      unitOfMeasure: "kg",
      supplierType: "Fixed",
      supplier: "Winbond Materials Co., Ltd"
    },
    matches: {
      customer: [],
      product: []
    }
  }));
  const products = actions.filter((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE);

  assert.equal(products.length, 3);
  assert.equal(new Set(products.map((action) => action.id)).size, 3);
});

test("findProposedAction resolves old product action id after submitted fields collapse variants", () => {
  const reviewAction = baseReviewAction({
    workflow: "new_product",
    proposedActions: [
      {
        id: "review-123-product_create_or_update-wb-npgdge",
        actionType: SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE,
        executable: true,
        fieldValues: {
          code: "WB-NPGDGE",
          productFamily: "Neopentyl Glycol Diglycidyl Ether",
          packagingType: "Variable",
          packaging: "Drum",
          quantityPerPackage: "1000",
          unitOfMeasure: "kg",
          supplierType: "Fixed",
          supplier: "Winbond Materials Co., Ltd"
        }
      }
    ],
    fields: {
      code: "WB-NPGDGE",
      productFamily: "Neopentyl Glycol Diglycidyl Ether",
      packagingType: "Variable",
      packaging: "Drum, IBC, ISO Tank",
      quantityPerPackage: "1000",
      unitOfMeasure: "kg",
      supplierType: "Fixed",
      supplier: "Winbond Materials Co., Ltd"
    },
    matches: {
      customer: [],
      product: []
    }
  });
  const action = findProposedAction(reviewAction, {
    actionId: "review-123-product_create_or_update-wb-npgdge",
    actionType: SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE,
    fields: {
      code: "WB-NPGDGE",
      productFamily: "Neopentyl Glycol Diglycidyl Ether",
      packagingType: "Variable",
      packaging: "Drum",
      quantityPerPackage: "1000",
      unitOfMeasure: "kg",
      supplierType: "Fixed",
      supplier: "Winbond Materials Co., Ltd"
    }
  });

  assert.equal(action.id, "review-123-product_create_or_update-wb-npgdge");
  assert.equal(action.actionType, SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE);
  assert.equal(action.fieldValues.packaging, "Drum");
});

test("product intake reuses matched product family for a new package code", () => {
  const actions = collectProposedActions(baseReviewAction({
    workflow: "new_product",
    fields: {
      code: "XP1127-D",
      productFamily: "ONGRONAT XP 1127",
      packagingType: "Fixed",
      packaging: "Drum (kg)",
      quantityPerPackage: "250",
      supplierType: "Variable"
    },
    matches: {
      customer: [],
      product: [
        {
          score: 0.95,
          candidate: {
            id: "existing-family",
            code: "XP1127-T",
            name: "ONGRONAT XP 1127 Tote",
            family: "ONGRONAT XP 1127",
            casNumber: "101-68-8"
          }
        }
      ]
    }
  }));
  const product = actions.find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE);

  assert.equal(product.executable, true);
  assert.equal(product.fieldValues.productFamily, "ONGRONAT XP 1127");
  assert.ok(product.requiredFields.includes("approval.packageSize"));
  assert.match(product.fieldValues.reuseGuidance, /Reuse family-level/);
});
