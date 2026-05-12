import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runAutoBrief } from "../../src/lib/auto-brief.mjs";
import { attachLocalReviewActions } from "../../src/lib/local-review-actions.mjs";
import { loadMessagesMemoryConfig } from "../../src/lib/messages-memory-config.mjs";

const projectRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const localDir = path.join(projectRoot, ".local");
const defaultReviewActionsDir = path.join(projectRoot, ".local", "review-actions");
const defaultPublicReviewBaseUrl = "https://clearedge-daily-brief.netlify.app";
const defaultReviewSyncTokenPath = path.join(localDir, "knowledge-sync-token.local");

function parseArgs(argv = []) {
  const args = {
    bundle: "",
    out: "",
    recipient: "",
    send: false,
    hours: 24,
    maxMessages: 200,
    maxMessageThreads: 120,
    query: "-in:trash -in:spam -subject:\"Daily ShelfCycle Brief\"",
    includeMessages: false,
    aiBrief: null,
    aiBriefModel: "",
    briefFormat: "action_cards",
    reviewActionsDir: defaultReviewActionsDir,
    reviewBaseUrl: process.env.CLEAREDGE_REVIEW_PUBLIC_BASE_URL || defaultPublicReviewBaseUrl,
    localReviewBaseUrl: "http://localhost:4318",
    reviewSyncEndpoint: process.env.CLEAREDGE_REVIEW_SYNC_ENDPOINT || "",
    reviewSyncToken: process.env.KNOWLEDGE_SYNC_TOKEN || "",
    reviewSyncTokenPath: process.env.CLEAREDGE_REVIEW_SYNC_TOKEN_PATH || defaultReviewSyncTokenPath,
    noReviewSync: false,
    messagesDb: "",
    messagesMemoryConfig: "",
    settings: "",
    timeZone: "America/New_York",
    locale: "en-US",
    provided: new Set()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--bundle") {
      args.bundle = argv[index + 1];
      args.provided.add("bundle");
      index += 1;
      continue;
    }

    if (value === "--out") {
      args.out = argv[index + 1];
      args.provided.add("out");
      index += 1;
      continue;
    }

    if (value === "--recipient") {
      args.recipient = argv[index + 1];
      args.provided.add("recipient");
      index += 1;
      continue;
    }

    if (value === "--hours") {
      args.hours = Number.parseInt(argv[index + 1], 10) || 24;
      args.provided.add("hours");
      index += 1;
      continue;
    }

    if (value === "--max-messages") {
      args.maxMessages = Number.parseInt(argv[index + 1], 10) || 200;
      args.provided.add("maxMessages");
      index += 1;
      continue;
    }

    if (value === "--query") {
      args.query = argv[index + 1];
      args.provided.add("query");
      index += 1;
      continue;
    }

    if (value === "--max-message-threads") {
      args.maxMessageThreads = Number.parseInt(argv[index + 1], 10) || 120;
      args.provided.add("maxMessageThreads");
      index += 1;
      continue;
    }

    if (value === "--messages-db") {
      args.messagesDb = argv[index + 1];
      args.provided.add("messagesDb");
      index += 1;
      continue;
    }

    if (value === "--messages-memory-config") {
      args.messagesMemoryConfig = argv[index + 1];
      args.provided.add("messagesMemoryConfig");
      index += 1;
      continue;
    }

    if (value === "--settings") {
      args.settings = argv[index + 1];
      args.provided.add("settings");
      index += 1;
      continue;
    }

    if (value === "--timezone") {
      args.timeZone = argv[index + 1];
      args.provided.add("timeZone");
      index += 1;
      continue;
    }

    if (value === "--locale") {
      args.locale = argv[index + 1];
      args.provided.add("locale");
      index += 1;
      continue;
    }

    if (value === "--send") {
      args.send = true;
      args.provided.add("send");
      continue;
    }

    if (value === "--include-messages") {
      args.includeMessages = true;
      args.provided.add("includeMessages");
      continue;
    }

    if (value === "--ai-brief") {
      args.aiBrief = true;
      args.provided.add("aiBrief");
      continue;
    }

    if (value === "--no-ai-brief") {
      args.aiBrief = false;
      args.provided.add("aiBrief");
      continue;
    }

    if (value === "--ai-brief-model") {
      args.aiBriefModel = argv[index + 1] || "";
      args.provided.add("aiBriefModel");
      index += 1;
      continue;
    }

    if (value === "--brief-format") {
      args.briefFormat = argv[index + 1] || "action_cards";
      args.provided.add("briefFormat");
      index += 1;
      continue;
    }

    if (value === "--review-actions-dir") {
      args.reviewActionsDir = argv[index + 1] || defaultReviewActionsDir;
      args.provided.add("reviewActionsDir");
      index += 1;
      continue;
    }

    if (value === "--review-base-url") {
      args.reviewBaseUrl = argv[index + 1] || defaultPublicReviewBaseUrl;
      args.provided.add("reviewBaseUrl");
      index += 1;
      continue;
    }

    if (value === "--local-review-base-url") {
      args.localReviewBaseUrl = argv[index + 1] || "http://localhost:4318";
      args.provided.add("localReviewBaseUrl");
      index += 1;
      continue;
    }

    if (value === "--review-sync-endpoint") {
      args.reviewSyncEndpoint = argv[index + 1] || "";
      args.provided.add("reviewSyncEndpoint");
      index += 1;
      continue;
    }

    if (value === "--review-sync-token") {
      args.reviewSyncToken = argv[index + 1] || "";
      args.provided.add("reviewSyncToken");
      index += 1;
      continue;
    }

    if (value === "--review-sync-token-file") {
      args.reviewSyncTokenPath = argv[index + 1] || "";
      args.provided.add("reviewSyncTokenPath");
      index += 1;
      continue;
    }

    if (value === "--no-review-sync") {
      args.noReviewSync = true;
      args.provided.add("noReviewSync");
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

function cleanBaseUrl(value = "") {
  return String(value || "").replace(/\/+$/, "");
}

async function resolveReviewSyncConfig(args = {}, settings = {}, value = () => "") {
  const reviewBaseUrl = cleanBaseUrl(value("reviewBaseUrl", args.reviewBaseUrl) || settings.siteUrl || defaultPublicReviewBaseUrl);
  const reviewSyncEndpoint = value("noReviewSync", args.noReviewSync)
    ? ""
    : (
      value("reviewSyncEndpoint", args.reviewSyncEndpoint) ||
      settings.reviewSyncEndpoint ||
      process.env.CLEAREDGE_REVIEW_SYNC_ENDPOINT ||
      `${reviewBaseUrl}/api/review-action-sync`
    );
  const tokenPath = value("reviewSyncTokenPath", args.reviewSyncTokenPath);
  const reviewSyncToken = value("noReviewSync", args.noReviewSync)
    ? ""
    : (
      value("reviewSyncToken", args.reviewSyncToken) ||
      process.env.KNOWLEDGE_SYNC_TOKEN ||
      settings.reviewSyncToken ||
      await readTextIfPresent(tokenPath)
    );

  return {
    reviewBaseUrl,
    localReviewBaseUrl: cleanBaseUrl(value("localReviewBaseUrl", args.localReviewBaseUrl) || "http://localhost:4318"),
    reviewSyncEndpoint,
    reviewSyncToken
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const settings = args.settings
    ? JSON.parse(await readFile(path.resolve(args.settings), "utf8"))
    : {};
  const value = (name, fallback) => (args.provided.has(name) ? args[name] : (settings[name] ?? fallback));
  const reviewSyncConfig = await resolveReviewSyncConfig(args, settings, value);

  if (!args.bundle) {
    throw new Error(
      "Usage: node apps/daily-brief/run.mjs --bundle path/to/knowledge.json [--settings settings.json] [--out brief.txt] [--send]"
    );
  }

  const messagesMemoryConfig = args.messagesMemoryConfig
    ? await loadMessagesMemoryConfig(path.resolve(args.messagesMemoryConfig))
    : value("includeMessages", args.includeMessages)
      ? { enabled: true }
      : { enabled: false };

  const result = await runAutoBrief({
    bundlePath: args.bundle,
    gmailConfig: settings.gmailConfig ?? {},
    googleWorkspaceConfig: settings.googleWorkspaceConfig ?? {},
    signatureExtractionConfig: settings.signatureExtractionConfig ?? settings.openAiConfig ?? {},
    recipient: value("recipient", args.recipient),
    send: args.send,
    hours: value("hours", args.hours),
    maxMessages: value("maxMessages", args.maxMessages),
    maxMessageThreads: value("maxMessageThreads", args.maxMessageThreads),
    query: value("query", args.query),
    includeMessages: messagesMemoryConfig.enabled,
    aiBriefConfig: {
      ...(settings.aiBriefConfig ?? {}),
      ...(args.provided.has("aiBrief") ? { enabled: args.aiBrief } : {}),
      ...(args.provided.has("aiBriefModel") ? { model: args.aiBriefModel } : {})
    },
    briefFormat: value("briefFormat", args.briefFormat),
    messagesConfig: messagesMemoryConfig.enabled
      ? {
          ...messagesMemoryConfig,
          ...(args.messagesDb ? { dbPath: args.messagesDb } : {})
        }
      : {},
    timeZone: value("timeZone", args.timeZone),
    locale: value("locale", args.locale),
    decorateAnalyzedThreads: (analyzedThreads) =>
      attachLocalReviewActions(analyzedThreads, {
        storageDir: path.resolve(value("reviewActionsDir", args.reviewActionsDir)),
        baseUrl: reviewSyncConfig.reviewBaseUrl,
        localBaseUrl: reviewSyncConfig.localReviewBaseUrl,
        syncEndpoint: reviewSyncConfig.reviewSyncEndpoint,
        syncToken: reviewSyncConfig.reviewSyncToken
      })
  });

  if (args.out) {
    await writeFile(path.resolve(args.out), result.brief, "utf8");
  }

  process.stdout.write(`${result.brief}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
