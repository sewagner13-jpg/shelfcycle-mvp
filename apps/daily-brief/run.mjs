import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runAutoBrief } from "../../src/lib/auto-brief.mjs";
import { loadMessagesMemoryConfig } from "../../src/lib/messages-memory-config.mjs";

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
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const settings = args.settings
    ? JSON.parse(await readFile(path.resolve(args.settings), "utf8"))
    : {};
  const value = (name, fallback) => (args.provided.has(name) ? args[name] : (settings[name] ?? fallback));

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
    recipient: value("recipient", args.recipient),
    send: args.send,
    hours: value("hours", args.hours),
    maxMessages: value("maxMessages", args.maxMessages),
    maxMessageThreads: value("maxMessageThreads", args.maxMessageThreads),
    query: value("query", args.query),
    includeMessages: messagesMemoryConfig.enabled,
    messagesConfig: messagesMemoryConfig.enabled
      ? {
          ...messagesMemoryConfig,
          ...(args.messagesDb ? { dbPath: args.messagesDb } : {})
        }
      : {},
    timeZone: value("timeZone", args.timeZone),
    locale: value("locale", args.locale)
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
