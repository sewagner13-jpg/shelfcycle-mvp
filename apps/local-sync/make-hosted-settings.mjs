import { writeFile } from "node:fs/promises";

import { loadCredentials } from "../../src/lib/gmail-client.mjs";

function parseArgs(argv = []) {
  const args = {
    credentialsPath: process.env.GMAIL_CREDENTIALS_PATH || "",
    tokenPath: process.env.GMAIL_TOKEN_PATH || "",
    clientId: process.env.GMAIL_CLIENT_ID || "",
    clientSecret: process.env.GMAIL_CLIENT_SECRET || "",
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || "",
    user: process.env.GMAIL_USER || "",
    out: "",
    recipient: "sean@clear-edge.net",
    hours: 24,
    maxMessages: 200,
    query: "-in:trash -in:spam -subject:\"Daily ShelfCycle Brief\"",
    timeZone: "America/New_York",
    locale: "en-US",
    openAiApiKey: process.env.OPENAI_API_KEY || "",
    openAiModel: process.env.OPENAI_BUSINESS_CARD_MODEL || process.env.OPENAI_MODEL || ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--credentials") {
      args.credentialsPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--token") {
      args.tokenPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--client-id") {
      args.clientId = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--client-secret") {
      args.clientSecret = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--refresh-token") {
      args.refreshToken = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--user") {
      args.user = argv[index + 1];
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

    if (value === "--openai-api-key") {
      args.openAiApiKey = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--openai-model") {
      args.openAiModel = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.out) {
    throw new Error("Usage: node apps/local-sync/make-hosted-settings.mjs --out hosted-settings.json [--credentials credentials.json --token token.json] [--client-id ... --refresh-token ...]");
  }

  const credentials = await loadCredentials({
    credentialsPath: args.credentialsPath,
    tokenPath: args.tokenPath,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    refreshToken: args.refreshToken,
    user: args.user || args.recipient
  });

  if (!credentials.clientId || !credentials.refreshToken) {
    throw new Error("Could not resolve Gmail OAuth client id or refresh token.");
  }

  const payload = {
    recipient: args.recipient,
    hours: args.hours,
    maxMessages: args.maxMessages,
    query: args.query,
    timeZone: args.timeZone,
    locale: args.locale,
    gmailConfig: {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret || "",
      refreshToken: credentials.refreshToken,
      user: credentials.user || args.recipient
    }
  };

  if (args.openAiApiKey) {
    payload.openAiConfig = {
      apiKey: args.openAiApiKey,
      ...(args.openAiModel ? { businessCardModel: args.openAiModel } : {})
    };
  }

  if (args.openAiApiKey) {
    payload.aiBriefConfig = {
      enabled: true,
      apiKey: args.openAiApiKey,
      ...(args.openAiModel ? { model: args.openAiModel } : {})
    };
  }

  await writeFile(args.out, JSON.stringify(payload, null, 2));
  console.log(`Hosted settings file written to ${args.out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
