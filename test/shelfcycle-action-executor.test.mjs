import test from "node:test";
import assert from "node:assert/strict";

import { collectProposedActions, SHELFCYCLE_ACTION_TYPES } from "../src/lib/shelfcycle-action-router.mjs";
import {
  buildContactSubmission,
  buildCustomerSubmission,
  buildCustomerNoteSubmission,
  buildPricingSubmission,
  buildProductDocumentSubmission,
  buildProductSubmission,
  buildSupplierSubmission
} from "../src/lib/shelfcycle-action-executor.mjs";

function executableReviewAction() {
  return {
    id: "review-123",
    subject: "Re: PO follow-up",
    summary: "Customer needs PO follow-up.",
    draftNote: {
      title: "PO follow-up",
      type: "Email",
      summary: "Customer needs PO follow-up."
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
  };
}

test("buildCustomerNoteSubmission creates browser-agent payload for approved customer note", () => {
  const reviewAction = {
    ...executableReviewAction(),
    matches: {
      customer: [
        {
          score: 0.99,
          candidate: {
            id: "cust-123",
            name: "Sun Coatings"
          }
        }
      ],
      contacts: [
        {
          score: 1,
          candidate: {
            id: "contact-123",
            name: "Courtney Quinn",
            email: "courtney@example.com"
          }
        }
      ],
      products: [
        {
          score: 1,
          candidate: {
            id: "product-123",
            code: "G301-D",
            name: "ACCESS Organosilane G301"
          }
        }
      ]
    }
  };
  const proposedAction = collectProposedActions(reviewAction).find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE);
  const submission = buildCustomerNoteSubmission(reviewAction, proposedAction);

  assert.equal(submission.actionType, SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE);
  assert.equal(submission.actionId, proposedAction.id);
  assert.equal(submission.customerId, "cust-123");
  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/customers/cust-123/notes");
  assert.equal(submission.fields.title, "PO follow-up");
  assert.ok(submission.fields.summary.includes("Summary:\n- Customer needs PO follow-up."));
  assert.ok(submission.fields.summary.includes("Decision / status:\n- Customer needs PO follow-up."));
  assert.deepEqual(submission.fields.mentions.map((mention) => `${mention.kind}:${mention.label}`), [
    "customer:Sun Coatings",
    "contact:Courtney Quinn",
    "product:G301-D"
  ]);
});

test("buildCustomerNoteSubmission supports searchable customer targets", () => {
  const reviewAction = executableReviewAction();
  const proposedAction = collectProposedActions(reviewAction, {
    selectedTarget: {
      kind: "customer",
      id: "",
      label: "MAK Chemicals"
    }
  }).find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE);
  const submission = buildCustomerNoteSubmission(reviewAction, proposedAction);

  assert.equal(submission.actionType, SHELFCYCLE_ACTION_TYPES.CUSTOMER_NOTE);
  assert.equal(submission.customerId, "");
  assert.equal(submission.customerName, "MAK Chemicals");
  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/contacts");
  assert.ok(submission.fields.summary.includes("Summary:\n- Customer needs PO follow-up."));
});

test("buildCustomerNoteSubmission rejects preview-only unsupported actions", () => {
  assert.throws(
    () => buildCustomerNoteSubmission(executableReviewAction(), {
      actionType: SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE,
      executable: false
    }),
    /Only customer note actions/
  );
});

test("buildContactSubmission supports searchable customer targets", () => {
  const submission = buildContactSubmission(executableReviewAction(), {
    id: "action-contact",
    reviewActionId: "review-123",
    actionType: SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE,
    executable: true,
    selectedTarget: {
      kind: "customer",
      id: "",
      label: "MAK Chemicals"
    },
    fieldValues: {
      name: "Kunal Butala",
      email: "kunal@example.com"
    }
  });

  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/contacts");
  assert.equal(submission.customerName, "MAK Chemicals");
  assert.equal(submission.fields.name, "Kunal Butala");
  assert.deepEqual(submission.fields.documentTypes, ["AR Statement", "Price Quote", "Sales Confirmation", "Invoice", "Credit Note"]);
});

test("buildContactSubmission supports supplier contact targets", () => {
  const submission = buildContactSubmission(executableReviewAction(), {
    id: "action-contact",
    reviewActionId: "review-123",
    actionType: SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE,
    executable: true,
    selectedTarget: {
      kind: "supplier",
      id: "supplier-123",
      label: "MAK Chemicals"
    },
    fieldValues: {
      name: "Kunal Butala",
      title: "Sales",
      email: "kunal@example.com",
      phone: "555-555-1212",
      companyType: "supplier",
      documentTypes: ["Bills"]
    }
  });

  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/suppliers/supplier-123/contacts");
  assert.equal(submission.supplierId, "supplier-123");
  assert.equal(submission.supplierName, "MAK Chemicals");
  assert.equal(submission.customerId, "");
  assert.equal(submission.fields.phone, "555-555-1212");
  assert.deepEqual(submission.fields.documentTypes, ["Purchase Orders", "Bills", "Marketing", "Logistics", "Warehouse", "Call Reports"]);
});

