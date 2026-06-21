import { getStore } from "@netlify/blobs";

const STORE_NAME = "clearedge-shared";
const KNOWLEDGE_KEY = "knowledge-bundle.json";
const LAST_BRIEF_KEY = "latest-daily-brief.txt";
const SETTINGS_KEY = "brief-settings.json";
const REVIEW_ACTION_PREFIX = "review-actions";
const FULL_EMAIL_REVIEW_PREFIX = "review-action-full-email";

function getScopedStore() {
  // Use the site-wide store for operational data that must survive manual
  // deploys, including Gmail/OpenAI settings and review packets.
  return getStore(STORE_NAME, { consistency: "strong" });
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

export async function saveFullEmailReviewState(actionId, state) {
  const store = getScopedStore();
  await store.setJSON(`${FULL_EMAIL_REVIEW_PREFIX}/${actionId}.json`, state);
}

export async function loadFullEmailReviewState(actionId) {
  const store = getScopedStore();
  return store.get(`${FULL_EMAIL_REVIEW_PREFIX}/${actionId}.json`, { type: "json" });
}
