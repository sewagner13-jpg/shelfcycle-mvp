function toBulletLines(items = [], limit = 3) {
  return items
    .filter(Boolean)
    .slice(0, limit)
    .map((item) => `- ${item}`)
    .join("\n");
}

function firstName(fullName = "") {
  return String(fullName).trim().split(/\s+/)[0] ?? "";
}

function buildCallOrEmailFollowUp(result = {}) {
  const matchedContact = result.matches?.contacts?.[0]?.candidate ?? null;
  const suggestedContact = result.suggestedCreates?.find((item) => item.type === "contact") ?? null;
  const participant = result.rawExtracts?.participants?.find((item) => !item.internal) ?? null;
  const name =
    matchedContact?.name || suggestedContact?.name || participant?.name || result.fields?.customerName || "there";
  const customerName = result.matches?.customer?.[0]?.candidate?.name || result.fields?.customerName || "";
  const productNames =
    result.matches?.products?.slice(0, 3).map((entry) => entry.candidate?.name || entry.candidate?.code).filter(Boolean) ?? [];
  const actionItems = result.rawExtracts?.actionItems ?? [];
  const keyPoints = result.rawExtracts?.keyPoints ?? [];
  const topic =
    result.fields?.subject ||
    productNames[0] ||
    customerName ||
    (result.workflow === "email_thread" ? "your email" : "today's discussion");
  const subjectPrefix = result.workflow === "email_thread" && result.fields?.subject ? "Re: " : "Follow-up: ";
  const bodyLines = [
    `Hi ${firstName(name)},`,
    "",
    `Thanks for the ${result.workflow === "email_thread" ? "update" : "time"} regarding ${topic}.`,
    ""
  ];

  if (actionItems.length) {
    bodyLines.push("Here is what I have on my side:");
    bodyLines.push(toBulletLines(actionItems));
    bodyLines.push("");
  } else if (keyPoints.length) {
    bodyLines.push("Here is my quick recap:");
    bodyLines.push(toBulletLines(keyPoints));
    bodyLines.push("");
  }

  if (productNames.length) {
    bodyLines.push(`I can keep moving on ${productNames.join(", ")} and send over anything you need next.`);
  } else {
    bodyLines.push("I can keep things moving and send over anything you need next.");
  }

  bodyLines.push("Please let me know if you want me to send pricing, samples, or documentation.");
  bodyLines.push("");
  bodyLines.push("Best,");
  bodyLines.push("Sean");

  return {
    to: matchedContact?.email || suggestedContact?.email || participant?.email || "",
    subject: `${subjectPrefix}${topic}`.trim(),
    body: bodyLines.join("\n"),
    rationale: "Drafted from the current note or email thread to shorten follow-up time."
  };
}

function buildProductFollowUp(result = {}) {
  const supplier = result.fields?.supplier || "the supplier";
  const productName = result.fields?.productName || "the product";
  const request = result.documentType === "TDS" ? "confirm any missing commercial details" : "confirm the remaining document and shipping details";

  return {
    to: "",
    subject: `Follow-up: ${productName}`,
    body: `Hi,\n\nI am reviewing ${productName} from ${supplier}. Please ${request}, including MOQ, lead time, and available pack sizes.\n\nBest,\nSean`,
    rationale: "Drafted as a supplier-facing follow-up for new product intake."
  };
}

export function buildFollowUpDraft(result = {}) {
  switch (result.workflow) {
    case "call_report":
    case "email_thread":
      return buildCallOrEmailFollowUp(result);
    case "new_product":
      return buildProductFollowUp(result);
    default:
      return null;
  }
}
