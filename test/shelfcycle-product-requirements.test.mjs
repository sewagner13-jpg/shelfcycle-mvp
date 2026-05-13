import test from "node:test";
import assert from "node:assert/strict";

import {
  missingShelfCycleProductFields,
  productRequirementsPromptBlock,
  shelfCycleProductRequirementsForFields
} from "../src/lib/shelfcycle-product-requirements.mjs";

test("ShelfCycle product requirements identify missing product-code fields", () => {
  const missing = missingShelfCycleProductFields({
    code: "XP1127-D",
    productFamily: "ONGRONAT XP 1127",
    packagingType: "Fixed",
    supplierType: "Variable"
  });

  assert.deepEqual(missing.map((item) => item.key), ["packaging", "quantityPerPackage"]);
});

test("ShelfCycle product requirements treat fixed supplier as conditional required", () => {
  const requirements = shelfCycleProductRequirementsForFields({
    code: "XP1127-D",
    productFamily: "ONGRONAT XP 1127",
    packagingType: "Fixed",
    packaging: "Drum (kg)",
    quantityPerPackage: "250 kg",
    supplierType: "Fixed"
  });

  assert.equal(requirements.readyForProductCodeCreate, false);
  assert.ok(requirements.missingRequiredFields.some((item) => item.key === "supplier"));
});

test("product requirements prompt explains existing-family reuse rule", () => {
  const prompt = productRequirementsPromptBlock();

  assert.match(prompt, /Existing-family reuse rule/);
  assert.match(prompt, /Only vary package-specific Product Code fields/);
});
