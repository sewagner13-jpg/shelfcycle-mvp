import { analyzeThread } from "./email-triage.mjs";
import { fetchRecentMessageThreads } from "./messages-client.mjs";
import {
  defaultMessagesMemoryConfig,
  normalizeMessagesMemoryConfig
} from "./messages-memory-config.mjs";
import { upsertMessagesMemoryCandidates } from "./messages-memory-store.mjs";
import { compactWhitespace, normalizePhone, uniqueStrings } from "./normalize.mjs";

const MEMORY_PATTERNS = [
  ["product_interest", /\b(need|looking for|interested in|do you have|can you get|quote|price|pricing|availability)\b/i],
  ["purchase_signal", /\b(po|purchase order|order|buy|ship|send|deliver|container|truckload|drums?|totes?|pickup)\b/i],
  ["complaint_or_issue", /\b(problem|issue|late|delay|wrong|damaged|missing|concern|complaint)\b/i],
  ["document_request", /\b(sds|tds|coa|spec|data sheet|certificate)\b/i],
  ["pricing_memory", /\$\s*\d|\b\d+(\.\d+)?\s*(\/|per)\s*(lb|pound|kg|drum|tote)\b/i]
];

const STRONG_BUSINESS_KEYWORDS = [
  "quote",
  "pricing",
  "price",
  "po",
  "purchase order",
  "sample",
  "sds",
  "tds",
  "coa",
  "shipment",
  "invoice",
  "freight",
  "container",
  "lead time",
  "benzyl alcohol"
];

