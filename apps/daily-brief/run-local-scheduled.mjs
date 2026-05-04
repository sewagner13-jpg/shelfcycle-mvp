import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAutoBrief } from "../../src/lib/auto-brief.mjs";
import { loadBriefControl } from "../../src/lib/brief-control.mjs";
import { attachLocalReviewActions } from "../../src/lib/local-review-actions.mjs";
import { loadMessagesMemoryConfig } from "../../src/lib/messages-memory-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const localDir = path.join(projectRoot, ".local");
const runsDir = path.join(localDir, "daily-brief-runs");
const defaultBundlePath = path.join(localDir, "clearedge-knowledge-local.json");
const defaultSettingsPath = path.join(localDir, "hosted-brief-settings.local.json");
const defaultMessagesConfigPath = path.join(localDir, "messages-memory-config.local.json");
const defaultBriefControlPath = path.join(localDir, "brief-control.local.json");
const defaultReviewActionsDir = path.join(localDir, "review-actions");
const defaultLockDir = path.join(localDir, "daily-brief-runner.lock");

function parseArgs(argv = []) {
  const args = {
    bundle: defaultBundlePath,
    settings: defaultSettingsPath,
    messagesMemoryConfig: defaultMessagesConfigPath,
    briefControl: defaultBriefControlPath,
    reviewActionsDir: defaultReviewActionsDir,
    reviewBaseUrl: "http://localhost:4318",
    outDir: runsDir,
    hours: null,
    maxMessages: null,
    maxMessageThreads: null,
    recipient: "",
    briefFormat: "action_cards",
    dryRun: false,
    lockDir: defaultLockDir
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--bundle") {
      args.bundle = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--settings") {
      args.settings = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--messages-memory-config") {
      args.messagesMemoryConfig = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--brief-control") {
      args.briefControl = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--review-actions-dir") {
      args.reviewActionsDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--review-base-url") {
      args.reviewBaseUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--out-dir") {
      args.outDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--hours") {
      args.hours = Number.parseInt(argv[index + 1], 10) || null;
      index += 1;
      continue;
    }

    if (value === "--max-messages") {
      args.maxMessages = Number.parseInt(argv[index + 1], 10) || null;
      index += 1;
      continue;
    }

    if (value === "--max-message-threads") {
      args.maxMessageThreads = Number.parseInt(argv[index + 1], 10) || null;
      index += 1;
      continue;
    }

    if (value === "--recipient") {
      args.recipient = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--brief-format") {
      args.briefFormat = argv[index + 1] || "action_cards";
      index += 1;
      continue;
    }

    if (value === "--lock-dir") {
      args.lockDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--dry-run") {
      args.dryRun = true;
    }
  }

  return args;
}

function runStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${label} at ${filePath}: ${error.message}`);
  }
}

async function logLine(logPath, message) {
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, `${new Date().toISOString()} ${message}\n`, {
    flag: "a"
  });
}

async function acquireLock(lockDir, { staleAfterMs = 2 * 60 * 60 * 1000 } = {}) {
  const resolved = path.resolve(lockDir);

  try {
    await mkdir(resolved, { recursive: false });
    await writeFile(path.join(resolved, "pid"), `${process.pid}\n`, "utf8");
    return async () => {
      await rm(resolved, { recursive: true, force: true });
    };
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }

    const current = await stat(resolved).catch(() => null);
    const ageMs = current ? Date.now() - current.mtimeMs : 0;

    if (ageMs > staleAfterMs) {
      await rm(resolved, { recursive: true, force: true });
      return acquireLock(resolved, { staleAfterMs });
    }

    throw new Error(`Daily brief runner is already running. Lock: ${resolved}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stamp = runStamp();
  const outDir = path.resolve(args.outDir);
  const briefPath = path.join(outDir, `combined-brief-${stamp}.txt`);
  const runSummaryPath = path.join(outDir, `run-summary-${stamp}.json`);
  const logPath = path.join(outDir, "daily-brief-runner.log");
  let releaseLock = null;

  await mkdir(outDir, { recursive: true });
  await logLine(logPath, `starting local scheduled brief; dryRun=${args.dryRun}`);

  try {
    releaseLock = await acquireLock(args.lockDir);

    const [bundle, settings, messagesConfig, briefControl] = await Promise.all([
      readJson(args.bundle, "knowledge bundle"),
      readJson(args.settings, "Gmail settings"),
      loadMessagesMemoryConfig(path.resolve(args.messagesMemoryConfig)),
      loadBriefControl(path.resolve(args.briefControl))
    ]);
    const mergedMessagesConfig = {
      ...messagesConfig,
      blacklist: [
        ...(messagesConfig.blacklist ?? []),
        ...(briefControl.exclude?.emails ?? []),
        ...(briefControl.exclude?.phones ?? [])
      ],
      excludedKeywords: [
        ...(messagesConfig.excludedKeywords ?? []),
        ...(briefControl.exclude?.keywords ?? [])
      ]
    };

    const result = await runAutoBrief({
      bundle,
      gmailConfig: settings.gmailConfig ?? {},
      googleWorkspaceConfig: settings.googleWorkspaceConfig ?? {},
      recipient: args.recipient || settings.recipient,
      hours: args.hours ?? settings.hours ?? 24,
      maxMessages: args.maxMessages ?? settings.maxMessages ?? 200,
      maxMessageThreads: args.maxMessageThreads ?? settings.maxMessageThreads ?? mergedMessagesConfig.maxThreads,
      query: settings.query,
      includeMessages: true,
      briefFormat: settings.briefFormat || args.briefFormat,
      messagesConfig: mergedMessagesConfig,
      briefControl,
      send: !args.dryRun,
      timeZone: settings.timeZone || "America/New_York",
      locale: settings.locale || "en-US",
      decorateAnalyzedThreads: (analyzedThreads) =>
        attachLocalReviewActions(analyzedThreads, {
          storageDir: path.resolve(args.reviewActionsDir),
          baseUrl: args.reviewBaseUrl
        })
    });

    const messageMemory = result.messageMemory ?? {};
    const summary = {
      ok: true,
      dryRun: args.dryRun,
      generatedAt: new Date().toISOString(),
      profileEmail: result.profile?.emailAddress ?? "",
      sent: Boolean(result.sendResult),
      sendResultId: result.sendResult?.id ?? "",
      emailThreads: result.analyzedThreads?.length ?? 0,
      messageBusinessThreads: messageMemory.business_threads?.length ?? 0,
      unknownMessageContacts: messageMemory.unknown_contacts?.length ?? 0,
      unknownContacts: messageMemory.unknown_contacts ?? [],
      messageFollowups: messageMemory.suggested_followups?.length ?? 0,
      reviewLinks: result.analyzedThreads?.filter((item) => item.reviewUrl).length ?? 0,
      briefPath
    };

    await writeFile(briefPath, result.brief, "utf8");
    await writeFile(runSummaryPath, JSON.stringify(summary, null, 2), "utf8");
    await logLine(
      logPath,
      `finished ok; emailThreads=${summary.emailThreads}; messageBusinessThreads=${summary.messageBusinessThreads}; unknownMessageContacts=${summary.unknownMessageContacts}; reviewLinks=${summary.reviewLinks}; sent=${summary.sent}; brief=${briefPath}`
    );
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    const summary = {
      ok: false,
      generatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    };

    await writeFile(runSummaryPath, JSON.stringify(summary, null, 2), "utf8").catch(() => {});
    await logLine(logPath, `failed; ${summary.error}`).catch(() => {});
    throw error;
  } finally {
    if (releaseLock) {
      await releaseLock();
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
