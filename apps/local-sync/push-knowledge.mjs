import { readFile } from "node:fs/promises";

function parseArgs(argv = []) {
  const args = {
    bundle: "",
    endpoint: process.env.KNOWLEDGE_SYNC_URL || "",
    token: process.env.KNOWLEDGE_SYNC_TOKEN || ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--bundle") {
      args.bundle = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--endpoint") {
      args.endpoint = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--token") {
      args.token = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.bundle || !args.endpoint || !args.token) {
    throw new Error("Usage: node apps/local-sync/push-knowledge.mjs --bundle path/to/bundle.json --endpoint https://.../api/knowledge-sync --token secret");
  }

  const bundle = JSON.parse(await readFile(args.bundle, "utf8"));
  const response = await fetch(args.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${args.token}`
    },
    body: JSON.stringify(bundle)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Knowledge sync failed (${response.status}): ${text}`);
  }

  process.stdout.write(`${text}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
