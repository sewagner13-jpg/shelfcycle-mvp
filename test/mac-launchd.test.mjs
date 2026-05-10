import test from "node:test";
import assert from "node:assert/strict";

import { buildLaunchdPlist } from "../apps/daily-brief/install-mac-launchd.mjs";

test("buildLaunchdPlist creates a daily local Messages-first brief job", () => {
  const plist = buildLaunchdPlist({
    label: "com.clearedge.test",
    nodePath: "/usr/local/bin/node",
    runnerPath: "/project/apps/daily-brief/run-local-scheduled.mjs",
    workingDirectory: "/project",
    bundle: "/project/.local/clearedge-knowledge-local.json",
    settings: "/project/.local/hosted-brief-settings.local.json",
    messagesMemoryConfig: "/project/.local/messages-memory-config.local.json",
    hour: 7,
    minute: 15,
    maxMessages: 100,
    maxMessageThreads: 80,
    dryRun: false,
    stdoutPath: "/project/.local/daily-brief-runs/launchd.out.log",
    stderrPath: "/project/.local/daily-brief-runs/launchd.err.log"
  });

  assert.ok(plist.includes("<string>com.clearedge.test</string>"));
  assert.ok(plist.includes("<string>/project/apps/daily-brief/run-local-scheduled.mjs</string>"));
  assert.ok(plist.includes("<string>--messages-memory-config</string>"));
  assert.ok(plist.includes("<string>/project/.local/messages-memory-config.local.json</string>"));
  assert.ok(plist.includes("<key>Hour</key>"));
  assert.ok(plist.includes("<integer>7</integer>"));
  assert.ok(plist.includes("<key>Minute</key>"));
  assert.ok(plist.includes("<integer>15</integer>"));
  assert.ok(!plist.includes("--dry-run"));
});

test("buildLaunchdPlist can install a dry-run job for safe testing", () => {
  const plist = buildLaunchdPlist({
    label: "com.clearedge.test-dry",
    nodePath: "/usr/local/bin/node",
    runnerPath: "/project/apps/daily-brief/run-local-scheduled.mjs",
    workingDirectory: "/project",
    bundle: "/project/.local/clearedge-knowledge-local.json",
    settings: "/project/.local/hosted-brief-settings.local.json",
    messagesMemoryConfig: "/project/.local/messages-memory-config.local.json",
    dryRun: true
  });

  assert.ok(plist.includes("<string>--dry-run</string>"));
});

test("buildLaunchdPlist defaults the daily brief to 3 AM ET", () => {
  const plist = buildLaunchdPlist({
    label: "com.clearedge.test-default",
    nodePath: "/usr/local/bin/node",
    runnerPath: "/project/apps/daily-brief/run-local-scheduled.mjs",
    workingDirectory: "/project",
    bundle: "/project/.local/clearedge-knowledge-local.json",
    settings: "/project/.local/hosted-brief-settings.local.json",
    messagesMemoryConfig: "/project/.local/messages-memory-config.local.json"
  });

  assert.ok(plist.includes("<key>Hour</key>"));
  assert.ok(plist.includes("<integer>3</integer>"));
  assert.ok(plist.includes("<key>Minute</key>"));
  assert.ok(plist.includes("<integer>0</integer>"));
});
