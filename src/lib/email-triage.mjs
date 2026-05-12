import { analyzeInput } from "./analyze.mjs";
import { compactWhitespace, extractDomain, uniqueStrings, normalizePhone } from "./normalize.mjs";

const ADDRESS_RE = /"?([^"<]*)"?\s*<([^>]+)>|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;

const SOLICITATION_PATTERNS = [
  /\blooking to connect\b/i,
  /\bquick intro\b/i,
  /\bcan we help\b/i,
  /\bboost your\b/i,
  /\bnewsletter\b/i,
  /\bwebinar\b/i,
  /\bdemo\b/i,
  /\bmarketing\b/i,
  /\blead generation\b/i,
  /\bcold outreach\b/i,
  /\bbook a meeting\b/i
];

const OPS_VENDOR_PATTERNS = [
  /\bpayroll\b/i,
  /\binvoice\b/i,
  /\bstatement\b/i,
  /\bmerchant services\b/i,
  /\bpayment due\b/i,
  /\bbilling\b/i,
  /\bsubscription\b/i,
  /\bpassword changed\b/i,
  /\bsecurity alert\b/i,
  /\blogin alert\b/i,
  /\baccount notification\b/i,
  /\bremittance\b/i
];

const OPS_VENDOR_ACTION_PATTERNS = [
  /\baction required\b/i,
  /\bpast due\b/i,
  /\boverdue\b/i,
  /\bverify\b/i,
  /\bconfirm\b/i,
  /\bpayment failed\b/i,
  /\bdue and will be debited\b/i,
  /\bplease review\b/i,
  /\brespond by\b/i
];

const OPS_VENDOR_INFO_PATTERNS = [
  /\battached is your electronic statement\b/i,
  /\byour .* statement is attached\b/i,
  /\binvoice\(s\) is now ready\b/i,
  /\bmonthly statement\b/i,
  /\bpayment receipt\b/i,
  /\bpassword changed\b/i,
  /\bsecurity alert\b/i,
  /\baccount notification\b/i
];

const SUPPLIER_PATTERNS = [
  /\bpo\b/i,
  /\bpurchase order\b/i,
  /\border confirmation\b/i,
  /\blead time\b/i,
  /\bcoa\b/i,
  /\bsds\b/i,
  /\btds\b/i,
  /\bpacking list\b/i,
  /\bfreight\b/i,
  /\bshipment\b/i,
  /\binvoice\b/i
];

const LOGISTICS_PATTERNS = [
  /\blive unload\b/i,
  /\bcontainer\b/i,
  /\bobl surrender\b/i,
  /\bvessel\b/i,
  /\bport\b/i,
  /\bbill of lading\b/i,
  /\bpickup date\b/i,
  /\bappt time\b/i,
  /\bappointment\b/i,
  /\bcarrier could not make it\b/i,
  /\bschedule appointment\b/i
];

const COMPLIANCE_PATTERNS = [
  /\bcoa\b/i,
  /\bsds\b/i,
  /\btds\b/i,
  /\blot\b/i,
  /\bspec\b/i,
  /\bspecification\b/i,
  /\bhazmat\b/i
];

const COMMERCIAL_PATTERNS = [
  /\bpo\b/i,
  /\bpurchase order\b/i,
  /\bquote\b/i,
  /\bmaterial availability\b/i,
  /\beta\b/i,
  /\bnet weight\b/i,
  /\bsku\b/i,
  /\bprice action\b/i,
  /\bbackorder\b/i,
  /\bavailability\b/i,
  /\border number\b/i,
  /\bpricing\b/i
];

const RELATIONSHIP_PATTERNS = [
  /\bdinner\b/i,
  /\bcocktails\b/i,
  /\bdrinks\b/i,
  /\bcatch up\b/i,
  /\bacs\b/i,
  /\bamerican coatings show\b/i,
  /\blinkedin\b/i,
  /\bwelcome\b/i
];

const INSTITUTIONAL_DOMAINS = ["shelfcycle.com", "adp.com", "google.com"];
const CONTAINER_ID_RE = /\b[A-Z]{4}\d{7,11}\b/g;
const COMMERCIAL_IDENTIFIER_RE = /\b(?:po|purchase order|quote|order|invoice)\s*#?\s*([A-Z0-9-]{4,})\b/gi;

