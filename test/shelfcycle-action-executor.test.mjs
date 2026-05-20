import test from "node:test";
import assert from "node:assert/strict";

import { collectProposedActions, SHELFCYCLE_ACTION_TYPES } from "../src/lib/shelfcycle-action-router.mjs";
import {
  buildContactSubmission,
  buildContactUpdateSubmission,
  buildCustomerSubmission,
  buildCustomerNoteSubmission,
  buildLocationSubmission,
  buildPricingSubmission,
  buildProductDocumentSubmission,
  buildProductSubmission,
  buildSupplierSubmission,
  buildSupplierUpdateSubmission
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

test("buildLocationSubmission creates supplier location payload", () => {
  const submission = buildLocationSubmission(executableReviewAction(), {
    id: "action-location",
    reviewActionId: "review-123",
    actionType: SHELFCYCLE_ACTION_TYPES.LOCATION_CREATE,
    executable: true,
    selectedTarget: {
      kind: "supplier",
      id: "supplier-123",
      label: "Kessler Chemical"
    },
    fieldValues: {
      companyType: "supplier",
      name: "Kessler Chemical",
      streetAddress: "1 Main St",
      city: "Charlotte",
      stateRegion: "NC",
      zip: "28202",
      country: "United States"
    }
  });

  assert.equal(submission.recordType, "location");
  assert.equal(submission.actionType, SHELFCYCLE_ACTION_TYPES.LOCATION_CREATE);
  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/suppliers/supplier-123/locations");
  assert.equal(submission.supplierId, "supplier-123");
  assert.equal(submission.customerId, "");
  assert.equal(submission.fields.name, "Kessler Chemical");
  assert.equal(submission.fields.companyType, "supplier");
});

test("buildLocationSubmission creates customer shipping address payload", () => {
  const submission = buildLocationSubmission(executableReviewAction(), {
    id: "action-location",
    reviewActionId: "review-123",
    actionType: SHELFCYCLE_ACTION_TYPES.LOCATION_CREATE,
    executable: true,
    selectedTarget: {
      kind: "customer",
      id: "customer-123",
      label: "Surface Koatings"
    },
    fieldValues: {
      companyType: "customer",
      name: "Surface Koatings",
      streetAddress: "2 Industrial Way",
      defaultShippingInstructions: "Call before delivery."
    }
  });

  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/customers/customer-123/addresses");
  assert.equal(submission.customerId, "customer-123");
  assert.equal(submission.supplierId, "");
  assert.equal(submission.fields.defaultShippingInstructions, "Call before delivery.");
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

test("buildSupplierUpdateSubmission creates supplier update payload", () => {
  const submission = buildSupplierUpdateSubmission(executableReviewAction(), {
    id: "action-supplier-update",
    reviewActionId: "review-123",
    actionType: SHELFCYCLE_ACTION_TYPES.SUPPLIER_UPDATE,
    executable: true,
    selectedTarget: {
      kind: "supplier",
      id: "supplier-123",
      label: "Green Chemical"
    },
    fieldValues: {
      phone: "+82-2-3158-8827",
      website: "http://www.korgc.com"
    }
  });

  assert.equal(submission.actionType, SHELFCYCLE_ACTION_TYPES.SUPPLIER_UPDATE);
  assert.equal(submission.supplierId, "supplier-123");
  assert.equal(submission.supplierName, "Green Chemical");
  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/suppliers/supplier-123");
  assert.equal(submission.fields.phone, "+82-2-3158-8827");
});

test("buildContactUpdateSubmission creates contact update payload", () => {
  const submission = buildContactUpdateSubmission(executableReviewAction(), {
    id: "action-contact-update",
    reviewActionId: "review-123",
    actionType: SHELFCYCLE_ACTION_TYPES.CONTACT_UPDATE,
    executable: true,
    selectedTarget: {
      kind: "contact",
      id: "contact-123",
      label: "Doyun Kim"
    },
    fieldValues: {
      name: "Doyun Kim",
      title: "Manager | Chemical Sales team",
      email: "dykim1@korgc.com",
      companyType: "supplier",
      companyTarget: {
        kind: "supplier",
        id: "supplier-123",
        label: "Green Chemical"
      }
    }
  });

  assert.equal(submission.actionType, SHELFCYCLE_ACTION_TYPES.CONTACT_UPDATE);
  assert.equal(submission.contactId, "contact-123");
  assert.equal(submission.contactName, "Doyun Kim");
  assert.equal(submission.supplierId, "supplier-123");
  assert.equal(submission.supplierName, "Green Chemical");
  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/contacts/contact-123");
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
      packagingType: "fixed package",
      packaging: "Drum",
      quantityPerPackage: "500",
      unitOfMeasure: "kilograms",
      supplierType: "variable",
      sdsPath: "/tmp/new-product-sds.pdf"
    }
  });

  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/products");
  assert.equal(submission.fields.code, "NEW-D");
  assert.equal(submission.fields.packagingType, "Fixed");
  assert.equal(submission.fields.unitOfMeasure, "kg");
  assert.equal(submission.fields.supplierType, "Variable");
  assert.equal(submission.fields.sdsPath, "/tmp/new-product-sds.pdf");
});

test("buildProductSubmission rejects missing required product-code fields before automation", () => {
  assert.throws(
    () => buildProductSubmission(executableReviewAction(), {
      id: "action-product-missing",
      reviewActionId: "review-123",
      actionType: SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE,
      executable: true,
      fieldValues: {
        code: "NEW-D",
        productFamily: "New Product"
      }
    }),
    /missing required ShelfCycle fields/i
  );
});

test("buildProductSubmission normalizes known supplier aliases before automation", () => {
  const submission = buildProductSubmission(executableReviewAction(), {
    id: "action-product-wb",
    reviewActionId: "review-123",
    actionType: SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE,
    executable: true,
    fieldValues: {
      code: "WB-NPGDGE",
      productFamily: "Epoxy Reactive Diluents",
      packagingType: "variable packaging",
      packaging: "drums",
      quantityPerPackage: "200",
      unitOfMeasure: "kilograms",
      supplierType: "fixed",
      supplier: "WINBOND MATERIALS CO., LTD."
    }
  });

  assert.equal(submission.fields.packagingType, "Variable");
  assert.equal(submission.fields.packaging, "Drum (kg)");
  assert.equal(submission.fields.unitOfMeasure, "kg");
  assert.equal(submission.fields.supplierType, "Fixed");
  assert.equal(submission.fields.supplier, "Winbond Materials Co., Ltd.");
});

test("buildProductSubmission creates existing-product update payload", () => {
  const submission = buildProductSubmission(executableReviewAction(), {
    id: "action-product-update",
    reviewActionId: "review-123",
    actionType: SHELFCYCLE_ACTION_TYPES.PRODUCT_CREATE_OR_UPDATE,
    executable: true,
    selectedTarget: {
      kind: "product",
      id: "prod-123",
      label: "RUCOLAC B-591"
    },
    fieldValues: {
      mode: "update",
      supplier: "Rudolf",
      casNumber: "123-45-6"
    }
  });

  assert.equal(submission.url, "https://app.shelfcycle.com/org-clearedge/products/prod-123");
  assert.equal(submission.productId, "prod-123");
  assert.equal(submission.productName, "RUCOLAC B-591");
  assert.equal(submission.fields.mode, "update");
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
