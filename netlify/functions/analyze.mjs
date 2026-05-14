import { analyzeInput } from "../../src/lib/analyze.mjs";
import { createReviewActionRecord } from "../../src/lib/local-review-actions.mjs";
import {
  refineProductDocumentWithAi,
  resolveProductDocumentAiConfig
} from "../../src/lib/product-document-ai.mjs";
import {
  hasUsefulProductDocumentFields,
  mergeProductDocumentExtractionIntoResult
} from "../../src/lib/product-document-source.mjs";
import { shelfCycleProductRequirementsForFields } from "../../src/lib/shelfcycle-product-requirements.mjs";
import { getEnv } from "./_shared/env.mjs";
import { loadBriefSettings, loadKnowledgeBundle, saveReviewAction } from "./_shared/knowledge-store.mjs";

const HOSTED_ANALYZE_OPENAI_TIMEOUT_MS = 7000;

function compactWhitespace(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values = []) {
  return [...new Set(values.map(compactWhitespace).filter(Boolean))];
}

function productFieldLabel(field = "") {
  return {
    shelfCycleReadySummary: "ShelfCycle Summary",
    productName: "Product Name",
    code: "Product Code",
    productFamily: "Product Family",
    productFamilyDescription: "Product Family Description",
    chemicalName: "Chemical Name",
    aliases: "Aliases",
    packagingType: "Packaging Type",
    supplierType: "Supplier Type",
    supplier: "Supplier",
    casNumber: "CAS",
    packaging: "Packaging",
    quantityPerPackage: "Quantity per Package",
    unitOfMeasure: "Unit of Measure",
    unNumber: "UN Number",
    packingGroup: "Packing Group",
    hazardClass: "Hazard Class",
    specialDesignation: "Special Designation",
    properShippingName: "Proper Shipping Name",
    signalWord: "GHS Signal Word",
    hazardSymbols: "Hazard Symbols",
    freightClass: "Freight Class",
    nmfcCode: "NMFC"
  }[field] || String(field || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}

function productAiLines(aiDerivedFields = [], fields = {}) {
  const seen = new Set();
  const lines = [];

  for (const item of aiDerivedFields) {
    const field = compactWhitespace(item.field);
    const value = compactWhitespace(item.value);

    if (!field || !value || ["documentType", "extractedText"].includes(field)) {
      continue;
    }

    const key = `${field}:${value}`;
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(`${productFieldLabel(field)}: ${value}`);
    }
  }

  for (const [field, value] of Object.entries(fields ?? {})) {
    const cleanValue = compactWhitespace(value);

    if (!field || !cleanValue || ["documentType", "extractedText"].includes(field)) {
      continue;
    }

    const key = `${field}:${cleanValue}`;
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(`${productFieldLabel(field)}: ${cleanValue}`);
    }
  }

  return lines;
}

function mergeReferenceData(payloadReferenceData = {}, hostedKnowledge = {}) {
  const output = {};

  for (const key of ["products", "customers", "contacts", "locations", "clearedgeIntelligence", "notebookIntelligence"]) {
    output[key] = [
      ...(Array.isArray(hostedKnowledge[key]) ? hostedKnowledge[key] : []),
      ...(Array.isArray(payloadReferenceData[key]) ? payloadReferenceData[key] : [])
    ];
  }

  if (!output.clearedgeIntelligence.length && output.notebookIntelligence.length) {
    output.clearedgeIntelligence = output.notebookIntelligence;
  }

  return output;
}

function openAiConfigFromSettings(settings = {}) {
  const syncedOpenAiConfig = settings.openAiConfig ?? settings.openAIConfig ?? settings.aiBriefConfig ?? {};
  const configuredTimeout = Number.parseInt(String(
    syncedOpenAiConfig.productDocumentTimeoutMs ||
      syncedOpenAiConfig.timeoutMs ||
      getEnv("OPENAI_PRODUCT_DOCUMENT_TIMEOUT_MS") ||
      ""
  ), 10);

  return {
    apiKey: syncedOpenAiConfig.apiKey || getEnv("OPENAI_API_KEY") || "",
    model: syncedOpenAiConfig.productDocumentModel || syncedOpenAiConfig.model || getEnv("OPENAI_PRODUCT_DOCUMENT_MODEL") || getEnv("OPENAI_MODEL") || "",
    productDocumentModel: syncedOpenAiConfig.productDocumentModel || getEnv("OPENAI_PRODUCT_DOCUMENT_MODEL") || "",
    timeoutMs: Math.min(
      Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : HOSTED_ANALYZE_OPENAI_TIMEOUT_MS,
      HOSTED_ANALYZE_OPENAI_TIMEOUT_MS
    )
  };
}

