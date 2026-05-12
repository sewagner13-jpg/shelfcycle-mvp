import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send"
];

function base64UrlEncode(value = "") {
  return Buffer.from(value, "utf8").toString("base64url");
}

function escapeHeader(value = "") {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function quoteHeaderValue(value = "") {
  return escapeHeader(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function foldBase64(value = "") {
  return String(value).replace(/.{1,76}/g, "$&\n").trim();
}

function attachmentBodyToBase64(attachment = {}) {
  const value = attachment.data ?? attachment.body ?? attachment.base64 ?? "";

  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }

  if (attachment.encoding === "base64") {
    return String(value).replace(/\s+/g, "");
  }

  return Buffer.from(String(value), "base64url").toString("base64");
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeScopes(value = DEFAULT_GMAIL_SCOPES) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  const scopes = raw.map((scope) => String(scope || "").trim()).filter(Boolean);
  return scopes.length ? scopes : [...DEFAULT_GMAIL_SCOPES];
}

async function readJsonIfExists(filePath) {
  if (!filePath) {
    return null;
  }

  try {
    const contents = await readFile(filePath, "utf8");
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

export async function loadCredentials(config = {}) {
  const credentialsPath = firstDefined(config.credentialsPath, process.env.GMAIL_CREDENTIALS_PATH);
  const tokenPath = firstDefined(config.tokenPath, process.env.GMAIL_TOKEN_PATH);
  const serviceAccountPath = firstDefined(
    config.serviceAccountKeyPath,
    config.serviceAccountPath,
    process.env.GMAIL_SERVICE_ACCOUNT_KEY_PATH,
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
  );
  const credentialsJson = firstDefined(config.credentialsJson, process.env.GMAIL_CREDENTIALS_JSON);
  const tokenJson = firstDefined(config.tokenJson, process.env.GMAIL_TOKEN_JSON);
  const serviceAccountJson = firstDefined(
    config.serviceAccountJson,
    process.env.GMAIL_SERVICE_ACCOUNT_JSON,
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  );

  const credentialsFile = credentialsJson ? JSON.parse(credentialsJson) : await readJsonIfExists(credentialsPath);
  const tokenFile = tokenJson ? JSON.parse(tokenJson) : await readJsonIfExists(tokenPath);
  const serviceAccountFile = serviceAccountJson
    ? JSON.parse(serviceAccountJson)
    : await readJsonIfExists(serviceAccountPath);

  const installed = credentialsFile?.installed ?? credentialsFile?.web ?? {};
  const serviceAccount = serviceAccountFile?.client_email
    ? serviceAccountFile
    : serviceAccountFile?.service_account ?? {};
  const delegatedUser = firstDefined(
    config.delegatedUser,
    process.env.GMAIL_DELEGATED_USER,
    process.env.GOOGLE_WORKSPACE_DELEGATED_USER,
    ""
  );
  const user = firstDefined(config.user, process.env.GMAIL_USER, delegatedUser, tokenFile?.email, "me");

  return {
    clientId: firstDefined(config.clientId, process.env.GMAIL_CLIENT_ID, installed.client_id),
    clientSecret: firstDefined(config.clientSecret, process.env.GMAIL_CLIENT_SECRET, installed.client_secret),
    refreshToken: firstDefined(config.refreshToken, process.env.GMAIL_REFRESH_TOKEN, tokenFile?.refresh_token),
    accessToken: firstDefined(config.accessToken, process.env.GMAIL_ACCESS_TOKEN, tokenFile?.access_token),
    serviceAccountEmail: firstDefined(
      config.serviceAccountEmail,
      process.env.GMAIL_SERVICE_ACCOUNT_EMAIL,
      serviceAccount.client_email
    ),
    serviceAccountPrivateKey: firstDefined(
      config.serviceAccountPrivateKey,
      process.env.GMAIL_SERVICE_ACCOUNT_PRIVATE_KEY,
      serviceAccount.private_key
    ),
    delegatedUser,
    scopes: normalizeScopes(firstDefined(config.scopes, process.env.GMAIL_SCOPES, DEFAULT_GMAIL_SCOPES)),
    user
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail API request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function getAccessToken(config = {}) {
  const credentials = await loadCredentials(config);

  if (credentials.serviceAccountEmail && credentials.serviceAccountPrivateKey) {
    const subject = credentials.delegatedUser || credentials.user;

    if (!subject || subject === "me") {
      throw new Error("Missing delegated Gmail user for service account access.");
    }

    return getServiceAccountAccessToken({
      ...credentials,
      subject
    });
  }

  if (credentials.accessToken && !credentials.refreshToken) {
    return {
      accessToken: credentials.accessToken,
      user: credentials.user
    };
  }

  if (!credentials.clientId || !credentials.refreshToken) {
    throw new Error("Missing Gmail OAuth credentials. Provide client id and refresh token.");
  }

  const body = new URLSearchParams({
    client_id: credentials.clientId,
    refresh_token: credentials.refreshToken,
    grant_type: "refresh_token"
  });

  // Installed desktop clients can refresh tokens without a client secret.
  if (credentials.clientSecret) {
    body.set("client_secret", credentials.clientSecret);
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
    throw new Error(`Failed to refresh Gmail access token: ${errorText}`);
  }

  const payload = await response.json();

  return {
    accessToken: payload.access_token,
    user: credentials.user
  };
}

function serviceAccountAssertion({
  serviceAccountEmail = "",
  serviceAccountPrivateKey = "",
  subject = "",
  scopes = DEFAULT_GMAIL_SCOPES,
  now = Math.floor(Date.now() / 1000)
} = {}) {
  const header = {
    alg: "RS256",
    typ: "JWT"
  };
  const claims = {
    iss: serviceAccountEmail,
    scope: normalizeScopes(scopes).join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
    sub: subject
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccountPrivateKey, "base64url");
  return `${unsigned}.${signature}`;
}

async function getServiceAccountAccessToken(credentials = {}) {
  const assertion = serviceAccountAssertion(credentials);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get delegated Gmail access token: ${errorText}`);
  }

  const payload = await response.json();

  return {
    accessToken: payload.access_token,
    user: credentials.subject
  };
}

async function gmailRequest(endpoint, { method = "GET", query = {}, body, config } = {}) {
  const { accessToken, user } = await getAccessToken(config);
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}/${endpoint}`);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return fetchJson(url, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

function parseDate(value = "") {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function gmailSearchDate(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

function gmailDateQuery({ hours = 24, since = "", until = "" } = {}) {
  const sinceDate = parseDate(since) ?? new Date(Date.now() - hours * 60 * 60 * 1000);
  const untilDate = parseDate(until);
  const parts = [`after:${gmailSearchDate(sinceDate)}`];

  if (untilDate) {
    const before = new Date(untilDate);
    before.setUTCDate(before.getUTCDate() + 1);
    parts.push(`before:${gmailSearchDate(before)}`);
  }

  return parts.join(" ");
}

function messageInRange(message = {}, { since = "", until = "" } = {}) {
  const timestamp = Number(message.internalDate || 0);
  const sinceDate = parseDate(since);
  const untilDate = parseDate(until);

  if (!timestamp) {
    return true;
  }

  if (sinceDate && timestamp < sinceDate.getTime()) {
    return false;
  }

  if (untilDate && timestamp > untilDate.getTime()) {
    return false;
  }

  return true;
}

export async function fetchRecentThreads({
  hours = 24,
  maxMessages = 200,
  since = "",
  until = "",
  query = "",
  config
} = {}) {
  const range = { since, until };
  const q = [gmailDateQuery({ hours, since, until }), query].filter(Boolean).join(" ");
  const messageList = await gmailRequest("messages", {
    query: {
      maxResults: maxMessages,
      q
    },
    config
  });

  const threadIds = [...new Set((messageList.messages ?? []).map((message) => message.threadId).filter(Boolean))];
  const threads = [];

  for (const threadId of threadIds) {
    const thread = await gmailRequest(`threads/${threadId}`, {
      query: {
        format: "full"
      },
      config
    });
    if (!since && !until) {
      threads.push(thread);
      continue;
    }

    if ((thread.messages ?? []).some((message) => messageInRange(message, range))) {
      threads.push(thread);
    }
  }

  return threads;
}

export function buildMimeEmail({
  to,
  subject,
  body = "",
  html = "",
  attachments = [],
  boundary = `clearedge-${Date.now()}-${Math.random().toString(16).slice(2)}`
} = {}) {
  const safeTo = escapeHeader(to);
  const safeSubject = escapeHeader(subject);
  const normalizedAttachments = Array.isArray(attachments) ? attachments.filter(Boolean) : [];

  if (!normalizedAttachments.length) {
    const contentType = html ? "text/html" : "text/plain";

    return [
      `To: ${safeTo}`,
      `Subject: ${safeSubject}`,
      "MIME-Version: 1.0",
      `Content-Type: ${contentType}; charset=UTF-8`,
      "",
      html || body
    ].join("\n");
  }

  const lines = [
    `To: ${safeTo}`,
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: ${html ? "text/html" : "text/plain"}; charset=UTF-8`,
    "Content-Transfer-Encoding: 8bit",
    "",
    html || body
  ];

  for (const attachment of normalizedAttachments) {
    const filename = quoteHeaderValue(attachment.filename || attachment.name || "attachment");
    const mimeType = escapeHeader(attachment.mimeType || attachment.contentType || "application/octet-stream");

    lines.push(
      `--${boundary}`,
      `Content-Type: ${mimeType}; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      foldBase64(attachmentBodyToBase64(attachment))
    );
  }

  lines.push(`--${boundary}--`, "");

  return lines.join("\n");
}

export async function sendEmail({ to, subject, body = "", html = "", config }) {
  const mime = buildMimeEmail({ to, subject, body, html });

  return gmailRequest("messages/send", {
    method: "POST",
    body: {
      raw: base64UrlEncode(mime)
    },
    config
  });
}

export async function sendEmailWithAttachments({ to, subject, body = "", html = "", attachments = [], config }) {
  const mime = buildMimeEmail({ to, subject, body, html, attachments });

  return gmailRequest("messages/send", {
    method: "POST",
    body: {
      raw: base64UrlEncode(mime)
    },
    config
  });
}

export async function fetchGmailAttachmentData({ messageId = "", attachmentId = "", config } = {}) {
  if (!messageId || !attachmentId) {
    throw new Error("Missing Gmail message id or attachment id.");
  }

  return gmailRequest(`messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, {
    config
  });
}

export async function trashGmailThread({ threadId = "", config } = {}) {
  if (!threadId) {
    throw new Error("Missing Gmail thread id.");
  }

  return gmailRequest(`threads/${encodeURIComponent(threadId)}/trash`, {
    method: "POST",
    config
  });
}

export async function getProfile({ config } = {}) {
  return gmailRequest("profile", { config });
}

export function resolvePathFromProject(projectRoot, relativePath = "") {
  return path.resolve(projectRoot, relativePath);
}
