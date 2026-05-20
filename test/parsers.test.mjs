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
    Product Code: ARG301-D
    Product Name: ACCESS Organosilane G301
    Product Family: ACCESS Organosilane
    Supplier: ACCESS Rudolf Technologies
    CAS: 2768-02-7
    Packaging: Drum
    Quantity per package: 441 lb
    Proper Shipping Name: Flammable liquid, n.o.s.
    Signal Word: Danger
  `);

  assert.equal(result.documentType, "TDS");
  assert.equal(result.fields.code, "ARG301-D");
  assert.equal(result.fields.productName, "ACCESS Organosilane G301");
  assert.equal(result.fields.productFamily, "ACCESS Organosilane");
  assert.equal(result.fields.supplier, "ACCESS Rudolf Technologies");
  assert.equal(result.fields.casNumber, "2768-02-7");
  assert.equal(result.fields.packaging, "Drum");
  assert.equal(result.fields.quantityPerPackage, "441 lb");
  assert.equal(result.attachmentPlan.target, "product documents drawer");
});

test("parseProductDocument maps pasted ShelfCycle product sections into fields", () => {
  const result = parseProductDocument(`
    === Make or update Product Family ===
    Product Family: Epoxy Reactive Diluents
    Chemical Name: Neopentyl glycol diglycidyl ether
    Product Family Description: Low viscosity aliphatic glycidyl ether functional monomer used as a reactive diluent.
    Aliases: NPGDGE; Heloxy WC68
    CAS Number: 17557-23-2
    Recommended Use: Reactive diluent for epoxy resins.

    === Make or update Product Codes / Packages ===
    Product Code: WB-NPGDGE
    Product Name: Neopentyl glycol diglycidyl ether
    Packaging Type: Variable
    Packaging: Drum / IBC / ISO Tank
    Quantity per Package: 200
    Unit of Measure: kg
    Supplier Type: Fixed
    Supplier: Winbond Materials Co., Ltd
    Document Type: SDS
    SDS Local File Path:

    === Shipping / Safety / Freight ===
    UN/NA Number: Not Applicable
    Packing Group: NOT REGULATED
    Hazard Class: Not regulated
    Special Designation: None
    Proper Shipping Name: Not regulated (NONH for all modes of transport)
    GHS Signal Word: Warning
    Hazard Symbols: Exclamation Mark (GHS07)
    NMFC Code: 46030
    Freight Class: 55
    Pallet: Standard hardwood
    Packages per Pallet: 4

    === Physical / Storage ===
    Physical State: Liquid
    Appearance: Clear transparent liquid
    Density: 1.04 g/ml @ 25°C
    Specific Gravity: 1.04
    Viscosity: 15-25 mPa·s @ 25°C
    Flash Point: 235.4°F (113°C)
    Boiling Point: 103-107°C @ 1mmHg
    Storage: Store in a cool, dry, dark location.
    Shelf Life: 12 Months
    Document Date: 2023-01-01
  `);

  assert.equal(result.documentType, "SDS");
  assert.equal(result.fields.productFamily, "Epoxy Reactive Diluents");
  assert.equal(result.fields.chemicalName, "Neopentyl glycol diglycidyl ether");
  assert.equal(result.fields.productFamilyDescription, "Low viscosity aliphatic glycidyl ether functional monomer used as a reactive diluent.");
  assert.equal(result.fields.aliases, "NPGDGE; Heloxy WC68");
  assert.equal(result.fields.casNumber, "17557-23-2");
  assert.equal(result.fields.recommendedUse, "Reactive diluent for epoxy resins.");
  assert.equal(result.fields.code, "WB-NPGDGE");
  assert.equal(result.fields.productName, "Neopentyl glycol diglycidyl ether");
  assert.equal(result.fields.packagingType, "Variable");
  assert.equal(result.fields.packaging, "Drum / IBC / ISO Tank");
  assert.equal(result.fields.quantityPerPackage, "200");
  assert.equal(result.fields.unitOfMeasure, "kg");
  assert.equal(result.fields.supplierType, "Fixed");
  assert.equal(result.fields.supplier, "Winbond Materials Co., Ltd");
  assert.equal(result.fields.documentType, "SDS");
  assert.equal(result.fields.unNumber, "Not Applicable");
  assert.equal(result.fields.packingGroup, "NOT REGULATED");
  assert.equal(result.fields.hazardClass, "Not regulated");
  assert.equal(result.fields.specialDesignation, "None");
  assert.equal(result.fields.properShippingName, "Not regulated (NONH for all modes of transport)");
  assert.equal(result.fields.signalWord, "Warning");
  assert.equal(result.fields.hazardSymbols, "Exclamation Mark (GHS07)");
  assert.equal(result.fields.nmfcCode, "46030");
  assert.equal(result.fields.freightClass, "55");
  assert.equal(result.fields.pallet, "Standard hardwood");
  assert.equal(result.fields.packagesPerPallet, "4");
  assert.equal(result.fields.physicalState, "Liquid");
  assert.equal(result.fields.appearance, "Clear transparent liquid");
  assert.equal(result.fields.density, "1.04 g/ml @ 25°C");
  assert.equal(result.fields.specificGravity, "1.04");
  assert.equal(result.fields.viscosity, "15-25 mPa·s @ 25°C");
  assert.equal(result.fields.flashPoint, "235.4°F (113°C)");
  assert.equal(result.fields.boilingPoint, "103-107°C @ 1mmHg");
  assert.equal(result.fields.storage, "Store in a cool, dry, dark location.");
  assert.equal(result.fields.shelfLife, "12 Months");
  assert.equal(result.fields.documentDate, "2023-01-01");
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
  assert.ok(result.draftNote.summary.includes("Thread Summary"));
  assert.ok(result.draftNote.summary.includes("Recommended next step"));
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

test("importCsv treats customer exports with contact-information columns as customers", () => {
  const result = importCsv({
    fileName: "customers-2026-05-03.csv",
    csvText: `Name,Email,Contact Information,Default Sales Person,Default CSR,Amount Due,Credit Limit,Status,Primary Billing Address
Actega North America,,856-735-2017 https://www.actega.com/us/en/,,,$0.00,"$100,000.00",ACTIVE,"1450 Taylors Lane, Cinnaminson, NJ, 08077, US"`
  });

  assert.equal(result.entityType, "customers");
  assert.equal(result.records[0].name, "Actega North America");
  assert.equal(result.records[0].phone, "856-735-2017 https://www.actega.com/us/en/");
});