function productIntakeSubject(result = {}) {
  const fields = result.fields ?? {};
  const label = fields.code || fields.productName || fields.productFamily || "Product document";
  return `${result.documentType || "SDS/TDS"} intake - ${label}`;
}

function withProductWritePlan(result = {}) {
  if (result.workflow !== "new_product") {
    return result;
  }

  const matchedProduct = result.matches?.product?.[0]?.candidate ?? null;
  const matchedFamily = matchedProduct?.family || matchedProduct?.productFamily || "";
  const fields = {
    ...(result.fields ?? {}),
    productFamily: result.fields?.productFamily || matchedFamily,
    packagingType: result.fields?.packagingType || "Fixed",
    supplierType: result.fields?.supplierType || "Variable"
  };
  const documentType = result.documentType ?? fields.documentType ?? "SDS";
  const shelfCycleRequirements = shelfCycleProductRequirementsForFields(fields);

  return {
    ...result,
    fields,
    shelfCycleRequirements,
    writePlan: {
      ...(result.writePlan ?? {}),
      destination: matchedProduct?.code || matchedProduct?.name
        ? `Products > ${matchedProduct.code || matchedProduct.name}`
        : "Products > New Product Code",
      fields: {
        productName: fields.productName ?? "",
        code: fields.code ?? "",
        productFamily: fields.productFamily ?? "",
        supplier: fields.supplier ?? "",
        casNumber: fields.casNumber ?? "",
        packagingType: fields.packagingType ?? "",
        packaging: fields.packaging ?? "",
        quantityPerPackage: fields.quantityPerPackage ?? "",
        supplierType: fields.supplierType ?? "",
        unNumber: fields.unNumber ?? "",
        packingGroup: fields.packingGroup ?? "",
        properShippingName: fields.properShippingName ?? "",
        freightClass: fields.freightClass ?? "",
        nmfcCode: fields.nmfcCode ?? "",
        hazardClass: fields.hazardClass ?? "",
        specialDesignation: fields.specialDesignation ?? "",
        signalWord: fields.signalWord ?? "",
        hazardSymbols: fields.hazardSymbols ?? "",
        shelfCycleReadySummary: fields.shelfCycleReadySummary ?? ""
      },
      missingRequiredFields: shelfCycleRequirements.missingRequiredFields.map((field) => field.message || field.label),
      readyForProductCodeCreate: shelfCycleRequirements.readyForProductCodeCreate,
      requirementSource: shelfCycleRequirements.source,
      aiDerivedFields: result.aiDerivedFields ?? [],
      attachments: [
        documentType === "SDS"
          ? "Attach SDS in product code safety attributes"
          : "Upload TDS in the product Documents drawer",
        matchedProduct ? "Existing product matched. Prefer update/document upload over duplicate create." : "",
        matchedProduct?.family || matchedProduct?.productFamily
          ? "Existing Product Family matched. Reuse family-level CAS, hazmat, GHS, and shipping identity; only vary package size, product code, supplier/package logistics, and documents that differ."
          : ""
      ].filter(Boolean)
    }
  };
}

function reviewUrls(req, action = {}) {
  const base = new URL(req.url).origin;
  const reviewUrl = `${base}/review-action.html?id=${encodeURIComponent(action.id)}&token=${encodeURIComponent(action.viewToken)}`;

  return {
    reviewUrl,
    submitUrl: `${base}/review-submit.html?reviewUrl=${encodeURIComponent(reviewUrl)}`
  };
}