function getHeaderValue(message = {}, name = "") {
  return (
    message.payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

function parseAddressHeader(value = "") {
  const addresses = [];
  let match;

  while ((match = ADDRESS_RE.exec(value))) {
    const name = compactWhitespace(match[1] ?? "");
    const email = compactWhitespace(match[2] ?? match[3] ?? "");

    if (!email) {
      continue;
    }

    addresses.push({
      name,
      email,
      domain: extractDomain(email)
    });
  }

  if (addresses.length) {
    return addresses;
  }

  for (const token of compactWhitespace(value).split(/\s*,\s*/).filter(Boolean)) {
    const cleaned = compactWhitespace(token.replace(/^"|"$/g, ""));

    if (!cleaned) {
      continue;
    }

    if (/^\+?[\d().\s-]{7,}$/.test(cleaned)) {
      addresses.push({
        name: "",
        email: cleaned,
        domain: ""
      });
      continue;
    }

    const handleMatch = cleaned.match(/^(.+?)\s*<([^>]+)>$/);

    if (handleMatch && /^\+?[\d().\s-]{7,}$/.test(compactWhitespace(handleMatch[2]))) {
      addresses.push({
        name: compactWhitespace(handleMatch[1]),
        email: compactWhitespace(handleMatch[2]),
        domain: ""
      });
    }
  }

  return addresses;
}

function getBodyText(payload = {}) {
  if (payload.parts?.length) {
    return payload.parts.map((part) => getBodyText(part)).join("\n");
  }

  if (!payload.body?.data) {
    return "";
  }

  try {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function messageToEvent(message = {}) {
  const from = parseAddressHeader(getHeaderValue(message, "from"))[0] ?? null;
  const to = parseAddressHeader(getHeaderValue(message, "to"));
  const cc = parseAddressHeader(getHeaderValue(message, "cc"));
  const subject = getHeaderValue(message, "subject");
  const dateHeader = getHeaderValue(message, "date");
  const bodyText = getBodyText(message.payload);
  const snippet = compactWhitespace(message.snippet ?? "");
  const timestamp = Number(message.internalDate ?? Date.parse(dateHeader) ?? 0);

  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds ?? [],
    from,
    to,
    cc,
    subject,
    timestamp,
    dateHeader,
    snippet,
    bodyText,
    joinedText: [subject, snippet, bodyText].filter(Boolean).join("\n")
  };
}

function isInternalEmail(email = "", bundle = {}) {
  const domain = extractDomain(email);
  const phone = normalizePhone(email);

  return (
    bundle.internalDomains?.includes(domain) ||
    bundle.lookups?.internalEmails?.includes(email.toLowerCase()) ||
    bundle.lookups?.internalPhones?.includes(phone)
  );
}

function addressPhone(address = {}) {
  return normalizePhone(address.phone || address.email || address.value || "");
}

function latestExternalInboundEvent(events = [], bundle = {}) {
  return [...events]
    .sort((left, right) => left.timestamp - right.timestamp)
    .reverse()
    .find((event) => event.from?.email && !isInternalEmail(event.from.email, bundle));
}

function contactMatchHasRelationship(matches = [], type = "") {
  return matches.some((entry) => {
    return matchEntryHasRelationship(entry, type);
  });
}

function matchEntryHasRelationship(entry = {}, type = "") {
  const relationship = compactWhitespace(entry?.candidate?.companyType || entry?.candidate?.type || entry?.candidate?.raw?.company_type).toLowerCase();

  if (!relationship) {
    return type === "customer";
  }

  return relationship === type;
}

function addressMatchesContactRole(address = {}, matches = [], type = "") {
  const email = address.email?.toLowerCase();
  const name = compactWhitespace(address.name).toLowerCase();
  const phone = addressPhone(address);

  return matches.some((entry) => {
    if (!matchEntryHasRelationship(entry, type)) {
      return false;
    }

    const candidateEmail = entry?.candidate?.email?.toLowerCase();
    const candidateName = compactWhitespace(entry?.candidate?.name).toLowerCase();
    const candidatePhones = [
      entry?.candidate?.officePhone,
      entry?.candidate?.mobilePhone,
      entry?.candidate?.faxPhone
    ].map((value) => normalizePhone(value)).filter(Boolean);

    return (email && candidateEmail === email) || (name && candidateName === name) || (phone && candidatePhones.includes(phone));
  });
}

function matchesCustomer(address = {}, bundle = {}, analysis = {}) {
  if (!address.email && !addressPhone(address)) {
    return false;
  }

  const email = address.email?.toLowerCase?.() ?? "";
  const domain = extractDomain(email);
  const phone = addressPhone(address);
  const matchedByAnalysis = addressMatchesContactRole(address, analysis.matches?.contacts ?? [], "customer");
  const hasTypedContactLookups = Boolean(
    bundle.lookups?.customerContactEmails?.length ||
    bundle.lookups?.supplierContactEmails?.length ||
    bundle.lookups?.customerContactPhones?.length ||
    bundle.lookups?.supplierContactPhones?.length
  );
  const matchedContact =
    bundle.lookups?.customerContactEmails?.includes(email) ||
    bundle.lookups?.customerContactPhones?.includes(phone) ||
    (!hasTypedContactLookups && bundle.lookups?.contactEmails?.includes(email));
  const matchedDomain = bundle.lookups?.customerDomains?.includes(domain);
  const matchedCustomerPhone = bundle.lookups?.customerPhones?.includes(phone);

  return matchedByAnalysis || matchedContact || matchedDomain || matchedCustomerPhone;
}

function matchesOpsVendor(address = {}, bundle = {}, joinedText = "") {
  if (!address.email) {
    return false;
  }

  const domain = extractDomain(address.email);
  const companyText = `${address.name} ${address.email} ${joinedText}`;
  const nameMatch = (bundle.lookups?.opsVendorNames ?? []).some(
    (vendorName) => vendorName && companyText.toLowerCase().includes(vendorName.toLowerCase())
  );
  const domainMatch = bundle.lookups?.opsVendorDomains?.includes(domain);
  const patternMatch = OPS_VENDOR_PATTERNS.some((pattern) => pattern.test(companyText));

  return domainMatch || nameMatch || patternMatch;
}

function matchesSupplier(address = {}, bundle = {}, joinedText = "", analysis = {}) {
  if (!address.email && !addressPhone(address)) {
    return false;
  }

  const domain = extractDomain(address.email);
  const companyText = `${address.name} ${address.email} ${joinedText}`;
  const email = address.email?.toLowerCase?.() ?? "";
  const phone = addressPhone(address);
  const nameMatch = (bundle.lookups?.supplierNames ?? []).some(
    (supplierName) => supplierName && companyText.toLowerCase().includes(supplierName.toLowerCase())
  );
  const domainMatch = bundle.lookups?.supplierDomains?.includes(domain);
  const contactMatch = bundle.lookups?.supplierContactEmails?.includes(email);
  const phoneMatch = bundle.lookups?.supplierContactPhones?.includes(phone);
  const analysisContactMatch = addressMatchesContactRole(address, analysis.matches?.contacts ?? [], "supplier");
  const patternMatch = SUPPLIER_PATTERNS.some((pattern) => pattern.test(companyText));

  return domainMatch || contactMatch || phoneMatch || analysisContactMatch || nameMatch || patternMatch;
}

function looksLikeSolicitation(events = [], bundle = {}) {
  const allText = events.map((event) => event.joinedText).join("\n");
  const senderDomains = uniqueStrings(events.map((event) => extractDomain(event.from?.email)).filter(Boolean));
  const anyKnownRelationship = senderDomains.some(
    (domain) =>
      bundle.lookups?.customerDomains?.includes(domain) ||
      bundle.lookups?.supplierDomains?.includes(domain) ||
      bundle.lookups?.opsVendorDomains?.includes(domain) ||
      bundle.internalDomains?.includes(domain)
  );
  const promotionalLabels = events.some((event) =>
    event.labelIds.some((labelId) => ["CATEGORY_PROMOTIONS", "CATEGORY_UPDATES"].includes(labelId))
  );

  if (anyKnownRelationship) {
    return false;
  }

  return promotionalLabels || SOLICITATION_PATTERNS.some((pattern) => pattern.test(allText));
}

function inferOpsVendorSubtype(address = {}, bundle = {}, joinedText = "") {
  if (!matchesOpsVendor(address, bundle, joinedText)) {
    return "";
  }

  return "ops_vendor";
}

function findMatchedPatterns(text = "", patterns = []) {
  return uniqueStrings(
    patterns
      .map((pattern) => {
        const match = text.match(pattern);
        return compactWhitespace(match?.[0] ?? "");
      })
      .filter(Boolean)
  );
}

function findContainerIds(text = "") {
  return uniqueStrings(text.match(CONTAINER_ID_RE) ?? []);
}

function findCommercialIdentifiers(text = "") {
  const identifiers = [];
  let match;

  while ((match = COMMERCIAL_IDENTIFIER_RE.exec(text))) {
    const identifier = compactWhitespace(match[1] ?? "");

    if (identifier) {
      identifiers.push(identifier);
    }
  }

  return uniqueStrings(identifiers);
}

function attachmentNames(workspaceArtifacts = {}) {
  return uniqueStrings(
    (workspaceArtifacts.attachments ?? [])
      .map((item) => compactWhitespace(item.filename))
      .filter(Boolean)
  );
}

function inferSilo({
  events = [],
  bundle = {},
  analysis = {},
  relationship = {},
  workspaceArtifacts = {}
} = {}) {
  const joinedThreadText = events.map((event) => event.joinedText).join("\n");
  const latestInbound = latestExternalInboundEvent(events, bundle);
  const latestSenderDomain = extractDomain(latestInbound?.from?.email);
  const attachments = attachmentNames(workspaceArtifacts).join("\n");
  const text = `${joinedThreadText}\n${attachments}`;
  const logisticsSignals = findMatchedPatterns(text, LOGISTICS_PATTERNS);
  const complianceSignals = findMatchedPatterns(text, COMPLIANCE_PATTERNS);
  const commercialSignals = findMatchedPatterns(text, COMMERCIAL_PATTERNS);
  const relationshipSignals = findMatchedPatterns(text, RELATIONSHIP_PATTERNS);
  const containerIds = findContainerIds(text);
  const commercialIds = findCommercialIdentifiers(text);
  const hasProductMatch = Boolean(analysis.matches?.products?.length);
  const hasTechnicalAttachment = attachmentNames(workspaceArtifacts).some((name) => /\b(sds|tds|coa|spec)\b/i.test(name));
  const hasRelationshipInvite = relationshipSignals.length && !commercialIds.length;
  const hasInstitutionalDomain = INSTITUTIONAL_DOMAINS.includes(latestSenderDomain);

  if (relationship.relationship === "solicitation") {
    return {
      name: "noise",
      confidence: 0.95,
      reasons: ["thread classified as solicitation or newsletter"],
      matchedKeywords: []
    };
  }

  if (
    relationship.relationship === "employee" ||
    relationship.subtype === "ops_vendor" ||
    hasInstitutionalDomain
  ) {
    return {
      name: "institutional",
      confidence: relationship.subtype === "ops_vendor" || hasInstitutionalDomain ? 0.92 : 0.84,
      reasons: ["internal, platform, finance, or back-office thread"],
      matchedKeywords: uniqueStrings([
        ...findMatchedPatterns(text, OPS_VENDOR_PATTERNS),
        ...findMatchedPatterns(text, OPS_VENDOR_ACTION_PATTERNS),
        ...findMatchedPatterns(text, OPS_VENDOR_INFO_PATTERNS)
      ]).slice(0, 8)
    };
  }

  if (containerIds.length || logisticsSignals.length) {
    return {
      name: "logistics",
      confidence: containerIds.length ? 0.93 : 0.84,
      reasons: ["shipment coordination signals detected"],
      matchedKeywords: uniqueStrings([...logisticsSignals, ...containerIds]).slice(0, 8),
      containerIds
    };
  }

  if (hasTechnicalAttachment || complianceSignals.length) {
    return {
      name: "compliance",
      confidence: hasTechnicalAttachment ? 0.9 : 0.82,
      reasons: ["technical-document or product-compliance signals detected"],
      matchedKeywords: uniqueStrings([...complianceSignals, ...attachmentNames(workspaceArtifacts)]).slice(0, 8)
    };
  }

  if (hasRelationshipInvite) {
    return {
      name: "relationship",
      confidence: 0.76,
      reasons: ["high-touch networking or executive relationship signals detected"],
      matchedKeywords: relationshipSignals.slice(0, 8)
    };
  }

  if (
    commercialSignals.length ||
    commercialIds.length ||
    hasProductMatch ||
    relationship.relationship === "customer" ||
    relationship.relationship === "supplier"
  ) {
    return {
      name: "commercial",
      confidence: commercialSignals.length || commercialIds.length || hasProductMatch ? 0.86 : 0.72,
      reasons: ["sales, pricing, procurement, or product-commercial signals detected"],
      matchedKeywords: uniqueStrings([
        ...commercialSignals,
        ...commercialIds,
        ...(analysis.matches?.products ?? []).map((entry) => entry.candidate?.code || entry.candidate?.name).filter(Boolean)
      ]).slice(0, 8)
    };
  }

  return {
    name: "noise",
    confidence: 0.5,
    reasons: ["no strong logistics, commercial, compliance, or relationship signals found"],
    matchedKeywords: []
  };
}

function classifyMatchedRelationship({
  customerMatch = false,
  supplierMatch = false,
  opsVendorMatch = false
} = {}) {
  if (opsVendorMatch) {
    return {
      relationship: "supplier",
      subtype: "ops_vendor",
      confidence: 0.82,
      reasons: ["latest inbound sender matches a known ops vendor or finance/security pattern"]
    };
  }

  if (supplierMatch && !customerMatch) {
    return {
      relationship: "supplier",
      subtype: "core_supplier",
      confidence: 0.85,
      reasons: ["latest inbound sender matched supplier cues"]
    };
  }

  if (customerMatch && !supplierMatch) {
    return {
      relationship: "customer",
      subtype: "core_customer",
      confidence: 0.85,
      reasons: ["latest inbound sender matched customer cues"]
    };
  }

  return null;
}

function classifyRelationship(events = [], bundle = {}, analysis = {}) {
  const externalAddresses = dedupeAddresses(
    events.flatMap((event) => [event.from, ...event.to, ...event.cc]).filter((address) => address?.email)
  ).filter((address) => !isInternalEmail(address.email, bundle));
  const joinedThreadText = events.map((event) => event.joinedText).join("\n");
  const latestExternalInbound = latestExternalInboundEvent(events, bundle);

  if (!externalAddresses.length) {
    return {
      relationship: "employee",
      subtype: "internal",
      confidence: 0.95,
      reasons: ["internal participants only"]
    };
  }

  if (looksLikeSolicitation(events, bundle)) {
    return {
      relationship: "solicitation",
      subtype: "newsletter",
      confidence: 0.8,
      reasons: ["promotional or cold outreach signals"]
    };
  }

  const customerMatches = externalAddresses.filter((address) => matchesCustomer(address, bundle, analysis));
  const supplierMatches = externalAddresses.filter((address) =>
    matchesSupplier(address, bundle, joinedThreadText, analysis)
  );
  const opsVendorMatches = externalAddresses.filter((address) => matchesOpsVendor(address, bundle, joinedThreadText));

  if (latestExternalInbound?.from) {
    const preferred = classifyMatchedRelationship({
      customerMatch: matchesCustomer(latestExternalInbound.from, bundle, analysis),
      supplierMatch: matchesSupplier(latestExternalInbound.from, bundle, joinedThreadText, analysis),
      opsVendorMatch: matchesOpsVendor(latestExternalInbound.from, bundle, joinedThreadText)
    });

    if (preferred) {
      return preferred;
    }
  }

  if (customerMatches.length && supplierMatches.length) {
    if (opsVendorMatches.length && opsVendorMatches.length === supplierMatches.length) {
      return {
        relationship: "supplier",
        subtype: "ops_vendor",
        confidence: 0.8,
        reasons: ["known ops-vendor signals dominated the external participants"]
      };
    }

    if (supplierMatches.length > customerMatches.length) {
      return {
        relationship: "supplier",
        subtype: "core_supplier",
        confidence: 0.7,
        reasons: ["customer and supplier signals were both present, but supplier evidence was stronger"]
      };
    }

    return {
      relationship: "customer",
      subtype: "core_customer",
      confidence: 0.65,
      reasons: ["customer and supplier signals present, defaulting to customer-facing"]
    };
  }

  if (opsVendorMatches.length) {
    return {
      relationship: "supplier",
      subtype: inferOpsVendorSubtype(opsVendorMatches[0], bundle, joinedThreadText) || "ops_vendor",
      confidence: 0.78,
      reasons: ["matched a known ops vendor or finance/security pattern"]
    };
  }

  if (customerMatches.length) {
    return {
      relationship: "customer",
      subtype: "core_customer",
      confidence: 0.85,
      reasons: ["matched customer domain or contact"]
    };
  }

  if (supplierMatches.length) {
    return {
      relationship: "supplier",
      subtype: "core_supplier",
      confidence: 0.8,
      reasons: ["matched supplier cues or known supplier name"]
    };
  }

  return {
    relationship: "solicitation",
    subtype: "newsletter",
    confidence: 0.45,
    reasons: ["external thread without known customer or supplier signals"]
  };
}

function dedupeAddresses(addresses = []) {
  const seen = new Set();
  const output = [];

  for (const address of addresses) {
    const email = address?.email?.toLowerCase();

    if (!email || seen.has(email)) {
      continue;
    }

    seen.add(email);
    output.push({
      ...address,
      email
    });
  }

  return output;
}

function computeThreadState(events = [], bundle = {}, relationship = {}) {
  const sorted = [...events].sort((left, right) => left.timestamp - right.timestamp);
  const latestExternalInbound = latestExternalInboundEvent(events, bundle);
  const latestInternalOutbound = [...sorted]
    .reverse()
    .find((event) => event.from?.email && isInternalEmail(event.from.email, bundle));

  if (!latestExternalInbound) {
    return {
      state: "informational",
      reasons: ["no external inbound message in thread"]
    };
  }

  if (relationship.subtype === "ops_vendor") {
    const latestText = latestExternalInbound.joinedText;
    const isInformational = OPS_VENDOR_INFO_PATTERNS.some((pattern) => pattern.test(latestText));
    const needsAction = OPS_VENDOR_ACTION_PATTERNS.some((pattern) => pattern.test(latestText));

    if (isInformational && !needsAction) {
      return {
        state: "informational",
        reasons: ["ops-vendor message looks informational and does not contain an explicit action cue"]
      };
    }
  }

  if (latestInternalOutbound && latestInternalOutbound.timestamp > latestExternalInbound.timestamp) {
    return {
      state: "waiting_on_other_side",
      reasons: ["latest ClearEdge reply is newer than latest external inbound"]
    };
  }

  return {
    state: "needs_attention",
    reasons: ["latest external inbound is newer than any ClearEdge reply"]
  };
}

function pickHeadlineEvent(events = []) {
  return [...events].sort((left, right) => right.timestamp - left.timestamp)[0] ?? null;
}

function computePriorityScore({ relationship = {}, state = {}, silo = {} } = {}) {
  const stateWeight =
    state.state === "needs_attention" ? 70 : state.state === "waiting_on_other_side" ? 38 : 14;
  const relationshipWeight =
    relationship.relationship === "customer"
      ? 22
      : relationship.relationship === "supplier"
        ? 19
        : relationship.relationship === "employee"
          ? 11
          : 0;
  const siloWeight =
    silo.name === "logistics"
      ? 18
      : silo.name === "commercial"
        ? 16
        : silo.name === "compliance"
          ? 14
          : silo.name === "relationship"
            ? 10
            : silo.name === "institutional"
              ? 6
              : 0;

  return stateWeight + relationshipWeight + siloWeight;
}

function formatWorkspaceArtifacts(workspaceArtifacts = {}) {
  const sections = [];
  const attachments = (workspaceArtifacts.attachments ?? [])
    .filter((item) => isMeaningfulAttachment(item.filename, item.mimeType))
    .map((item) => item.filename)
    .filter(Boolean)
    .slice(0, 6);
  const driveFiles = (workspaceArtifacts.driveFiles ?? [])
    .map((item) => item.name)
    .filter(Boolean)
    .slice(0, 6);

  if (attachments.length) {
    sections.push(`Attachments: ${attachments.join(", ")}`);
  }

  if (driveFiles.length) {
    sections.push(`Google Drive Files: ${driveFiles.join(", ")}`);
  }

  if (workspaceArtifacts.driveFileIds?.length && !driveFiles.length && workspaceArtifacts.driveScopeAvailable === false) {
    sections.push("Google Drive Files: linked but metadata unavailable without drive.readonly scope");
  }

  const signatures = (workspaceArtifacts.emailSignatures ?? [])
    .map((signature) => [
      signature.personName,
      signature.title,
      signature.companyName,
      signature.email,
      signature.phone || signature.mobilePhone,
      signature.website
    ].filter(Boolean).join(" | "))
    .filter(Boolean)
    .slice(0, 4);

  if (signatures.length) {
    sections.push(`Extracted Gmail Signatures:\n${signatures.map((item) => `- ${item}`).join("\n")}`);
  }

  return sections;
}

function isMeaningfulAttachment(filename = "", mimeType = "") {
  const name = compactWhitespace(filename).toLowerCase();
  const type = compactWhitespace(mimeType).toLowerCase();

  if (!name) {
    return false;
  }

  if (/\b(sds|tds|coa|quote|pricing|po|purchase order|invoice|statement|spec|specification)\b/i.test(name)) {
    return true;
  }

  if (/(pdf|doc|docx|xls|xlsx|csv|txt)$/i.test(name)) {
    return true;
  }

  if (type.startsWith("application/pdf") || type.includes("spreadsheet") || type.includes("wordprocessing")) {
    return true;
  }

  return false;
}

function threadToAnalysisText(thread = {}) {
  const events = (thread.messages ?? []).map(messageToEvent);
  const sections = [];

  for (const event of events.slice(-8)) {
    sections.push(`From: ${event.from?.name ? `${event.from.name} <${event.from.email}>` : event.from?.email || ""}`);
    sections.push(`To: ${event.to.map((address) => address.email).join(", ")}`);

    if (event.subject) {
      sections.push(`Subject: ${event.subject}`);
    }

    if (event.snippet) {
      sections.push(event.snippet);
    } else if (event.bodyText) {
      sections.push(event.bodyText.slice(0, 1200));
    }

    sections.push("");
  }

  for (const artifactLine of formatWorkspaceArtifacts(thread.workspaceArtifacts)) {
    sections.push(artifactLine);
  }

  return sections.join("\n");
}

function signatureCompanyKind(signature = {}, relationship = {}) {
  if (relationship.relationship === "supplier" || relationship.relationship === "customer") {
    return relationship.relationship;
  }

  const text = `${signature.title || ""} ${signature.companyName || ""}`.toLowerCase();

  if (/\b(supplier|manufacturer|producer|chemical sales|sales team|raw material|distributor)\b/.test(text)) {
    return "supplier";
  }

  return "customer";
}

function contactCreateFromSignature(signature = {}, relationship = {}) {
  const kind = signatureCompanyKind(signature, relationship);
  const companyType = kind === "supplier" ? "Supplier" : "Customer";

  return {
    type: "contact",
    name: compactWhitespace(signature.personName),
    title: compactWhitespace(signature.title),
    email: compactWhitespace(signature.email),
    phone: compactWhitespace(signature.phone),
    mobilePhone: compactWhitespace(signature.mobilePhone),
    faxPhone: compactWhitespace(signature.faxPhone),
    companyName: compactWhitespace(signature.companyName),
    companyType,
    website: compactWhitespace(signature.website),
    streetAddress: compactWhitespace(signature.streetAddress),
    streetAddress2: compactWhitespace(signature.streetAddress2),
    city: compactWhitespace(signature.city),
    stateRegion: compactWhitespace(signature.stateRegion),
    zip: compactWhitespace(signature.zip),
    country: compactWhitespace(signature.country),
    source: "gmail_signature",
    confidence: signature.confidence ?? 0
  };
}

function companyCreateFromSignature(signature = {}, relationship = {}) {
  const name = compactWhitespace(signature.companyName);

  if (!name) {
    return null;
  }

  const kind = signatureCompanyKind(signature, relationship);

  if (kind === "supplier") {
    return {
      type: "supplier",
      name,
      companyName: name,
      email: compactWhitespace(signature.email),
      phone: compactWhitespace(signature.phone),
      website: compactWhitespace(signature.website),
      street1: compactWhitespace(signature.streetAddress),
      street2: compactWhitespace(signature.streetAddress2),
      city: compactWhitespace(signature.city),
      stateRegion: compactWhitespace(signature.stateRegion),
      zip: compactWhitespace(signature.zip),
      country: compactWhitespace(signature.country),
      source: "gmail_signature",
      confidence: signature.confidence ?? 0
    };
  }

  if (kind === "customer") {
    return {
      type: "customer",
      name,
      companyName: name,
      email: compactWhitespace(signature.email),
      phoneNumber: compactWhitespace(signature.phone),
      website: compactWhitespace(signature.website),
      streetAddress: compactWhitespace(signature.streetAddress),
      streetAddress2: compactWhitespace(signature.streetAddress2),
      city: compactWhitespace(signature.city),
      stateRegion: compactWhitespace(signature.stateRegion),
      zip: compactWhitespace(signature.zip),
      country: compactWhitespace(signature.country),
      prospect: true,
      source: "gmail_signature",
      confidence: signature.confidence ?? 0
    };
  }

  return null;
}

function enrichAnalysisWithEmailSignatures(analysis = {}, relationship = {}, workspaceArtifacts = {}) {
  const signatures = workspaceArtifacts.emailSignatures ?? [];

  if (!signatures.length) {
    return analysis;
  }

  const creates = [];

  for (const signature of signatures) {
    const companyCreate = companyCreateFromSignature(signature, relationship);

    if (companyCreate) {
      creates.push(companyCreate);
    }

    creates.push(contactCreateFromSignature(signature, relationship));
  }

  const byKey = new Map();

  for (const item of [...creates, ...(analysis.suggestedCreates ?? [])]) {
    const key = [
      item.type,
      item.email?.toLowerCase?.() || "",
      compactWhitespace(item.name || item.companyName).toLowerCase()
    ].join("|");

    if (!key || byKey.has(key)) {
      continue;
    }

    byKey.set(key, item);
  }

  return {
    ...analysis,
    suggestedCreates: [...byKey.values()],
    rawExtracts: {
      ...(analysis.rawExtracts ?? {}),
      emailSignatures: signatures
    }
  };
}

export function analyzeThread(thread = {}, bundle = {}) {
  const events = (thread.messages ?? []).map(messageToEvent);
  const text = threadToAnalysisText(thread);
  const referenceData = {
    customers: bundle.customers ?? [],
    contacts: bundle.contacts ?? [],
    products: bundle.products ?? [],
    locations: bundle.locations ?? [],
    clearedgeIntelligence: bundle.clearedgeIntelligence ?? bundle.notebookIntelligence ?? []
  };
  let analysis = analyzeInput({
    text,
    workflow: "email_thread",
    referenceData
  });
  const relationship = classifyRelationship(events, bundle, analysis);
  const state = computeThreadState(events, bundle, relationship);
  const silo = inferSilo({
    events,
    bundle,
    analysis,
    relationship,
    workspaceArtifacts: thread.workspaceArtifacts
  });
  const headline = pickHeadlineEvent(events);
  const externalParticipants = dedupeAddresses(
    events.flatMap((event) => [event.from, ...event.to, ...event.cc]).filter((address) => address?.email)
  ).filter((address) => !isInternalEmail(address.email, bundle));
  analysis = enrichAnalysisWithEmailSignatures(analysis, relationship, thread.workspaceArtifacts ?? {});

  return {
    source: thread.source ?? "gmail",
    threadId: thread.id,
    events,
    relationship,
    state,
    silo,
    priorityScore: computePriorityScore({ relationship, state, silo }),
    analysis,
    workspaceArtifacts: thread.workspaceArtifacts ?? {
      attachments: [],
      driveFileIds: [],
      driveFiles: [],
      driveScopeAvailable: true,
      driveError: ""
    },
    sourceRecords: thread.messageRecords ?? [],
    headline,
    subject: headline?.subject || analysis.fields?.subject || "",
    lastTimestamp: headline?.timestamp || 0,
    externalParticipants,
    summary: analysis.draftNote?.summary || ""
  };
}
