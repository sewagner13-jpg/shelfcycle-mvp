import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const APPLE_EPOCH_UNIX_SECONDS = 978307200;

function findSqlite3() {
  const candidates = ["/usr/bin/sqlite3", "/usr/local/bin/sqlite3", "/opt/homebrew/bin/sqlite3"];
  for (const p of candidates) {
    try {
      execFileSync(p, ["--version"], { stdio: "ignore" });
      return p;
    } catch {
      // not found here
    }
  }
  try {
    const result = execFileSync("which", ["sqlite3"], { encoding: "utf8" }).trim();
    if (result) return result;
  } catch {
    // not in PATH
  }
  return null;
}

export const SQLITE3_PATH = findSqlite3();
const NANOSECOND_THRESHOLD = 1_000_000_000_000;

function base64UrlEncode(value = "") {
  return Buffer.from(String(value), "utf8").toString("base64url");
}

function compactWhitespace(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function escapeSqlLiteral(value = "") {
  return String(value).replace(/'/g, "''");
}

export function appleMessagesDateToUnixMs(value) {
  const numeric = Number(value ?? 0);

  if (!numeric) {
    return 0;
  }

  if (Math.abs(numeric) > NANOSECOND_THRESHOLD) {
    return Math.round(numeric / 1_000_000_000 + APPLE_EPOCH_UNIX_SECONDS) * 1000;
  }

  return Math.round(numeric + APPLE_EPOCH_UNIX_SECONDS) * 1000;
}

function unixMsToAppleSeconds(unixMs = 0) {
  return Math.floor(unixMs / 1000) - APPLE_EPOCH_UNIX_SECONDS;
}

function unixMsToAppleNanos(unixMs = 0) {
  return unixMsToAppleSeconds(unixMs) * 1_000_000_000;
}

export function buildMessagesSql({ cutoffUnixMs = 0, maxThreads = 120 } = {}) {
  const cutoffAppleSeconds = unixMsToAppleSeconds(cutoffUnixMs);
  const cutoffAppleNanos = unixMsToAppleNanos(cutoffUnixMs);
  const limit = Number.isFinite(maxThreads) ? Math.max(1, Math.min(maxThreads, 500)) : 120;

  return `
WITH recent_messages AS (
  SELECT
    chat.ROWID AS chat_rowid,
    chat.guid AS chat_guid,
    COALESCE(NULLIF(chat.chat_identifier, ''), chat.guid) AS chat_identifier,
    chat.service_name AS service_name,
    message.ROWID AS message_rowid,
    message.guid AS message_guid,
    message.handle_id AS message_handle_rowid,
    COALESCE(handle.id, '') AS sender_handle,
    COALESCE(NULLIF(message.text, ''), NULLIF(message.subject, ''), '') AS body_text,
    COALESCE(NULLIF(message.subject, ''), '') AS subject_text,
    message.is_from_me AS is_from_me,
    CASE WHEN message_attachment_join.message_id IS NULL THEN 0 ELSE 1 END AS has_attachment,
    message.date AS raw_date,
    CASE
      WHEN ABS(message.date) > ${NANOSECOND_THRESHOLD}
        THEN CAST(ROUND((message.date / 1000000000.0 + ${APPLE_EPOCH_UNIX_SECONDS}) * 1000) AS INTEGER)
      ELSE CAST(ROUND((message.date + ${APPLE_EPOCH_UNIX_SECONDS}) * 1000) AS INTEGER)
    END AS unix_ms
  FROM message
  JOIN chat_message_join ON chat_message_join.message_id = message.ROWID
  JOIN chat ON chat.ROWID = chat_message_join.chat_id
  LEFT JOIN handle ON handle.ROWID = message.handle_id
  LEFT JOIN message_attachment_join ON message_attachment_join.message_id = message.ROWID
  WHERE (
    (ABS(message.date) > ${NANOSECOND_THRESHOLD} AND message.date >= ${cutoffAppleNanos})
    OR
    (ABS(message.date) <= ${NANOSECOND_THRESHOLD} AND message.date >= ${cutoffAppleSeconds})
  )
),
recent_chats AS (
  SELECT chat_rowid, MAX(unix_ms) AS last_unix_ms
  FROM recent_messages
  GROUP BY chat_rowid
  ORDER BY last_unix_ms DESC
  LIMIT ${limit}
)
SELECT
  recent_messages.chat_rowid,
  recent_messages.chat_guid,
  recent_messages.chat_identifier,
  recent_messages.service_name,
  recent_messages.message_rowid,
  recent_messages.message_guid,
  recent_messages.message_handle_rowid,
  recent_messages.sender_handle,
  recent_messages.body_text,
  recent_messages.subject_text,
  recent_messages.is_from_me,
  recent_messages.raw_date,
  recent_messages.unix_ms
FROM recent_messages
JOIN recent_chats ON recent_chats.chat_rowid = recent_messages.chat_rowid
ORDER BY recent_messages.chat_rowid, recent_messages.unix_ms ASC;
`;
}

export function buildParticipantsSql(chatRowIds = []) {
  if (!chatRowIds.length) {
    return "";
  }

  const ids = chatRowIds.map((value) => Number.parseInt(value, 10)).filter(Number.isFinite);

  if (!ids.length) {
    return "";
  }

  return `
SELECT
  chat_handle_join.chat_id AS chat_rowid,
  handle.id AS handle_value
FROM chat_handle_join
JOIN handle ON handle.ROWID = chat_handle_join.handle_id
WHERE chat_handle_join.chat_id IN (${ids.join(", ")})
ORDER BY chat_handle_join.chat_id, handle.id;
`;
}

function normalizeHandle(handle = "") {
  return compactWhitespace(String(handle).replace(/^tel:/i, "").replace(/^sms:/i, ""));
}

function displayNameForHandles(handles = []) {
  const values = handles.map((value) => normalizeHandle(value)).filter(Boolean);

  if (!values.length) {
    return "Unknown";
  }

  if (values.length === 1) {
    return values[0];
  }

  return values.slice(0, 3).join(", ");
}

function buildHeaders({ isFromMe = false, handle = "", participants = [], subject = "", internalName = "", internalEmail = "" } = {}) {
  const cleanHandle = normalizeHandle(handle);
  const cleanParticipants = participants.map((value) => normalizeHandle(value)).filter(Boolean);
  const from = isFromMe
    ? `${internalName} <${internalEmail}>`
    : cleanHandle || cleanParticipants[0] || "Unknown";
  const to = isFromMe
    ? cleanParticipants.join(", ") || "Unknown"
    : `${internalName} <${internalEmail}>`;
  const headers = [
    { name: "From", value: from },
    { name: "To", value: to }
  ];

  if (subject) {
    headers.push({ name: "Subject", value: subject });
  }

  return headers;
}

export function rowsToMessagesThreads({
  messageRows = [],
  participantRows = [],
  internalName = "Sean Wagner",
  internalEmail = "sean@clear-edge.net"
} = {}) {
  const participantMap = new Map();

  for (const row of participantRows) {
    const chatRowId = String(row.chat_rowid);

    if (!participantMap.has(chatRowId)) {
      participantMap.set(chatRowId, []);
    }

    participantMap.get(chatRowId).push(normalizeHandle(row.handle_value));
  }

  const threadMap = new Map();

  for (const row of messageRows) {
    const chatRowId = String(row.chat_rowid);
    const chatGuid = compactWhitespace(row.chat_guid || "");
    const threadId = chatGuid || `messages-chat-${chatRowId}`;
    const participants = participantMap.get(chatRowId) ?? [normalizeHandle(row.sender_handle)];
    const subjectBase = displayNameForHandles(participants);
    const subject = compactWhitespace(row.subject_text || "") || `Text thread with ${subjectBase}`;
    const text = compactWhitespace(row.body_text || "");

    if (!threadMap.has(threadId)) {
      threadMap.set(threadId, {
        id: threadId,
        source: "messages",
        serviceName: compactWhitespace(row.service_name || ""),
        chatGuid,
        chatIdentifier: compactWhitespace(row.chat_identifier || ""),
        participants,
        messageRecords: [],
        messages: []
      });
    }

    const thread = threadMap.get(threadId);
    const timestamp = Number(row.unix_ms || 0);
    const payloadBody = text || subject;

    thread.messages.push({
      id: compactWhitespace(row.message_guid || "") || `message-${row.message_rowid}`,
      threadId,
      labelIds: [],
      internalDate: String(timestamp),
      payload: {
        headers: buildHeaders({
          isFromMe: Number(row.is_from_me) === 1,
          handle: row.sender_handle,
          participants,
          subject,
          internalName,
          internalEmail
        }),
        body: {
          data: base64UrlEncode(payloadBody)
        }
      },
      snippet: payloadBody.slice(0, 240)
    });
    thread.messageRecords.push({
      messageId: Number(row.message_rowid || 0),
      guid: compactWhitespace(row.message_guid || ""),
      timestamp: timestamp,
      contact: normalizeHandle(row.sender_handle),
      service: compactWhitespace(row.service_name || ""),
      isFromMe: Number(row.is_from_me) === 1,
      text,
      chatIdentifier: compactWhitespace(row.chat_identifier || ""),
      hasAttachment: Number(row.has_attachment) === 1
    });
  }

  return [...threadMap.values()].filter((thread) => thread.messages.length);
}

async function copyIfExists(sourcePath, destinationPath) {
  try {
    await fs.copyFile(sourcePath, destinationPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function copyMessagesDatabase(dbPath) {
  const resolvedDbPath = path.resolve(dbPath);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clearedge-messages-"));
  const copiedDbPath = path.join(tempDir, path.basename(resolvedDbPath));

  try {
    await fs.copyFile(resolvedDbPath, copiedDbPath);
    await copyIfExists(`${resolvedDbPath}-wal`, `${copiedDbPath}-wal`);
    await copyIfExists(`${resolvedDbPath}-shm`, `${copiedDbPath}-shm`);
    return { tempDir, copiedDbPath };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });

    if (error?.code === "EPERM" || error?.code === "EACCES") {
      throw new Error(
        `Messages database access was denied at ${resolvedDbPath}. Grant Codex Full Disk Access or Files access for ~/Library/Messages, then retry.`
      );
    }

    throw error;
  }
}

async function runSqliteJsonQuery(dbPath, sql) {
  if (!sql) {
    return [];
  }

  if (!SQLITE3_PATH) {
    throw new Error("sqlite3 binary not found; Messages integration requires macOS with sqlite3 installed");
  }
  const { stdout } = await execFileAsync(SQLITE3_PATH, ["-json", dbPath, sql], {
    maxBuffer: 16 * 1024 * 1024
  });

  return JSON.parse(stdout || "[]");
}

export async function fetchRecentMessageThreads({
  hours = 24,
  maxThreads = 120,
  dbPath = path.join(os.homedir(), "Library", "Messages", "chat.db"),
  internalName = "Sean Wagner",
  internalEmail = "sean@clear-edge.net"
} = {}) {
  const cutoffUnixMs = Date.now() - hours * 60 * 60 * 1000;
  const { tempDir, copiedDbPath } = await copyMessagesDatabase(dbPath);

  try {
    const messageRows = await runSqliteJsonQuery(
      copiedDbPath,
      buildMessagesSql({ cutoffUnixMs, maxThreads })
    );
    const chatRowIds = [...new Set(messageRows.map((row) => row.chat_rowid).filter(Boolean))];
    const participantRows = await runSqliteJsonQuery(copiedDbPath, buildParticipantsSql(chatRowIds));

    return rowsToMessagesThreads({
      messageRows,
      participantRows,
      internalName,
      internalEmail
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