function truncate(text = "", maxLength = 160) {
  const value = compactWhitespace(text);

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trim()}...`;
}

function emptySection() {
  return {
    section: "Message Memory",
    urgent_items: [],
    business_threads: [],
    unanswered_messages: [],
    memory_candidates: [],
    suggested_followups: [],
    low_priority_summary: []
  };
}

function participantValue(item = {}) {
  return item.externalParticipants?.[0]?.email || item.externalParticipants?.[0]?.name || item.threadId || "unknown";
}

function subjectValue(item = {}) {
  return item.subject || `Text thread with ${participantValue(item)}`;
}

function latestText(item = {}) {
  return item.sourceRecords?.slice(-1)[0]?.text || item.analysis?.rawExtracts?.keyPoints?.[0] || "";
}

function whitelistSet(config = {}) {
  return new Set((config.businessWhitelist ?? []).map((value) => String(value).trim().toLowerCase()));
}

function blacklistSet(config = {}) {
  return new Set((config.blacklist ?? []).map((value) => String(value).trim().toLowerCase()));
}

function participantKnownToBundle(participant = "", bundle = {}) {
  const normalizedParticipant = participant.toLowerCase();
  const normalizedPhone = normalizePhone(participant);
  const lookups = bundle.lookups ?? {};

  return Boolean(
    lookups.customerContactEmails?.includes(normalizedParticipant) ||
      lookups.supplierContactEmails?.includes(normalizedParticipant) ||
      lookups.customerDomains?.includes(normalizedParticipant.split("@").pop()) ||
      lookups.supplierDomains?.includes(normalizedParticipant.split("@").pop()) ||
      (normalizedPhone &&
        (lookups.customerContactPhones?.includes(normalizedPhone) ||
          lookups.supplierContactPhones?.includes(normalizedPhone) ||
          lookups.customerPhones?.includes(normalizedPhone) ||
          lookups.supplierPhones?.includes(normalizedPhone) ||
          lookups.internalPhones?.includes(normalizedPhone)))
  );
}

function businessThread(item = {}, config = {}, bundle = {}) {
  const participant = participantValue(item);
  const normalizedParticipant = participant.toLowerCase();
  const normalizedPhone = normalizePhone(participant);
  const body = `${item.subject || ""}\n${item.summary || ""}\n${item.sourceRecords?.map((record) => record.text).join("\n") || ""}`.toLowerCase();
  const whitelisted = whitelistSet(config).has(normalizedParticipant) || (normalizedPhone && whitelistSet(config).has(normalizedPhone));
  const blacklisted = blacklistSet(config).has(normalizedParticipant) || (normalizedPhone && blacklistSet(config).has(normalizedPhone));
  const matchedKeywords = uniqueStrings(
    (config.businessKeywords ?? []).filter((keyword) => keyword && body.includes(String(keyword).toLowerCase()))
  );
  const strongKeywordMatch = STRONG_BUSINESS_KEYWORDS.some((keyword) => body.includes(keyword));
  const keywordMatch = strongKeywordMatch || matchedKeywords.length >= 2;
  const relationshipMatch = ["customer", "supplier"].includes(item.relationship?.relationship);
  const isPhoneOnlyParticipant = Boolean(normalizedPhone) && !participant.includes("@");
  const lowSignalRelationship =
    item.relationship?.relationship === "solicitation" ||
    item.silo?.name === "noise";
  const knownParticipant = participantKnownToBundle(participant, bundle);

  if (blacklisted) {
    return false;
  }

  if (!whitelisted && !knownParticipant && lowSignalRelationship) {
    return false;
  }

  return whitelisted || knownParticipant || (!isPhoneOnlyParticipant && relationshipMatch) || keywordMatch;
}

function urgentThread(item = {}, config = {}) {
  const haystack = `${item.subject || ""}\n${latestText(item)}`.toLowerCase();
  return (config.urgentKeywords ?? []).some((keyword) => keyword && haystack.includes(String(keyword).toLowerCase()));
}

function summarizeMemoryCandidate(item = {}, memoryType = "") {
  const contact = participantValue(item);
  const text = latestText(item);

  if (memoryType === "product_interest") {
    return `${contact} showed product or pricing interest.`;
  }

  if (memoryType === "purchase_signal") {
    return `${contact} signaled an active order, shipment, or pickup need.`;
  }

  if (memoryType === "complaint_or_issue") {
    return `${contact} may have an unresolved issue or complaint.`;
  }

  if (memoryType === "document_request") {
    return `${contact} asked for technical or commercial documents.`;
  }

  if (memoryType === "pricing_memory") {
    return `${contact} discussed price, units, or quote context.`;
  }

  return truncate(text || `${contact} discussed something worth remembering.`, 140);
}

function collectMemoryCandidates(items = [], config = {}) {
  const candidates = [];

  for (const item of items) {
    const texts = item.sourceRecords?.map((record) => record.text).filter(Boolean) ?? [];
    const joinedText = texts.join("\n");

    for (const [memoryType, pattern] of MEMORY_PATTERNS) {
      if (!pattern.test(joinedText)) {
        continue;
      }

      const evidence = truncate(texts.slice(-1)[0] || latestText(item), 160);
      const recordIds = uniqueStrings((item.sourceRecords ?? []).map((record) => String(record.messageId)).filter(Boolean));

      candidates.push({
        contact: participantValue(item),
        threadId: item.threadId,
        memoryType,
        summary: summarizeMemoryCandidate(item, memoryType),
        evidenceSnippet: config.storeRawMessages ? evidence : "",
        firstSeen: item.sourceRecords?.[0]?.timestamp || item.lastTimestamp || 0,
        lastSeen: item.sourceRecords?.slice(-1)[0]?.timestamp || item.lastTimestamp || 0,
        confidence: Math.min(0.95, 0.6 + recordIds.length * 0.05),
        sourceMessageIds: recordIds
      });
    }
  }

  return candidates;
}

function compactThreadItem(item = {}) {
  return {
    thread_id: item.threadId,
    contact: participantValue(item),
    subject: subjectValue(item),
    last_timestamp: item.lastTimestamp,
    relationship: item.relationship?.relationship || "",
    silo: item.silo?.name || "",
    summary: truncate(latestText(item) || item.analysis?.draftNote?.summary || "", 180),
    next_step:
      item.analysis?.roleWorklists?.sales?.[0] ||
      item.analysis?.roleWorklists?.procurement?.[0] ||
      item.analysis?.roleWorklists?.owner?.[0] ||
      ""
  };
}

function followupItems(items = []) {
  return uniqueStrings(
    items
      .map((item) => compactThreadItem(item).next_step)
      .filter(Boolean)
  ).map((summary) => ({ summary }));
}

function lowPrioritySummaries(items = []) {
  return items.slice(0, 6).map((item) => ({
    contact: participantValue(item),
    summary: "Not included in business memory because no strong customer, supplier, or chemical-workflow signal was detected."
  }));
}

export async function buildMessagesMemorySection({
  analyzedThreads = [],
  config = defaultMessagesMemoryConfig(),
  bundle = {}
} = {}) {
  const normalizedConfig = normalizeMessagesMemoryConfig(config);
  const section = emptySection();
  const relevantThreads = analyzedThreads.filter((item) => businessThread(item, normalizedConfig, bundle));
  const urgentThreads = relevantThreads.filter((item) => urgentThread(item, normalizedConfig));
  const unansweredThreads = relevantThreads.filter((item) => item.state?.state === "needs_attention");
  const lowPriorityThreads = analyzedThreads.filter((item) => !relevantThreads.includes(item));
  const memoryCandidates = collectMemoryCandidates(relevantThreads, normalizedConfig);

  section.urgent_items = urgentThreads.map(compactThreadItem).slice(0, 10);
  section.business_threads = relevantThreads.map(compactThreadItem).slice(0, 12);
  section.unanswered_messages = unansweredThreads.map(compactThreadItem).slice(0, 10);
  section.memory_candidates = memoryCandidates.slice(0, 20);
  section.suggested_followups = followupItems(unansweredThreads).slice(0, 10);
  section.low_priority_summary = lowPrioritySummaries(lowPriorityThreads);

  if (normalizedConfig.storagePath && memoryCandidates.length) {
    await upsertMessagesMemoryCandidates(normalizedConfig.storagePath, memoryCandidates);
  }

  return section;
}

export async function runMessagesMemorySource({
  bundle,
  config = defaultMessagesMemoryConfig(),
  internalName = "Sean Wagner",
  internalEmail = "sean@clear-edge.net"
} = {}) {
  const normalizedConfig = normalizeMessagesMemoryConfig(config);

  if (!normalizedConfig.enabled) {
    return emptySection();
  }

  try {
    const threads = await fetchRecentMessageThreads({
      hours: normalizedConfig.lookbackHours,
      maxThreads: normalizedConfig.maxThreads,
      dbPath: normalizedConfig.messagesDbPath,
      internalName,
      internalEmail
    });
    const analyzedThreads = threads.map((thread) => analyzeThread(thread, bundle));

    return buildMessagesMemorySection({
      analyzedThreads,
      config: normalizedConfig,
      bundle
    });
  } catch (error) {
    return {
      ...emptySection(),
      low_priority_summary: [
        {
          contact: "Messages Source",
          summary: truncate(error instanceof Error ? error.message : String(error), 180)
        }
      ]
    };
  }
}
