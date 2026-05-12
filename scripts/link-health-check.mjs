import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const latestPreviewPath = path.join(projectRoot, ".local", "daily-brief-runs", "latest-brief-preview.json");

function parseArgs(argv = []) {
  const args = {
    localBase: "http://localhost:4318",
    hostedBase: "https://clearedge-daily-brief.netlify.app",
    includeExternal: false,
    timeoutMs: 10000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--local-base") {
      args.localBase = argv[index + 1] || args.localBase;
      index += 1;
      continue;
    }

    if (value === "--hosted-base") {
      args.hostedBase = argv[index + 1] || args.hostedBase;
      index += 1;
      continue;
    }

    if (value === "--include-external") {
      args.includeExternal = true;
      continue;
    }

    if (value === "--timeout-ms") {
      args.timeoutMs = Number.parseInt(argv[index + 1], 10) || args.timeoutMs;
      index += 1;
    }
  }

  return args;
}

function cleanBaseUrl(value = "") {
  return String(value || "").replace(/\/+$/, "");
}

async function readJsonIfPresent(filePath = "") {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readLatestBriefHtml() {
  const summary = await readJsonIfPresent(latestPreviewPath);
  const briefPath = summary?.briefPath || "";

  if (!briefPath) {
    return {
      summary,
      briefHtml: ""
    };
  }

  try {
    return {
      summary,
      briefHtml: await readFile(briefPath, "utf8")
    };
  } catch {
    return {
      summary,
      briefHtml: ""
    };
  }
}

function extractLinks(html = "") {
  const links = [];

  for (const match of html.matchAll(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    links.push({
      label: match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      href: match[1].replace(/&amp;/g, "&")
    });
  }

  return links;
}

async function checkUrl(url, { expected = [200], timeoutMs = 10000 } = {}) {
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const ok = expected.includes(response.status) || (response.status >= 300 && response.status < 400 && expected.includes(302));

    return {
      ok,
      url,
      status: response.status,
      elapsedMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      url,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt
    };
  }
}

function uniqueByUrl(items = []) {
  const seen = new Set();

  return items.filter((item) => {
    if (seen.has(item.url)) {
      return false;
    }

    seen.add(item.url);
    return true;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const localBase = cleanBaseUrl(args.localBase);
  const hostedBase = cleanBaseUrl(args.hostedBase);
  const { summary, briefHtml } = await readLatestBriefHtml();
  const briefLinks = extractLinks(briefHtml);
  const localRoutes = [
    "/",
    "/briefs.html",
    "/business-card.html",
    "/product-intake.html",
    "/review-action.html",
    "/review-submit.html",
    "/settings.html",
    "/health",
    "/api/daily-brief/status"
  ].map((route) => ({ url: `${localBase}${route}`, expected: [200] }));
  const hostedRoutes = [
    "/",
    "/briefs.html",
    "/business-card.html",
    "/product-intake.html",
    "/review-action.html",
    "/review-submit.html",
    "/settings.html",
    "/api/business-card/status"
  ].map((route) => ({ url: `${hostedBase}${route}`, expected: [200] }));
  hostedRoutes.push({
    url: `${hostedBase}/api/latest-brief`,
    expected: [200, 401]
  });
  const removedRoutes = [
    "/finance-actions.html",
    "/finance-match.html",
    "/chatgpt-build-review.html",
    "/api/finance-actions",
    "/api/finance-match/analyze"
  ].map((route) => ({ url: `${hostedBase}${route}`, expected: [404] }));
  const internalBriefLinks = briefLinks
    .map((link) => ({ ...link, url: link.href }))
    .filter((link) => link.href.startsWith(localBase) || link.href.startsWith(hostedBase))
    .map((link) => ({ url: link.href, expected: [200, 302] }));
  const externalBriefLinks = args.includeExternal
    ? briefLinks
      .map((link) => ({ ...link, url: link.href }))
      .filter((link) => /^https?:\/\//i.test(link.href) && !link.href.startsWith(localBase) && !link.href.startsWith(hostedBase))
      .map((link) => ({ url: link.href, expected: [200, 302, 303, 307, 308, 401, 403] }))
    : [];
  const targets = uniqueByUrl([
    ...localRoutes,
    ...hostedRoutes,
    ...removedRoutes,
    ...internalBriefLinks,
    ...externalBriefLinks
  ]);
  const checks = [];

  for (const target of targets) {
    checks.push(await checkUrl(target.url, {
      expected: target.expected,
      timeoutMs: args.timeoutMs
    }));
  }

  const localhostBriefLinks = briefLinks.filter((link) => /https?:\/\/(?:localhost|127\.0\.0\.1|::1)/i.test(link.href));
  const failures = checks.filter((check) => !check.ok);
  const result = {
    ok: failures.length === 0 && localhostBriefLinks.length === 0,
    generatedAt: new Date().toISOString(),
    localBase,
    hostedBase,
    latestBrief: {
      available: Boolean(briefHtml),
      generatedAt: summary?.generatedAt || summary?.finishedAt || "",
      reviewLinks: summary?.reviewLinks ?? 0,
      linkCount: briefLinks.length,
      localhostLinkCount: localhostBriefLinks.length
    },
    checked: checks.length,
    failures,
    localhostBriefLinks: localhostBriefLinks.slice(0, 10),
    checks
  };

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
