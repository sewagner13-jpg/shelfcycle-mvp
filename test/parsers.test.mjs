import test from "node:test";
import assert from "node:assert/strict";

import { importCsv } from "../src/lib/csv-import.mjs";
import { parseContactInput } from "../src/lib/parse-contact.mjs";
import { parseEmailThread } from "../src/lib/parse-email-thread.mjs";
import { parseProductDocument } from "../src/lib/parse-product-document.mjs";

test("parseContactInput extracts common fields", () => {
  const result = parseContactInput(`
    Courtney Quinn
    Purchasing Manager
    Sun Coatings
    cquinn@suncoatings.example
    (813) 367-4444 x1903
    https://suncoatings.example
  `);

  assert.equal(result.fields.name, "Courtney Quinn");
  assert.equal(result.fields.companyName, "Sun Coatings");
  assert.equal(result.fields.email, "cquinn@suncoatings.example");
  assert.ok(result.fields.officePhone.includes("813"));
});

test("parseProductDocument identifies TDS and shipping fields", () => {
  const result = parseProductDocument(`
    Technical Data Sheet
    Product Name: ACCESS Organosilane G301
    Supplier: ACCESS Rudolf Technologies
    CAS: 2768-02-7
    Proper Shipping Name: Flammable liquid, n.o.s.
    Signal Word: Danger
  `);

  assert.equal(result.documentType, "TDS");
  assert.equal(result.fields.productName, "ACCESS Organosilane G301");
  assert.equal(result.fields.supplier, "ACCESS Rudolf Technologies");
  assert.equal(result.fields.casNumber, "2768-02-7");
  assert.equal(result.attachmentPlan.target, "product documents drawer");
});

test("parseEmailThread extracts subject and suggested contacts", () => {
  const result = parseEmailThread(
    `
      From: Sean Wagner <sean@clear-edge.net>
      To: Kaylib Rhinehart <kaylib.rhinehart@siegwerk.com>
      Subject: Re: Silica TDS 220/230 and 932

      Hey Kaylib, Trevor will send the silica info. I am requesting SDS and pricing for the offset.
    `,
    {
      products: [],
      customers: [],
      contacts: [],
      locations: []
    }
  );

  assert.equal(result.fields.subject, "Re: Silica TDS 220/230 and 932");
  assert.ok(result.suggestedCreates.some((item) => item.email === "kaylib.rhinehart@siegwerk.com"));
  assert.equal(result.draftNote.type, "Email");
});

test("importCsv maps catalog product inventory and hazmat fields", () => {
  const result = importCsv({
    fileName: "catalog.csv",
    csvText: `Code,Name,Package Qty.,UOM,On Order,On Hand,Available,Committed,Allocated,Avg. Unit Cost,Reorder Point,UN/NA Number,Packing Group,Hazard Class,Special Designation,Proper Shipping Name,Pallet,Packages per Pallet
ARG301-D,ACCESS Organosilane G301,441,POUND,0,10,10,0,0,$2.45,0,UN1993,III – Low danger,3 - Flammable Liquids,,Flammable liquid n.o.s.,Standard softwood,4`
  });

  assert.equal(result.entityType, "products");
  assert.equal(result.records[0].code, "ARG301-D");
  assert.equal(result.records[0].packageQty, "441");
  assert.equal(result.records[0].available, "10");
  assert.equal(result.records[0].avgUnitCost, "$2.45");
  assert.equal(result.records[0].unNumber, "UN1993");
  assert.equal(result.records[0].hazardClass, "3 - Flammable Liquids");
  assert.equal(result.records[0].packagesPerPallet, "4");
});
