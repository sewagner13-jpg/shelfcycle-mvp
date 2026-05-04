import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";

const DEFAULT_BUSINESS_KEYWORDS = [
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
  "ship",
  "delivered",
  "invoice",
  "payment",
  "freight",
  "truck",
  "container",
  "drum",
  "tote",
  "pallet",
  "lead time",
  "order",
  "resin",
  "silane",
  "epoxy",
  "curing agent",
  "benzyl alcohol",
  "availability"
];

const DEFAULT_URGENT_KEYWORDS = [
  "urgent",
  "asap",
  "today",
  "right away",
  "immediately",
  "late",
  "delay",
  "problem",
  "issue",
  "wrong",
  "missing"
];

export function defaultMessagesMemoryConfig() {
  return {
    enabled: false,
    lookbackHours: 24,
    maxThreads: 120,
    useSnapshot: true,
    businessWhitelist: [],
    blacklist: [],
    excludedKeywords: [],
    businessKeywords: DEFAULT_BUSINESS_KEYWORDS,
    urgentKeywords: DEFAULT_URGENT_KEYWORDS,
    storeRawMessages: false,
    storagePath: path.join(process.cwd(), ".local", "messages-memory-store.json"),
    messagesDbPath: path.join(os.homedir(), "Library", "Messages", "chat.db")
  };
}

function normalizeArray(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean))];
}

export function normalizeMessagesMemoryConfig(config = {}) {
  const defaults = defaultMessagesMemoryConfig();

  return {
    ...defaults,
    ...config,
    enabled: Boolean(config.enabled ?? defaults.enabled),
    lookbackHours: Number.parseInt(config.lookbackHours ?? defaults.lookbackHours, 10) || defaults.lookbackHours,
    maxThreads: Number.parseInt(config.maxThreads ?? defaults.maxThreads, 10) || defaults.maxThreads,
    useSnapshot: config.useSnapshot ?? defaults.useSnapshot,
    businessWhitelist: normalizeArray(config.businessWhitelist ?? defaults.businessWhitelist),
    blacklist: normalizeArray(config.blacklist ?? defaults.blacklist),
    excludedKeywords: normalizeArray(config.excludedKeywords ?? config.excludeKeywords ?? defaults.excludedKeywords).map((value) => value.toLowerCase()),
    businessKeywords: normalizeArray(config.businessKeywords ?? defaults.businessKeywords),
    urgentKeywords: normalizeArray(config.urgentKeywords ?? defaults.urgentKeywords),
    storeRawMessages: Boolean(config.storeRawMessages ?? defaults.storeRawMessages),
    storagePath: String(config.storagePath ?? defaults.storagePath),
    messagesDbPath: String(config.messagesDbPath ?? config.dbPath ?? defaults.messagesDbPath)
  };
}

export async function loadMessagesMemoryConfig(configPath = "") {
  if (!configPath) {
    return defaultMessagesMemoryConfig();
  }

  const contents = await readFile(configPath, "utf8");
  return normalizeMessagesMemoryConfig(JSON.parse(contents));
}
