import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const defaultReviewActionsDir = path.join(projectRoot, ".local", "review-actions");
const defaultTokenPath = path.join(projectRoot, ".local", "knowledge-sync-token.local");
const defaultEndpoint = "https://clearedge-daily-brief.netlify.app/api/review-action-sync";

function parseArgs(argv = []) {
  const args = {
    dir: defaultReviewActionsDir,
    endpoint: process.env.CLEAREDGE_REVIEW_SYNC_ENDPOINT || defaultEndpoint,
    token: process.env.KNOWLEDGE_SYNC_TOKEN || "",
    tokenFile: process.env.CLEAREDGE_REVIEW_SYNC_TOKEN_PATH || defaultTokenPath,
    limit: 0,
    batchSize: 50
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--dir") {
      args.dir = argv[index + 1] || args.dir;
      index += 1;
      continue;
    }

    if (value === "--endpoint") {
      args.endpoint = argv[index + 1] || args.endpoint;
      index += 1;
      continue;
    }

    if (value === "--token") {
      args.token = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (value === "--token-file") {
      args.tokenFile = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (value === "--limit") {
      args.limit = Number.parseInt(argv[index + 1], 10) || 0;
      index += 1;
      continue;
    }

    if (value === "--batch-size") {
      args.batchSize = Number.parseInt(argv[index + 1], 10) || 50;
      index += 1;
    }
  }

  return args;
}

async function readTextIfPresent(filePath = "") {
  if (!filePath) {
    return "";
  }

  try {
    return (await readFile(path.resolve(filePath), "utf8")).trim();
  } catch {
    return "";
  }
}

async function readReviewActions(dir, limit = 0) {
  const entries = await readdir(path.resolve(dir), { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(path.resolve(dir), entry.name))
    .sort();
  const selected = limit > 0 ? files.slice(-limit) : files;
  const actions = [];

  for (const filePath of selected) {
    const action = JSON.parse(await readFile(filePath, "utf8"));

    if (action?.id && action?.viewToken) {
      actions.push(action);
    }
  }

  return actions;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = args.token || await readTextIfPresent(args.tokenFile);

  if (!args.endpoint || !token) {
    throw new Error("Missing review sync endpoint or token.");
  }

  const actions = await readReviewActions(args.dir, args.limit);

  if (!actions.length) {
    console.log(JSON.stringify({ ok: true, synced: 0, message: "No local review actions found." }, null, 2));
    return;
  }

  const syncedIds = [];
  const batchSize = Math.max(1, args.batchSize);

  for (let index = 0; index < actions.length; index += batchSize) {
    const batch = actions.slice(index, index + batchSize);
    const response = await fetch(args.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ actions: batch })
    });
    const text = await response.text();
    let payload = {};

    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text };
    }

    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || payload.message || `Review action sync failed with status ${response.status}.`);
    }

    syncedIds.push(...(payload.ids ?? batch.map((action) => action.id)));
  }

  console.log(JSON.stringify({
    ok: true,
    endpoint: args.endpoint,
    synced: syncedIds.length,
    batchSize,
    ids: syncedIds
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
