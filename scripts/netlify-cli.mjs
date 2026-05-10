import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const toolingRoot = path.join(projectRoot, ".tooling");
const npmRoot = path.join(toolingRoot, "npm");
const cliRoot = path.join(toolingRoot, "netlify-cli");
const npmPackageDir = path.join(npmRoot, "package");
const DEFAULT_DEPLOY_DIR = "public";
const DEFAULT_FUNCTIONS_DIR = "netlify/functions";

function log(message) {
  process.stderr.write(`${message}\n`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await pipeline(response.body, createWriteStream(destinationPath));
}

async function ensureNpmCli() {
  const npmCliPath = path.join(npmPackageDir, "bin", "npm-cli.js");

  if (await fileExists(npmCliPath)) {
    return npmCliPath;
  }

  log("Bootstrapping local npm CLI...");
  await fs.mkdir(npmRoot, { recursive: true });

  const metadata = await fetchJson("https://registry.npmjs.org/npm/latest");
  const tarballUrl = metadata?.dist?.tarball;

  if (!tarballUrl) {
    throw new Error("Could not resolve npm tarball URL.");
  }

  const archivePath = path.join(npmRoot, "npm.tgz");
  await downloadFile(tarballUrl, archivePath);
  await fs.rm(npmPackageDir, { recursive: true, force: true });
  await run("tar", ["-xzf", archivePath, "-C", npmRoot]);
  await fs.rm(archivePath, { force: true });

  if (!(await fileExists(npmCliPath))) {
    throw new Error("npm bootstrap completed, but npm-cli.js was not found.");
  }

  return npmCliPath;
}

async function ensureNetlifyCli() {
  const npmCliPath = await ensureNpmCli();
  const packageJsonPath = path.join(cliRoot, "package.json");
  const netlifyPackageJsonPath = path.join(cliRoot, "node_modules", "netlify-cli", "package.json");

  if (!(await fileExists(packageJsonPath))) {
    await fs.mkdir(cliRoot, { recursive: true });
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify(
        {
          name: "local-netlify-cli",
          private: true
        },
        null,
        2
      )
    );
  }

  if (!(await fileExists(netlifyPackageJsonPath))) {
    log("Installing local netlify-cli...");
    await run(process.execPath, [npmCliPath, "install", "--prefix", cliRoot, "netlify-cli@latest"]);
  }

  const netlifyPackage = JSON.parse(await fs.readFile(netlifyPackageJsonPath, "utf8"));
  const binEntry =
    typeof netlifyPackage.bin === "string"
      ? netlifyPackage.bin
      : netlifyPackage.bin?.netlify;

  if (!binEntry) {
    throw new Error("Could not resolve netlify-cli bin entry.");
  }

  return path.join(cliRoot, "node_modules", "netlify-cli", binEntry);
}

function hasArg(args, name) {
  return args.includes(name) || args.some((arg) => arg.startsWith(`${name}=`));
}

function normalizeArgs(args = []) {
  if (args[0] !== "deploy") {
    return args;
  }

  const useBuild = hasArg(args, "--use-build") || process.env.CLEAREDGE_NETLIFY_USE_BUILD === "1";
  const nextArgs = args.filter((arg) => arg !== "--use-build");
  const isHelp = hasArg(nextArgs, "--help") || hasArg(nextArgs, "-h");
  const isTriggerOnly = hasArg(nextArgs, "--trigger");

  if (useBuild || isHelp || isTriggerOnly) {
    return nextArgs;
  }

  const normalized = [...nextArgs];

  if (!hasArg(normalized, "--no-build")) {
    normalized.push("--no-build");
  }

  if (!hasArg(normalized, "--dir") && !hasArg(normalized, "-d")) {
    normalized.push("--dir", DEFAULT_DEPLOY_DIR);
  }

  if (!hasArg(normalized, "--functions") && !hasArg(normalized, "-f")) {
    normalized.push("--functions", DEFAULT_FUNCTIONS_DIR);
  }

  log(`Using ClearEdge static deploy defaults: --no-build --dir ${DEFAULT_DEPLOY_DIR} --functions ${DEFAULT_FUNCTIONS_DIR}`);
  log("Pass --use-build or set CLEAREDGE_NETLIFY_USE_BUILD=1 only when a Netlify Build run is intentionally required.");

  return normalized;
}

async function main() {
  const cliEntry = await ensureNetlifyCli();
  const args = normalizeArgs(process.argv.slice(2));

  if (!args.length) {
    log("Usage: node scripts/netlify-cli.mjs <netlify args...>");
  }

  if (!process.env.NETLIFY_AUTH_TOKEN) {
    log("NETLIFY_AUTH_TOKEN is not set. Interactive login may be required for some commands.");
  }

  await run(process.execPath, [cliEntry, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env
    }
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
