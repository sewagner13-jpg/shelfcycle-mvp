import { buildAdvisory } from "./advisory.mjs";
import { detectWorkflow } from "./classify.mjs";
import { enrichWithClearEdgeIntelligence } from "./clearedge-intelligence.mjs";
import { buildFollowUpDraft } from "./follow-up.mjs";
import { matchEntity } from "./match.mjs";
import { compactWhitespace, safeArray } from "./normalize.mjs";
import { parseContactInput } from "./parse-contact.mjs";
import { parseCustomerInput } from "./parse-customer.mjs";
import { parseEmailThread } from "./parse-email-thread.mjs";
import { parseLocationInput } from "./parse-location.mjs";
import { parseProductDocument } from "./parse-product-document.mjs";
import { parseTranscript } from "./parse-transcript.mjs";

function normalizeReferenceData(referenceData = {}) {
  return {
    products: safeArray(referenceData.products),
    customers: safeArray(referenceData.customers),
    contacts: safeArray(referenceData.contacts),
    locations: safeArray(referenceData.locations),
    clearedgeIntelligence: safeArray(referenceData.clearedgeIntelligence ?? referenceData.notebookIntelligence)
  };
}

function buildWritePlan(result, refs) {
  switch (result.workflow) {
    case "call_report": {
      const customer = result.matches?.customer?.[0]?.candidate ?? null;
      return {
        destination: customer?.name
          ? `Customer > ${customer.name} > Notes > New Note`
          : "Customer > Notes > New Note",
        fields: {
          date: result.fields?.date ?? "",
          type: result.draftNote?.type ?? "Call",
          title: result.draftNote?.title ?? "",
          summary: result.draftNote?.summary ?? ""
        }
      };
    }
    case "email_thread": {
      const customer = result.matches?.customer?.[0]?.candidate ?? null;
      return {
        destination: customer?.name
          ? `Customer > ${customer.name} > Notes > New Note`
          : "Customer > Notes > New Note",
        fields: {
          date: result.fields?.date ?? "",
          type: "Email",
          title: result.draftNote?.title ?? "",
          summary: result.draftNote?.summary ?? ""
        }
      };
    }
    case "new_product": {
      const matchedProduct = result.matches?.product?.[0]?.candidate ?? null;
      const documentType = result.documentType ?? "SDS";

      return {
        destination: matchedProduct?.code
          ? `Products > ${matchedProduct.code}`
          : "Products > New Product Code",
        fields: {
          productName: result.fields?.productName ?? "",
          supplier: result.fields?.supplier ?? "",
          casNumber: result.fields?.casNumber ?? "",
          unNumber: result.fields?.unNumber ?? ""
        },
        attachments: [
          documentType === "SDS"
            ? "Attach SDS in product code safety attributes"
            : "Upload TDS in the product Documents drawer",
          documentType === "TDS" ? "Leave core product record unchanged if the product already exists" : ""
        ].filter(Boolean)
      };
    }
    case "new_customer":
      return {
        destination: "Customers > New Customer",
        fields: result.fields
      };
    case "new_contact": {
      const matchedCustomer = result.matches?.customer?.[0]?.candidate ?? null;

      return {
        destination: matchedCustomer?.name
          ? `Customer > ${matchedCustomer.name} > Contacts > New Contact`
          : "Customer > Contacts > New Contact",
        fields: result.fields
      };
    }
    case "new_location": {
      const matchedCustomer = result.matches?.customer?.[0]?.candidate ?? null;

      return {
        destination: matchedCustomer?.name
          ? `Customer > ${matchedCustomer.name} > Addresses > New Shipping Address`
          : "Customer > Addresses > New Shipping Address",
        fields: result.fields
      };
    }
    default:
      return {
        destination: "Review manually",
        fields: {}
      };
  }
}

