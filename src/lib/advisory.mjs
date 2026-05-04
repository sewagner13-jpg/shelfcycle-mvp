function pushUnique(list, value) {
  if (!value || list.includes(value)) {
    return;
  }

  list.push(value);
}

function hasPattern(text = "", pattern) {
  return pattern.test(text);
}

function collectText(result = {}, originalText = "") {
  return [
    originalText,
    result.draftNote?.summary,
    result.fields?.productName,
    result.fields?.customerName,
    result.fields?.name,
    result.fields?.title
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCallReportAdvisory(result, originalText) {
  const owner = [];
  const sales = [];
  const procurement = [];
  const automation = [];
  const text = collectText(result, originalText);
  const customerName = result.matches?.customer?.[0]?.candidate?.name || result.fields?.customerName || "the account";
  const actionItems = result.rawExtracts?.actionItems ?? [];
  const missingContacts = (result.suggestedCreates ?? []).filter((item) => item.type === "contact");

  if (actionItems.length) {
    pushUnique(sales, `Turn the note into a follow-up queue for ${customerName}.`);
  }

  if (missingContacts.length) {
    pushUnique(sales, `Review ${missingContacts.length} missing contact draft(s) before the next follow-up.`);
  }

  if (hasPattern(text, /\bpricing\b|\bquote\b|\bcost\b/i)) {
    pushUnique(sales, `Draft the pricing follow-up for ${customerName}.`);
    pushUnique(procurement, "Confirm current cost basis, pack size, and supplier availability before quoting.");
  }

  if (hasPattern(text, /\bsample\b|\btrial\b|\btest\b/i)) {
    pushUnique(sales, `Track sample and trial status for ${customerName}.`);
    pushUnique(procurement, "Check sample inventory or request supplier sample support.");
  }

  if (hasPattern(text, /\bsds\b|\btds\b|\bcoa\b|\bdocument/i)) {
    pushUnique(sales, "Send or confirm the requested technical documents.");
    pushUnique(procurement, "Chase missing supplier documentation and attach it to the product record.");
  }

  if (hasPattern(text, /\bfreight\b|\bpallet\b|\btote\b|\bdrum\b|\bcontainer\b|\bship\b|\border\b/i)) {
    pushUnique(procurement, "Validate packaging, freight path, and available inventory.");
  }

  if (hasPattern(text, /\bprice increase\b|\binventory\b|\bstock\b|\bscale up\b|\bnew line\b|\bstrategic\b/i)) {
    pushUnique(owner, `Review whether ${customerName} warrants stocking, price action, or deeper account focus.`);
  }

  pushUnique(automation, "After each transcript paste, match customer, contacts, and products, then draft the note automatically.");

  if (hasPattern(text, /\bpricing\b|\bquote\b|\bsample\b|\bdocument\b|\bsds\b|\btds\b/i)) {
    pushUnique(automation, "Generate a same-day follow-up email draft from Gmail using the note and matched entities.");
  }

  pushUnique(automation, "Create a daily action digest grouped into owner, sales, and procurement queues.");

  return { owner, sales, procurement, automation };
}

function buildProductAdvisory(result, originalText) {
  const owner = [];
  const sales = [];
  const procurement = [];
  const automation = [];
  const text = collectText(result, originalText);
  const productName = result.fields?.productName || "this product";
  const matchedProduct = result.matches?.product?.[0]?.candidate ?? null;

  pushUnique(procurement, `Validate supplier, CAS, pack size, MOQ, lead time, and landed cost for ${productName}.`);

  if (result.documentType === "TDS" && matchedProduct?.code) {
    pushUnique(procurement, `Upload the TDS into ${matchedProduct.code} Documents and avoid creating a duplicate product.`);
  } else {
    pushUnique(procurement, "Review the product code draft and attach the compliance document only after approval.");
  }

  pushUnique(sales, `Map ${productName} to likely target accounts and incumbent offsets.`);
  pushUnique(owner, `Decide whether ${productName} should stay opportunistic, become stocked inventory, or fit a private-label lane.`);

  if (hasPattern(text, /\bhazard\b|\bun\b|\bpacking group\b/i)) {
    pushUnique(procurement, "Confirm hazmat handling, storage, and shipping details before first sale.");
  }

  pushUnique(automation, "On SDS/TDS paste, draft the product intake, match existing records, and flag likely duplicates.");
  pushUnique(automation, "Build a product launch checklist covering documents, pricing, target accounts, and stocking decision.");

  return { owner, sales, procurement, automation };
}

function buildCustomerAdvisory(result) {
  const owner = [];
  const sales = [];
  const procurement = [];
  const automation = [];
  const customerName = result.fields?.name || "this customer";

  pushUnique(owner, `Set credit posture, payment terms, account ownership, and strategic priority for ${customerName}.`);
  pushUnique(sales, `Qualify ${customerName} by market, applications, target products, and next meeting.`);
  pushUnique(automation, "On new customer intake, prefill the customer record and generate an account setup checklist.");

  return { owner, sales, procurement, automation };
}

function buildContactAdvisory(result) {
  const owner = [];
  const sales = [];
  const procurement = [];
  const automation = [];
  const name = result.fields?.name || "this contact";

  pushUnique(sales, `Assign ${name} to the right account, select document types, and queue the next touch.`);

  if (hasPattern(result.fields?.title || "", /\bdirector\b|\bvp\b|\bowner\b|\bpresident\b/i)) {
    pushUnique(owner, `Mark ${name} as a strategic stakeholder in the account map.`);
  }

  pushUnique(automation, "Extract contacts from Gmail threads and prefill new contact forms before manual review.");

  return { owner, sales, procurement, automation };
}

function buildLocationAdvisory(result) {
  const owner = [];
  const sales = [];
  const procurement = [];
  const automation = [];
  const locationName = result.fields?.name || "this ship-to location";

  pushUnique(procurement, `Verify freight needs, receiving constraints, and shipping instructions for ${locationName}.`);
  pushUnique(sales, "Link the address to the right customer and opportunity before shipment.");
  pushUnique(automation, "Parse pasted address blocks into shipping locations and flag likely duplicates.");

  return { owner, sales, procurement, automation };
}

export function buildAdvisory(result = {}, originalText = "") {
  let advisory;

  switch (result.workflow) {
    case "new_product":
      advisory = buildProductAdvisory(result, originalText);
      break;
    case "new_customer":
      advisory = buildCustomerAdvisory(result, originalText);
      break;
    case "new_contact":
      advisory = buildContactAdvisory(result, originalText);
      break;
    case "new_location":
      advisory = buildLocationAdvisory(result, originalText);
      break;
    case "email_thread":
    case "call_report":
    default:
      advisory = buildCallReportAdvisory(result, originalText);
      break;
  }

  return {
    roleWorklists: {
      owner: advisory.owner,
      sales: advisory.sales,
      procurement: advisory.procurement
    },
    automationIdeas: advisory.automation
  };
}
