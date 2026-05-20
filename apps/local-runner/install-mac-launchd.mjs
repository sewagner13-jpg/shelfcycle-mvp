import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const localDir = path.join(projectRoot, ".local", "local-runner");
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const defaultLabel = "com.clearedge.shelfcycle-mvp.local-runner";
const defaultPort = 4318;

function parseArgs(argv = []) {
  const args = {
    label: defaultLabel,
    port: defaultPort,
    load: true,
    restart: false,
    status: false,
    unload: false,
    uninstall: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--label") {
      args.label = argv[index + 1] || args.label;
      index += 1;
      continue;
    }

    if (value === "--port") {
      args.port = Number.parseInt(argv[index + 1], 10) || args.port;
      index += 1;
      continue;
    }

    if (value === "--no-load") {
      args.load = false;
      continue;
    }

    if (value === "--restart") {
      args.restart = true;
      args.load = true;
      continue;
    }

    if (value === "--status") {
      args.status = true;
      args.load = false;
      continue;
    }

    if (value === "--unload") {
      args.unload = true;
      args.load = false;
      continue;
    }

    if (value === "--uninstall") {
      args.uninstall = true;
      args.load = false;
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

function plistEnvironment(values = {}) {
  return [
    "<dict>",
    ...Object.entries(values).flatMap(([key, value]) => [
      `  <key>${xmlEscape(key)}</key>`,
      `  <string>${xmlEscape(value)}</string>`
    ]),
    "</dict>"
  ].join("\n");
}

export function buildLocalRunnerPlist({
  label = defaultLabel,
  nodePath = process.execPath,
  serverPath = path.join(projectRoot, "server.mjs"),
  workingDirectory = projectRoot,
  port = defaultPort,
  stdoutPath = path.join(localDir, "launchd.out.log"),
  stderrPath = path.join(localDir, "launchd.err.log")
} = {}) {
  const args = [
    nodePath,
    serverPath
  ];

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
  <key>EnvironmentVariables</key>
  ${plistEnvironment({
    PORT: String(port),
    SHELFCYCLE_LOCAL_RUNNER: "1",
    PATH: `${path.dirname(nodePath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`
  }).split("\n").join("\n  ")}
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
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

async function run(command, args = [], { inherit = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    if (!inherit) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(`${command} ${args.join(" ")} exited with code ${code}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function runLaunchctl(args = [], options = {}) {
  return await run("/bin/launchctl", args, options);
}

async function healthCheck(port = defaultPort) {
  try {
    const response = await fetch(`http://localhost:${port}/health`, {
      cache: "no-store"
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text()
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : String(error)
    };
  }
}

async function printStatus({ label, plistPath, port }) {
  const guiUser = `gui/${process.getuid()}`;
  const printResult = await runLaunchctl(["print", `${guiUser}/${label}`], { inherit: false })
    .then((result) => ({ ok: true, detail: result.stdout }))
    .catch((error) => ({ ok: false, detail: error.stderr || error.message }));
  const health = await healthCheck(port);

  console.log(JSON.stringify({
    ok: printResult.ok && health.ok,
    label,
    plistPath,
    launchdLoaded: printResult.ok,
    health
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plistPath = path.join(launchAgentsDir, `${args.label}.plist`);
  const guiUser = `gui/${process.getuid()}`;
  const guiTarget = `${guiUser}/${args.label}`;

  if (args.status) {
    await printStatus({ label: args.label, plistPath, port: args.port });
    return;
  }

  if (args.unload) {
    await runLaunchctl(["bootout", guiUser, plistPath]).catch(() => {});
    console.log(`LaunchAgent unloaded: ${args.label}`);
    return;
  }

  if (args.uninstall) {
    await runLaunchctl(["bootout", guiUser, plistPath]).catch(() => {});
    await rm(plistPath, { force: true });
    console.log(`LaunchAgent removed: ${plistPath}`);
    return;
  }

  await mkdir(launchAgentsDir, { recursive: true });
  await mkdir(localDir, { recursive: true });

  if (!await fileExists(path.join(projectRoot, "server.mjs"))) {
    throw new Error(`Could not find server.mjs in ${projectRoot}`);
  }

  await writeFile(plistPath, buildLocalRunnerPlist({
    label: args.label,
    port: args.port
  }), "utf8");

  if (args.load || args.restart) {
    await runLaunchctl(["bootout", guiUser, plistPath]).catch(() => {});
    await runLaunchctl(["bootstrap", guiUser, plistPath]);
    await runLaunchctl(["enable", guiTarget]).catch(() => {});
    await runLaunchctl(["kickstart", "-k", guiTarget]).catch(() => {});
  }

  console.log(JSON.stringify({
    ok: true,
    label: args.label,
    loaded: args.load || args.restart,
    keepAlive: true,
    runAtLoad: true,
    port: args.port,
    plistPath,
    logs: {
      stdout: path.join(localDir, "launchd.out.log"),
      stderr: path.join(localDir, "launchd.err.log")
    }
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