function sanitizeReviewAction(action = null) {
  if (!action) {
    return null;
  }

  const { viewToken, ...safe } = action;
  return safe;
}

async function hostedAnalyzeProduct(payload = {}, referenceData = {}) {
  const inputBody = String(payload.text || "");
  let result = analyzeInput({
    ...payload,
    text: inputBody,
    referenceData
  });

  if (result.workflow !== "new_product") {
    return result;
  }

  const settings = await loadBriefSettings().catch(() => ({})) ?? {};
  const openAiConfig = openAiConfigFromSettings(settings);
  const productAiConfig = resolveProductDocumentAiConfig(openAiConfig);
  const productDocument = payload.productDocument ?? {};
  const baseProductResult = hasUsefulProductDocumentFields(productDocument.fields)
    ? mergeProductDocumentExtractionIntoResult(result, productDocument)
    : result;
  const refinedResult = productAiConfig.enabled
    ? await refineProductDocumentWithAi({
      text: inputBody,
      result: baseProductResult,
      config: openAiConfig
    })
    : {
      ...baseProductResult,
      warnings: uniqueStrings([
        ...(baseProductResult.warnings ?? []),
        "OpenAI product-document parsing is not configured. Only basic hosted text parsing ran."
      ])
    };
  const aiLines = productAiLines(refinedResult.aiDerivedFields ?? [], refinedResult.fields ?? {});

  if (aiLines.length) {
    const rerun = analyzeInput({
      ...payload,
      text: [inputBody, "AI-derived ShelfCycle fields:", aiLines.join("\n")].filter(Boolean).join("\n\n"),
      referenceData
    });

    result = {
      ...rerun,
      fields: {
        ...(rerun.fields ?? {}),
        ...(refinedResult.fields ?? {})
      },
      aiDerivedFields: refinedResult.aiDerivedFields ?? [],
      missingShelfCycleFields: refinedResult.missingShelfCycleFields ?? [],
      shelfCycleNotes: refinedResult.shelfCycleNotes ?? [],
      warnings: uniqueStrings([
        ...(rerun.warnings ?? []),
        ...(refinedResult.warnings ?? [])
      ])
    };
  } else {
    result = refinedResult;
  }

  return withProductWritePlan(result);
}

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "METHOD_NOT_ALLOWED", message: "Method not allowed." }, { status: 405 });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const hostedKnowledge = await loadKnowledgeBundle().catch(() => ({})) ?? {};
    const referenceData = mergeReferenceData(payload.referenceData ?? {}, hostedKnowledge);
    const result = await hostedAnalyzeProduct(payload, referenceData);
    let reviewAction = null;

    if (result.workflow === "new_product") {
      reviewAction = createReviewActionRecord({
        workflow: "new_product",
        subject: productIntakeSubject(result),
        summary: "Review this SDS/TDS product intake before any ShelfCycle product create or update.",
        analysis: result,
        state: {
          status: "waiting_approval",
          needsReply: false,
          waiting: false
        },
        workspaceArtifacts: {
          attachments: (payload.files ?? []).map((file) => ({
            filename: file.fileName || file.name || "",
            mimeType: file.mimeType || file.type || "",
            size: file.size || 0
          })),
          driveFileIds: [],
          driveFiles: [],
          driveScopeAvailable: true,
          driveError: ""
        }
      });
      const urls = reviewUrls(req, reviewAction);
      reviewAction.reviewUrl = urls.reviewUrl;
      reviewAction.submitUrl = urls.submitUrl;

      await saveReviewAction(reviewAction);
    }

    return Response.json({
      ...result,
      reviewAction: sanitizeReviewAction(reviewAction),
      reviewUrl: reviewAction?.reviewUrl || "",
      submitUrl: reviewAction?.submitUrl || "",
      proposedActions: reviewAction?.proposedActions ?? [],
      executableActions: reviewAction?.executableActions ?? [],
      source: "netlify"
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: "ANALYZE_FAILED",
      message: error instanceof Error ? error.message : "Analyze request failed."
    }, { status: 500 });
  }
};

export const config = {
  path: "/api/analyze"
};
