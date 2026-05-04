import { getDeployStore, getStore } from "@netlify/blobs";

const STORE_NAME = "clearedge-shared";
const KNOWLEDGE_KEY = "knowledge-bundle.json";
const LAST_BRIEF_KEY = "latest-daily-brief.txt";
const SETTINGS_KEY = "brief-settings.json";
const REVIEW_ACTION_PREFIX = "review-actions";

function isProductionContext() {
  return process.env.CONTEXT === "production" || process.env.DEPLOY_PRIME_URL === process.env.URL;
}

function getScopedStore() {
  if (isProductionContext()) {
    return getStore(STORE_NAME, { consistency: "strong" });
  }

  return getDeployStore(STORE_NAME, { consistency: "strong" });
}

export async function saveKnowledgeBundle(bundle) {
  const store = getScopedStore();
  await store.setJSON(KNOWLEDGE_KEY, bundle);
}

export async function loadKnowledgeBundle() {
  const store = getScopedStore();
  return store.get(KNOWLEDGE_KEY, { type: "json" });
}

export async function saveLatestBrief(brief) {
  const store = getScopedStore();
  await store.set(LAST_BRIEF_KEY, brief);
}

export async function loadLatestBrief() {
  const store = getScopedStore();
  return store.get(LAST_BRIEF_KEY, { type: "text" });
}

export async function saveBriefSettings(settings) {
  const store = getScopedStore();
  await store.setJSON(SETTINGS_KEY, settings);
}

export async function loadBriefSettings() {
  const store = getScopedStore();
  return store.get(SETTINGS_KEY, { type: "json" });
}

export async function saveReviewAction(action) {
  const store = getScopedStore();
  await store.setJSON(`${REVIEW_ACTION_PREFIX}/${action.id}.json`, action);
}

export async function loadReviewAction(actionId) {
  const store = getScopedStore();
  return store.get(`${REVIEW_ACTION_PREFIX}/${actionId}.json`, { type: "json" });
}
