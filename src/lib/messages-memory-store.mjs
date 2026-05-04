import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

function defaultStore() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    candidates: []
  };
}

export async function loadMessagesMemoryStore(storagePath) {
  try {
    const contents = await readFile(storagePath, "utf8");
    const parsed = JSON.parse(contents);

    return {
      ...defaultStore(),
      ...parsed,
      candidates: Array.isArray(parsed?.candidates) ? parsed.candidates : []
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return defaultStore();
    }

    throw error;
  }
}

export async function saveMessagesMemoryStore(storagePath, store = defaultStore()) {
  await mkdir(path.dirname(storagePath), { recursive: true });
  await writeFile(
    storagePath,
    JSON.stringify(
      {
        ...defaultStore(),
        ...store,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
}

export async function upsertMessagesMemoryCandidates(storagePath, candidates = []) {
  const store = await loadMessagesMemoryStore(storagePath);
  const byKey = new Map(
    store.candidates.map((candidate) => [
      `${candidate.contact}|${candidate.memoryType}|${candidate.summary}`,
      candidate
    ])
  );

  for (const candidate of candidates) {
    const key = `${candidate.contact}|${candidate.memoryType}|${candidate.summary}`;
    const existing = byKey.get(key);

    byKey.set(key, {
      ...existing,
      ...candidate,
      firstSeen: existing?.firstSeen ?? candidate.firstSeen,
      lastSeen: candidate.lastSeen,
      sourceMessageIds: candidate.sourceMessageIds ?? existing?.sourceMessageIds ?? [],
      confidence: Math.max(existing?.confidence ?? 0, candidate.confidence ?? 0),
      updatedAt: new Date().toISOString()
    });
  }

  const nextStore = {
    ...store,
    candidates: [...byKey.values()].sort((left, right) => String(right.lastSeen || "").localeCompare(String(left.lastSeen || "")))
  };

  await saveMessagesMemoryStore(storagePath, nextStore);
  return nextStore;
}