function enrichWithMatches(result, refs, originalText) {
  const output = {
    ...result,
    matches: {
      ...(result.matches ?? {})
    },
    warnings: [...(result.warnings ?? [])]
  };

  if (result.workflow === "new_contact") {
    const customerQuery = [result.fields?.companyName, result.fields?.website, result.fields?.email]
      .filter(Boolean)
      .join(" ");

    output.matches.customer = matchEntity(customerQuery, refs.customers, ["name", "website", "email"], {
      minScore: 0.45
    });
    output.matches.contact = matchEntity(
      [result.fields?.name, result.fields?.email, result.fields?.officePhone].filter(Boolean).join(" "),
      refs.contacts,
      ["name", "email", "officePhone", "mobilePhone"],
      { minScore: 0.45 }
    );
  }

  if (result.workflow === "new_customer") {
    output.matches.customer = matchEntity(
      [result.fields?.name, result.fields?.website, result.fields?.email].filter(Boolean).join(" "),
      refs.customers,
      ["name", "website", "email", "phone"],
      { minScore: 0.45 }
    );
  }

  if (result.workflow === "new_location") {
    output.matches.customer = matchEntity(
      originalText,
      refs.customers,
      ["name", "website", "email", "phone"],
      { minScore: 0.42 }
    );
    output.matches.location = matchEntity(
      [result.fields?.name, result.fields?.street1, result.fields?.city, result.fields?.zip]
        .filter(Boolean)
        .join(" "),
      refs.locations,
      ["name", "street1", "city", "zip", "customerName"],
      { minScore: 0.45 }
    );
  }

  if (result.workflow === "new_product") {
    const productQuery = [result.fields?.productName, result.fields?.casNumber, originalText]
      .filter(Boolean)
      .join(" ");

    output.matches.product = matchEntity(productQuery, refs.products, ["code", "name", "family", "casNumber"], {
      minScore: 0.45
    });

    if (result.documentType === "TDS" && output.matches.product.length) {
      output.warnings.push("High-confidence product match found. This may be a document upload, not a new product.");
    }
  }

  return output;
}

export function analyzeInput({ text = "", workflow = "auto", referenceData = {} }) {
  const cleanedText = compactWhitespace(text);
  const refs = normalizeReferenceData(referenceData);
  const classification =
    workflow && workflow !== "auto"
      ? { workflow, confidence: 1, signals: ["manual override"] }
      : detectWorkflow(text, {
          knownChemicalTerms: [
            ...refs.products.flatMap((product) => [product.code, product.name, product.family, ...(product.synonyms ?? [])]),
            ...refs.clearedgeIntelligence.flatMap((entry) => [entry.entity, ...(entry.aliases ?? []), ...(entry.supplierNames ?? [])])
          ]
        });

  let result;

  switch (classification.workflow) {
    case "new_product":
      result = parseProductDocument(text);
      break;
    case "email_thread":
      result = parseEmailThread(text, refs);
      break;
    case "new_customer":
      result = parseCustomerInput(text);
      break;
    case "new_contact":
      result = parseContactInput(text);
      break;
    case "new_location":
      result = parseLocationInput(text);
      break;
    case "call_report":
    default:
      result = parseTranscript(text, refs);
      break;
  }

  const enriched = enrichWithMatches(result, refs, cleanedText);
  const intelligenceEnriched = enrichWithClearEdgeIntelligence(enriched, {
    text: cleanedText,
    referenceData: refs
  });
  const advisory = buildAdvisory(intelligenceEnriched, cleanedText);
  const followUpDraft = buildFollowUpDraft(intelligenceEnriched);

  return {
    workflow: classification.workflow,
    confidence: classification.confidence,
    signals: classification.signals,
    referenceCounts: {
      products: refs.products.length,
      customers: refs.customers.length,
      contacts: refs.contacts.length,
      locations: refs.locations.length,
      clearedgeIntelligence: refs.clearedgeIntelligence.length,
      notebookIntelligence: refs.clearedgeIntelligence.length
    },
    ...intelligenceEnriched,
    ...advisory,
    followUpDraft,
    writePlan: buildWritePlan(intelligenceEnriched, refs)
  };
}