test("buildContactSubmission maps supplier mobile phone into ShelfCycle phone field", () => {
  const submission = buildContactSubmission(executableReviewAction(), {
    id: "action-contact",
    reviewActionId: "review-123",
    actionType: SHELFCYCLE_ACTION_TYPES.CONTACT_CREATE,
    executable: true,
    selectedTarget: {
      kind: "supplier",
      id: "supplier-123",
      label: "Prom USA, Inc."
    },
    fieldValues: {
      name: "Rick Greene",
      title: "Regional Sales Manager",
      email: "rgreene@prombiocides.com",
      mobilePhone: "401-692-7336",
      companyType: "supplier"
    }
  });

  assert.equal(submission.fields.phone, "401-692-7336");
  assert.equal(submission.fields.officePhone, "401-692-7336");
  assert.equal(submission.fields.mobilePhone, "401-692-7336");
});

test("buildCustomerSubmission creates customer payload", () => {
  const proposedAction = collectProposedActions({
    ...executableReviewAction(),
    workflow: "new_customer",
    fields: {
      name: "New Chem Buyer LLC",
      website: "https://newchembuyer.example",
      phoneNumber: "555-555-5555"
    },
    matches: {
      customer: []
    }
  }).find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE);
  const submission = buildCustomerSubmission(executableReviewAction(), proposedAction);

  assert.equal(submission.recordType, "customer");
  assert.equal(submission.actionType, SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE);
  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/customers");
  assert.equal(submission.fields.name, "New Chem Buyer LLC");
});

test("buildSupplierSubmission creates supplier payload", () => {
  const proposedAction = collectProposedActions({
    ...executableReviewAction(),
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
  }).find((action) => action.actionType === SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE);
  const submission = buildSupplierSubmission(executableReviewAction(), proposedAction);

  assert.equal(submission.recordType, "supplier");
  assert.equal(submission.actionType, SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE);
  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/suppliers");
  assert.equal(submission.fields.name, "Precision Additives LLC");
});

test("buildSupplierSubmission rejects supplier payload without name", () => {
  assert.throws(
    () => buildSupplierSubmission(executableReviewAction(), {
      id: "action-supplier",
      reviewActionId: "review-123",
      actionType: SHELFCYCLE_ACTION_TYPES.SUPPLIER_CREATE,
      executable: true,
      fieldValues: {
        website: "https://missing-name.example"
      }
    }),
    /supplier name is required/i
  );
});

test("buildCustomerSubmission rejects customer payload without name", () => {
  assert.throws(
    () => buildCustomerSubmission(executableReviewAction(), {
      id: "action-customer",
      reviewActionId: "review-123",
      actionType: SHELFCYCLE_ACTION_TYPES.CUSTOMER_CREATE,
      executable: true,
      fieldValues: {
        website: "https://missing-name.example"
      }
    }),
    /customer name is required/i
  );
});

test("buildPricingSubmission creates price-book payload", () => {
  const submission = buildPricingSubmission(executableReviewAction(), {
    id: "action-pricing",
    reviewActionId: "review-123",
    actionType: SHELFCYCLE_ACTION_TYPES.PRICING_RECORD,
    executable: true,
    fieldValues: {
      customerName: "Sun Coatings",
      productCode: "G301-D",
      pricePerUnit: "$4.25",
      note: "Supplier pricing received."
    }
  });

  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/price-book?viewBy=CUSTOMER");
  assert.equal(submission.fields.productCode, "G301-D");
});

test("buildProductSubmission creates product-code payload", () => {
  const submission = buildProductSubmission(executableReviewAction(), {
    id: "action-product",
    reviewActionId: "review-123",
    actionType: SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE,
    executable: true,
    fieldValues: {
      code: "NEW-D",
      productFamily: "New Product",
      packaging: "Drum",
      quantityPerPackage: "500"
    }
  });

  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/products");
  assert.equal(submission.fields.code, "NEW-D");
});

test("buildProductDocumentSubmission creates existing product document payload", () => {
  const submission = buildProductDocumentSubmission(executableReviewAction(), {
    id: "action-document",
    reviewActionId: "review-123",
    actionType: SHELFCYCLE_ACTION_TYPES.PRODUCT_DOCUMENT_FOLLOWUP,
    executable: true,
    selectedTarget: {
      kind: "product",
      id: "prod-123",
      label: "G301-D"
    },
    fieldValues: {
      filePath: "/tmp/g301-sds.pdf"
    }
  });

  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/products/prod-123");
  assert.equal(submission.fields.filePath, "/tmp/g301-sds.pdf");
});
