import { writeFile } from "node:fs/promises";
import path from "node:path";

import { runAutoBrief } from "../../src/lib/auto-brief.mjs";

function parseArgs(argv = []) {
  const args = {
    bundle: "",
    out: "",
    recipient: "",
    send: false,
    hours: 24,
    maxMessages: 200,
    query: "-in:trash -in:spam -subject:\"Daily ShelfCycle Brief\"",
    timeZone: "America/New_York",
    locale: "en-US"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--bundle") {
      args.bundle = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--out") {
      args.out = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--recipient") {
      args.recipient = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--hours") {
      args.hours = Number.parseInt(argv[index + 1], 10) || 24;
      index += 1;
      continue;
    }

    if (value === "--max-messages") {
      args.maxMessages = Number.parseInt(argv[index + 1], 10) || 200;
      index += 1;
      continue;
    }

    if (value === "--query") {
      args.query = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--timezone") {
      args.timeZone = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--locale") {
      args.locale = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--send") {
      args.send = true;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.bundle) {
    throw new Error("Usage: node apps/daily-brief/run.mjs --bundle path/to/knowledge.json [--out brief.txt] [--send]");
  }

  const result = await runAutoBrief({
    bundlePath: args.bundle,
    recipient: args.recipient,
    send: args.send,
    hours: args.hours,
    maxMessages: args.maxMessages,
    query: args.query,
    timeZone: args.timeZone,
    locale: args.locale
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
