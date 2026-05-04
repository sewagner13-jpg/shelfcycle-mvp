import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import {
  appleMessagesDateToUnixMs,
  buildMessagesSql,
  buildParticipantsSql,
  rowsToMessagesThreads,
  fetchRecentMessageThreads
} from "../src/lib/messages-client.mjs";

const execFile = promisify(execFileCallback);

test("appleMessagesDateToUnixMs converts both Apple seconds and Apple nanoseconds", () => {
  const secondsValue = 788_400_000;
  const nanosValue = secondsValue * 1_000_000_000;

  assert.equal(appleMessagesDateToUnixMs(secondsValue), 1_766_707_200_000);
  assert.equal(appleMessagesDateToUnixMs(nanosValue), 1_766_707_200_000);
});

test("buildMessagesSql includes dual-format Apple date filtering", () => {
  const sql = buildMessagesSql({
    cutoffUnixMs: 1_766_707_200_000,
    maxThreads: 25
  });

  assert.ok(sql.includes("ABS(message.date) > 1000000000000"));
  assert.ok(sql.includes("LIMIT 25"));
});

test("buildParticipantsSql targets the requested chats", () => {
  const sql = buildParticipantsSql([3, 9, 12]);

  assert.ok(sql.includes("IN (3, 9, 12)"));
});

test("rowsToMessagesThreads normalizes Messages rows into thread objects", () => {
  const threads = rowsToMessagesThreads({
    internalName: "Sean Wagner",
    internalEmail: "sean@clear-edge.net",
    participantRows: [
      { chat_rowid: 1, handle_value: "+17329836870" }
    ],
    messageRows: [
      {
        chat_rowid: 1,
        chat_guid: "iMessage;-;+17329836870",
        chat_identifier: "+17329836870",
        service_name: "iMessage",
        message_rowid: 100,
        message_guid: "A1",
        sender_handle: "+17329836870",
        body_text: "Can you confirm pickup Friday morning?",
        subject_text: "",
        is_from_me: 0,
        unix_ms: 1_767_072_000_000
      },
      {
        chat_rowid: 1,
        chat_guid: "iMessage;-;+17329836870",
        chat_identifier: "+17329836870",
        service_name: "iMessage",
        message_rowid: 101,
        message_guid: "A2",
        sender_handle: "+17329836870",
        body_text: "Yes, Friday morning works.",
        subject_text: "",
        is_from_me: 1,
        unix_ms: 1_767_075_600_000
      }
    ]
  });

  assert.equal(threads.length, 1);
  assert.equal(threads[0].source, "messages");
  assert.equal(threads[0].messages.length, 2);
  assert.equal(threads[0].messages[0].payload.headers[0].value, "+17329836870");
  assert.equal(threads[0].messages[1].payload.headers[0].value, "Sean Wagner <sean@clear-edge.net>");
});

test("fetchRecentMessageThreads reads a simplified Messages-style sqlite database", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "messages-db-test-"));
  const dbPath = path.join(tempDir, "chat.db");
  const appleEpochSeconds = 978307200;
  const nowAppleNanos = BigInt(Math.floor(Date.now() / 1000 - appleEpochSeconds)) * 1000000000n;
  const earlierAppleNanos = nowAppleNanos - 3600n * 1000000000n;
  const sql = `
CREATE TABLE message (
  ROWID INTEGER PRIMARY KEY,
  guid TEXT,
  text TEXT,
  subject TEXT,
  service TEXT,
  handle_id INTEGER,
  is_from_me INTEGER,
  date INTEGER
);
CREATE TABLE handle (
  ROWID INTEGER PRIMARY KEY,
  id TEXT
);
CREATE TABLE chat (
  ROWID INTEGER PRIMARY KEY,
  guid TEXT,
  chat_identifier TEXT,
  service_name TEXT
);
CREATE TABLE chat_message_join (
  chat_id INTEGER,
  message_id INTEGER
);
CREATE TABLE chat_handle_join (
  chat_id INTEGER,
  handle_id INTEGER
);
CREATE TABLE message_attachment_join (
  message_id INTEGER
);
INSERT INTO handle (ROWID, id) VALUES (1, '+17329836870');
INSERT INTO chat (ROWID, guid, chat_identifier, service_name) VALUES (1, 'iMessage;-;+17329836870', '+17329836870', 'iMessage');
INSERT INTO message (ROWID, guid, text, subject, service, handle_id, is_from_me, date)
VALUES
  (100, 'A1', 'Need SDS and pricing on benzyl alcohol.', '', 'iMessage', 1, 0, ${earlierAppleNanos}),
  (101, 'A2', 'I will send the SDS and confirm pricing.', '', 'iMessage', 1, 1, ${nowAppleNanos});
INSERT INTO chat_message_join (chat_id, message_id) VALUES (1, 100), (1, 101);
INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (1, 1);
INSERT INTO message_attachment_join (message_id) VALUES (100);
`;

  try {
    await execFile("/usr/bin/sqlite3", [dbPath, sql]);
    const threads = await fetchRecentMessageThreads({
      dbPath,
      hours: 72,
      maxThreads: 10,
      internalName: "Sean Wagner",
      internalEmail: "sean@clear-edge.net"
    });

    assert.equal(threads.length, 1);
    assert.equal(threads[0].messageRecords.length, 2);
    assert.equal(threads[0].messageRecords[0].contact, "+17329836870");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
