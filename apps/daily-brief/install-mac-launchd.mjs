import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const localDir = path.join(projectRoot, ".local");
const defaultBundlePath = path.join(localDir, "clearedge-knowledge-local.json");
const defaultSettingsPath = path.join(localDir, "hosted-brief-settings.local.json");
const defaultMessagesConfigPath = path.join(localDir, "messages-memory-config.local.json");
const defaultSettingsCandidate = "/private/tmp/clearedge-hosted-settings.json";
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const defaultLabel = "com.clearedge.daily-brief-local";

function parseArgs(argv = []) {
  const args = {
    label: defaultLabel,
    bundle: defaultBundlePath,
    settings: defaultSettingsPath,
    sourceSettings: "",
    messagesMemoryConfig: defaultMessagesConfigPath,
    hour: 7,
    minute: 0,
    maxMessages: "",
    maxMessageThreads: "",
    dryRun: false,
    uninstall: false,
    load: false,
    unload: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--label") {
      args.label = argv[index + 1];
      index += 1;
      continue;
    }

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

    if (value === "--source-settings") {
      args.sourceSettings = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--messages-memory-config") {
      args.messagesMemoryConfig = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--hour") {
      args.hour = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (value === "--minute") {
      args.minute = Number.parseInt(argv[index + 1], 10);
      index += 1;
      continue;
    }

    if (value === "--max-messages") {
      args.maxMessages = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--max-message-threads") {
      args.maxMessageThreads = argv[index + 1];
      index += 1;
      continue;
    }

    if (value === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (value === "--load") {
      args.load = true;
      continue;
    }

    if (value === "--unload") {
      args.unload = true;
      continue;
    }

    if (value === "--uninstall") {
      args.uninstall = true;
    }
  }

  return args;
}

function xmlEscape(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function plistArray(items = []) {
  return [
    "<array>",
    ...items.map((item) => `  <string>${xmlEscape(item)}</string>`),
    "</array>"
  ].join("\n");
}

export function buildLaunchdPlist({
  label = defaultLabel,
  nodePath = process.execPath,
  runnerPath = path.join(projectRoot, "apps", "daily-brief", "run-local-scheduled.mjs"),
  workingDirectory = projectRoot,
  bundle,
  settings,
  messagesMemoryConfig,
  hour = 7,
  minute = 0,
  maxMessages = "",
  maxMessageThreads = "",
  dryRun = false,
  stdoutPath = path.join(localDir, "daily-brief-runs", "launchd.out.log"),
  stderrPath = path.join(localDir, "daily-brief-runs", "launchd.err.log")
} = {}) {
  const args = [
    nodePath,
    runnerPath,
    "--bundle",
    path.resolve(bundle),
    "--settings",
    path.resolve(settings),
    "--messages-memory-config",
    path.resolve(messagesMemoryConfig)
  ];

  if (maxMessages) {
    args.push("--max-messages", String(maxMessages));
  }

  if (maxMessageThreads) {
    args.push("--max-message-threads", String(maxMessageThreads));
  }

  if (dryRun) {
    args.push("--dry-run");
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  ${plistArray(args).split("\n").join("\n  ")}
  <key>WorkingDirectory</key>
  <string>${xmlEscape(workingDirectory)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${Number.parseInt(hour, 10)}</integer>
    <key>Minute</key>
    <integer>${Number.parseInt(minute, 10)}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

async function fileExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runLaunchctl(args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/launchctl", args, {
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`launchctl ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function ensureStableSettings(args) {
  const target = path.resolve(args.settings);

  if (await fileExists(target)) {
    return target;
  }

  const source = args.sourceSettings || ((await fileExists(defaultSettingsCandidate)) ? defaultSettingsCandidate : "");

  if (!source) {
    throw new Error(
      `Missing Gmail settings at ${target}. Provide --source-settings /path/to/settings.json or create the settings file first.`
    );
  }

  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.resolve(source), target);
  return target;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plistPath = path.join(launchAgentsDir, `${args.label}.plist`);
  const guiTarget = `gui/${process.getuid()}/${args.label}`;

  if (args.unload) {
    await runLaunchctl(["bootout", `gui/${process.getuid()}`, plistPath]).catch(() => {});
    console.log(`LaunchAgent unloaded: ${args.label}`);
  }

  if (args.uninstall) {
    await runLaunchctl(["bootout", `gui/${process.getuid()}`, plistPath]).catch(() => {});
    await rm(plistPath, { force: true });
    console.log(`LaunchAgent removed: ${plistPath}`);
    return;
  }

  const settings = await ensureStableSettings(args);

  await mkdir(launchAgentsDir, { recursive: true });
  await mkdir(path.join(localDir, "daily-brief-runs"), { recursive: true });

  const plist = buildLaunchdPlist({
    label: args.label,
    bundle: args.bundle,
    settings,
    messagesMemoryConfig: args.messagesMemoryConfig,
    hour: args.hour,
    minute: args.minute,
    maxMessages: args.maxMessages,
    maxMessageThreads: args.maxMessageThreads,
    dryRun: args.dryRun
  });

  await writeFile(plistPath, plist, "utf8");

  if (args.load) {
    await runLaunchctl(["bootout", `gui/${process.getuid()}`, plistPath]).catch(() => {});
    await runLaunchctl(["bootstrap", `gui/${process.getuid()}`, plistPath]);
    await runLaunchctl(["enable", guiTarget]).catch(() => {});
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        label: args.label,
        loaded: args.load,
        dryRun: args.dryRun,
        schedule: `${String(args.hour).padStart(2, "0")}:${String(args.minute).padStart(2, "0")}`,
        plistPath,
        bundle: path.resolve(args.bundle),
        settings,
        messagesMemoryConfig: path.resolve(args.messagesMemoryConfig)
      },
      null,
      2
    )
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
