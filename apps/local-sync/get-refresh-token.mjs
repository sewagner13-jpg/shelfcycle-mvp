import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import http from "node:http";

function parseArgs(argv = []) {
  const args = {
    clientId: process.env.GMAIL_CLIENT_ID || "",
    clientSecret: process.env.GMAIL_CLIENT_SECRET || "",
    out: "",
    user: process.env.GMAIL_USER || "sean@clear-edge.net",
    port: 8765,
    includeDrive: false,
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify"
    ]
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--client-id") {
      args.clientId = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--out") {
      args.out = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--client-secret") {
      args.clientSecret = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--user") {
      args.user = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--port") {
      args.port = Number.parseInt(argv[index + 1], 10) || args.port;
      index += 1;
      continue;
    }

    if (value === "--scopes") {
      args.scopes = String(argv[index + 1] || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }

    if (value === "--include-drive") {
      args.includeDrive = true;
    }
  }

  if (args.includeDrive) {
    args.scopes = [...new Set([...args.scopes, "https://www.googleapis.com/auth/drive.readonly"])];
  }

  return args;
}

function base64Url(buffer) {
  return buffer.toString("base64url");
}

function buildPkcePair() {
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

function waitForAuthorizationCode({ port }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html><body><h1>Authorization received</h1><p>You can close this window.</p></body></html>");

      server.close();

      if (error) {
        reject(new Error(`OAuth authorization failed: ${error}`));
        return;
      }

      if (!code) {
        reject(new Error("OAuth authorization completed without an authorization code."));
        return;
      }

      resolve(code);
    });

    server.listen(port, "127.0.0.1", () => {
      process.stdout.write(`Listening for OAuth callback on http://127.0.0.1:${port}/oauth2callback\n`);
    });
  });
}

async function exchangeCodeForToken({ clientId, clientSecret, code, codeVerifier, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri
  });

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to exchange authorization code: ${errorText}`);
  }

  return response.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.clientId || !args.out) {
    throw new Error("Usage: node apps/local-sync/get-refresh-token.mjs --client-id CLIENT_ID --out token.json [--client-secret SECRET] [--user email] [--include-drive]");
  }

  const { codeVerifier, codeChallenge } = buildPkcePair();
  const redirectUri = `http://127.0.0.1:${args.port}/oauth2callback`;
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", args.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("scope", args.scopes.join(" "));
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("login_hint", args.user);

  process.stdout.write(`${authUrl.toString()}\n`);
  const code = await waitForAuthorizationCode({ port: args.port });
  const token = await exchangeCodeForToken({
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    code,
    codeVerifier,
    redirectUri
  });

  const payload = {
    ...token,
    email: args.user,
    created_at: new Date().toISOString()
  };

  await writeFile(args.out, JSON.stringify(payload, null, 2));
  process.stdout.write(`Wrote token payload to ${args.out}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
