import { access, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { normalizeContactDocumentTypes } from "./shelfcycle-contact-document-types.mjs";
import { buildMentionInsertionPlan } from "./shelfcycle-mentions.mjs";

const PROFILE_DIR = path.join(process.cwd(), ".local", "shelfcycle-browser-profile");
const DEFAULT_URL = "https://app.shelfcycle.com/org-clearedge";

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePlaywrightModule() {
  const homeDir = os.homedir();
  const candidates = [
    process.env.CODEX_PLAYWRIGHT_MODULE_PATH,
    path.join(homeDir, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return import(pathToFileURL(candidate).href);
    }
  }

  throw new Error("Playwright runtime was not found. Expected Codex bundled runtime to be available.");
}

async function resolveChromeExecutable() {
  const candidates = [
    process.env.SHELF_CYCLE_BROWSER_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error("A Chromium-compatible browser executable was not found. Install Chrome or set SHELF_CYCLE_BROWSER_PATH.");
}

async function createContext({ headless = false } = {}) {
  const { chromium } = await resolvePlaywrightModule();
  const executablePath = await resolveChromeExecutable();

  await mkdir(PROFILE_DIR, { recursive: true });

  return chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath,
    headless,
    viewport: { width: 1440, height: 1024 }
  });
}

function safeShelfCycleUrl(value = "") {
  const raw = String(value || "").trim();

  if (!raw) {
    return DEFAULT_URL;
  }

  const url = new URL(raw);

  if (url.hostname !== "app.shelfcycle.com") {
    throw new Error("Only app.shelfcycle.com URLs can be opened by the ShelfCycle automation.");
  }

  if (!url.pathname.startsWith("/org-clearedge")) {
    throw new Error("Only the ClearEdge ShelfCycle organization can be opened by the ShelfCycle automation.");
  }

  return url.href;
}

async function getWorkingPage(context) {
  const existingPage = context.pages()[0];

  if (existingPage) {
    return existingPage;
  }

  return context.newPage();
}

async function dismissCommonPopups(page) {
  const closeButtons = [
    page.getByRole("button", { name: /close/i }),
    page.getByRole("button", { name: /dismiss/i })
  ];

  for (const button of closeButtons) {
    try {
      if (await button.isVisible({ timeout: 500 })) {
        await button.click();
      }
    } catch {
      // Ignore transient dialogs.
    }
  }
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactErrorText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function recordSegment(kind = "customer") {
  if (kind === "supplier") {
    return "suppliers";
  }

  if (kind === "product") {
    return "products";
  }

  return "customers";
}

function parseShelfCycleRecordId(url = "", kind = "customer") {
  const match = String(url || "").match(new RegExp(`/org-clearedge/${recordSegment(kind)}/([^/?#]+)`, "i"));
  return match ? decodeURIComponent(match[1]) : "";
}

async function requireDialogClosedAfterSave(page, dialog, { recordName = "record", actionLabel = "save" } = {}) {
  const closed = await dialog.waitFor({ state: "hidden", timeout: 12000 }).then(() => true).catch(() => false);

  if (closed) {
    return;
  }

  const stillVisible = await dialog.isVisible({ timeout: 500 }).catch(() => false);

  if (!stillVisible) {
    return;
  }

  const dialogText = await dialog.textContent().catch(() => "");
  throw new Error(`ShelfCycle did not ${actionLabel} ${recordName}; the save dialog stayed open. ${compactErrorText(dialogText)}`);
}

async function firstVisible(locator) {
  try {
    if (!(await locator.count())) {
      return null;
    }

    if (await locator.isVisible({ timeout: 750 }).catch(() => false)) {
      return locator;
    }
  } catch {
    // Try the next candidate.
  }

  return null;
}

async function openCandidateRecordUrl(page, locator, kind = "customer") {
  const visible = await firstVisible(locator);

  if (!visible) {
    return "";
  }

  const href = await visible.getAttribute("href").catch(() => "");

  if (href) {
    const url = new URL(href, page.url()).href;
    return parseShelfCycleRecordId(url, kind) ? url : "";
  }

  await visible.scrollIntoViewIfNeeded().catch(() => null);

  try {
    await Promise.all([
      page.waitForURL(new RegExp(`/org-clearedge/${recordSegment(kind)}/[^/?#]+`, "i"), { timeout: 7000 }).catch(() => null),
      visible.click({ timeout: 5000 })
    ]);
  } catch {
    return "";
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(500).catch(() => null);

  return parseShelfCycleRecordId(page.url(), kind) ? page.url() : "";
}

async function findCompanyRecordUrlOnCurrentPage(page, { kind = "customer", name = "" } = {}) {
  const text = String(name || "").trim();
  const namePattern = new RegExp(escapeRegExp(text), "i");
  const linkCandidates = [
    page.locator(`a[href*="/org-clearedge/${recordSegment(kind)}/"]`).filter({ hasText: namePattern }).first(),
    page.locator(`a[href*="/${recordSegment(kind)}/"]`).filter({ hasText: namePattern }).first(),
    page.getByRole("link", { name: namePattern }).first()
  ];

  for (const candidate of linkCandidates) {
    const recordUrl = await openCandidateRecordUrl(page, candidate, kind);

    if (recordUrl) {
      return recordUrl;
    }
  }

  const rowCandidates = [
    page.locator("tr").filter({ hasText: namePattern }).first(),
    page.locator("[role='row']").filter({ hasText: namePattern }).first(),
    page.locator("tbody > *").filter({ hasText: namePattern }).first(),
    page.locator("[data-row-key], [class*='row'], [class*='Row']").filter({ hasText: namePattern }).first()
  ];

  for (const candidate of rowCandidates) {
    const recordUrl = await openCandidateRecordUrl(page, candidate, kind);

    if (recordUrl) {
      return recordUrl;
    }
  }

  const visibleText = await page.getByText(namePattern).first().isVisible({ timeout: 2000 }).catch(() => false);

  if (visibleText) {
    throw new Error(`ShelfCycle showed ${text} in the ${kind} search results, but the automation could not open a verified ${kind} record URL.`);
  }

  throw new Error(`ShelfCycle did not show the ${kind} "${text}" in search results.`);
}

async function findCompanyRecordUrl(page, { kind = "customer", name = "", listUrl = "", trustCurrentRecord = true } = {}) {
  const text = String(name || "").trim();

  if (!text) {
    throw new Error(`Cannot verify created ${kind}; missing ${kind} name.`);
  }

  const currentId = parseShelfCycleRecordId(page.url(), kind);
  if (trustCurrentRecord && currentId) {
    return page.url();
  }

  const searchUrl = new URL(listUrl || `https://app.shelfcycle.com/org-clearedge/${recordSegment(kind)}`);
  searchUrl.searchParams.set("query", text);
  await page.goto(safeShelfCycleUrl(searchUrl.href), { waitUntil: "domcontentloaded" });
  await dismissCommonPopups(page);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(800);

  return findCompanyRecordUrlOnCurrentPage(page, { kind, name: text });
}

async function clickCustomerProspectChip(page) {
  const candidates = [
    page.getByRole("button", { name: /^prospect$/i }).first(),
    page.locator("label").filter({ hasText: /^Prospect$/i }).first(),
    page.getByText(/^Prospect$/i).first()
  ];

  for (const candidate of candidates) {
    const visible = await firstVisible(candidate);

    if (!visible) {
      continue;
    }

    await visible.scrollIntoViewIfNeeded().catch(() => null);

    try {
      await visible.click({ timeout: 3000 });
    } catch {
      await visible.click({ timeout: 3000, force: true }).catch(() => null);
    }

    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
    await page.waitForTimeout(700);
    return true;
  }

  return false;
}

async function fillCustomerSearch(page, customerName = "") {
  const text = String(customerName || "").trim();
  const searchFields = [
    page.getByPlaceholder(/search customers/i).first(),
    page.locator('input[placeholder*="Search customers"]').first(),
    page.locator('input[type="search"]').first()
  ];

  for (const field of searchFields) {
    const visible = await firstVisible(field);

    if (!visible) {
      continue;
    }

    await visible.fill(text);
    await page.waitForTimeout(900);
    await page.keyboard.press("Enter").catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
    await page.waitForTimeout(900);
    return true;
  }

  return false;
}

async function findProspectCustomerRecordUrl(page, customerName = "") {
  const text = String(customerName || "").trim();

  if (!text) {
    return "";
  }

  await page.goto(safeShelfCycleUrl("https://app.shelfcycle.com/org-clearedge/customers"), { waitUntil: "domcontentloaded" });
  await dismissCommonPopups(page);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(800);

  const prospectChipClicked = await clickCustomerProspectChip(page);

  if (!prospectChipClicked) {
    return "";
  }

  const searched = await fillCustomerSearch(page, text);

  if (!searched) {
    return "";
  }

  return findCompanyRecordUrlOnCurrentPage(page, { kind: "customer", name: text });
}

async function selectNoteType(dialog, value) {
  const text = String(value || "").trim();

  if (!text) {
    return;
  }

  const selectCandidates = [
    dialog.getByLabel(/type/i),
    dialog.locator("select").first(),
    dialog.getByRole("combobox").first()
  ];

  for (const control of selectCandidates) {
    try {
      if (await control.count()) {
        await control.selectOption({ label: text }).catch(async () => {
          await control.selectOption({ value: text }).catch(() => null);
        });
        return;
      }
    } catch {
      // Try next selector.
    }
  }

  try {
    const combo = dialog.getByRole("combobox", { name: /type/i });
    await combo.click({ timeout: 1000 });
    await dialog.getByRole("option", { name: new RegExp(text, "i") }).click({ timeout: 1000 });
  } catch {
    // Leave the default type if the form does not expose a simple selector.
  }
}

export function mentionResultsForUnavailableEditor(mentions = [], warning = "Rich-text mentions unavailable on this form.") {
  return mentions.map((mention) => ({
    label: mention.label,
    kind: mention.kind,
    status: "plain_text",
    warning
  }));
}

async function clearFocusedRichText(page, richText) {
  await richText.click();

  try {
    await richText.fill("");
    return;
  } catch {
    // Some rich-text editors do not expose a normal fill contract.
  }

  await page.keyboard.press("Meta+A").catch(async () => {
    await page.keyboard.press("Control+A").catch(() => null);
  });
  await page.keyboard.press("Backspace").catch(() => null);
}

async function typeFocusedText(page, text = "") {
  if (!text) {
    return;
  }

  if (text.includes("\n")) {
    const chunks = text.split("\n");

    for (const [index, chunk] of chunks.entries()) {
      if (chunk) {
        await typeFocusedText(page, chunk);
      }

      if (index < chunks.length - 1) {
        await page.keyboard.press("Enter");
      }
    }

    return;
  }

  if (page.keyboard?.insertText) {
    await page.keyboard.insertText(text);
    return;
  }

  await page.keyboard.type(text);
}

async function typeMentionTrigger(page, label = "") {
  if (page.keyboard?.type) {
    await page.keyboard.type(`@${label}`, { delay: 15 });
    return;
  }

  await typeFocusedText(page, `@${label}`);
}

function mentionKindPrefixes(kind = "") {
  if (kind === "customer") {
    return ["Customer"];
  }

  if (kind === "contact") {
    return ["Contact", "Person"];
  }

  if (kind === "product") {
    return ["Product", "Product Code", "Product Family"];
  }

  return [];
}

function mentionOptionLocators(page, mention = {}) {
  const labels = [...new Set([mention.label, mention.searchText].map((value) => String(value || "").trim()).filter(Boolean))];
  const patterns = labels.map((label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return {
      exact: new RegExp(`^${escaped}$`, "i"),
      contains: new RegExp(escaped, "i"),
      prefixed: mentionKindPrefixes(mention.kind).map((prefix) => {
        return new RegExp(`^${prefix}:\\s*${escaped}$`, "i");
      })
    };
  });
  const pickerButtonSelector = "[data-tippy-root] button.mention-item, .tippy-content button.mention-item, .mention-items button.mention-item";

  return [
    ...patterns.flatMap(({ prefixed }) => prefixed.map((pattern) => page.locator(pickerButtonSelector).filter({ hasText: pattern }).first())),
    ...patterns.flatMap(({ exact, contains }) => [
      page.locator(pickerButtonSelector).filter({ hasText: exact }).first(),
      page.locator(pickerButtonSelector).filter({ hasText: contains }).first()
    ]),
    ...patterns.flatMap(({ prefixed }) => prefixed.flatMap((pattern) => [
      page.getByRole("option", { name: pattern }).first(),
      page.getByRole("listitem", { name: pattern }).first(),
      page.getByRole("menuitem", { name: pattern }).first()
    ])),
    ...patterns.flatMap(({ exact, contains }) => [
      page.getByRole("option", { name: exact }).first(),
      page.getByRole("option", { name: contains }).first(),
      page.getByRole("listitem", { name: exact }).first(),
      page.getByRole("listitem", { name: contains }).first(),
      page.getByRole("menuitem", { name: exact }).first(),
      page.getByRole("menuitem", { name: contains }).first(),
      page.locator("[role='option']").filter({ hasText: contains }).first(),
      page.locator("[role='listitem'], [role='menuitem']").filter({ hasText: contains }).first(),
      page.locator("[role='listbox'], [role='menu'], [data-tippy-root], .tippy-box, .tippy-content, .mantine-Popover-dropdown, .mantine-Combobox-dropdown")
        .getByText(contains)
        .first(),
      page.locator("[data-testid*='mention'], button[class*='mention'], [class*='mention-item']").filter({ hasText: contains }).first()
    ])
  ];
}

async function visibleMentionOption(page, mention = {}) {
  for (const option of mentionOptionLocators(page, mention)) {
    try {
      if (!(await option.count())) {
        continue;
      }

      if (typeof option.isVisible === "function" && !(await option.isVisible({ timeout: 300 }))) {
        continue;
      }

      return option;
    } catch {
      // Try the next picker shape.
    }
  }

  return null;
}

async function commitPlainTextMention(page) {
  await page.keyboard.press("Escape").catch(() => null);
  await page.waitForTimeout(150).catch(() => null);

  // Tiptap keeps unresolved @mentions in a suggestion mark until normal text
  // is typed. A boundary space prevents the next word/mention from being
  // swallowed into the unresolved suggestion.
  await typeFocusedText(page, " ");
}

async function selectMentionOption(page, mention = {}) {
  const label = mention.label || "";

  await page.waitForTimeout(600);
  let option = await visibleMentionOption(page, mention);

  if (!option) {
    await commitPlainTextMention(page);
    return {
      label,
      kind: mention.kind,
      status: "plain_text",
      warning: "Mention option not found."
    };
  }

  let clickWarning = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await option.click({ timeout: 1500 });
    } catch (error) {
      clickWarning = error instanceof Error ? error.message.split("\n")[0] : "Mention option click failed.";
      option = await visibleMentionOption(page, mention);

      if (!option) {
        break;
      }

      continue;
    }

    await page.waitForTimeout(350);

    option = await visibleMentionOption(page, mention);

    if (!option) {
      return {
        label,
        kind: mention.kind,
        status: "linked"
      };
    }
  }

  await page.keyboard.press("Enter").catch(() => null);
  await page.waitForTimeout(350);

  if (!(await visibleMentionOption(page, mention))) {
    return {
      label,
      kind: mention.kind,
      status: "linked"
    };
  }

  await commitPlainTextMention(page);

  return {
    label,
    kind: mention.kind,
    status: "plain_text",
    warning: clickWarning ? "Mention option click failed." : "Mention option did not commit."
  };
}

export async function typeMentionSegments(page, segments = []) {
  const mentionResults = [];

  for (const segment of segments) {
    if (segment.type === "mention") {
      const searchText = segment.text || segment.mention.label;
      await typeMentionTrigger(page, searchText);
      mentionResults.push(await selectMentionOption(page, { ...segment.mention, searchText }));
      continue;
    }

    await typeFocusedText(page, segment.text || "");
  }

  return mentionResults;
}

async function fillRichText(dialog, value, { mentions = [] } = {}) {
  const text = String(value || "").trim();
  const cleanMentions = Array.isArray(mentions) ? mentions.filter((mention) => mention?.label) : [];

  if (!text) {
    return { mentionResults: [], warnings: [] };
  }

  if (cleanMentions.length) {
    const page = dialog.page();
    const richText = dialog.locator("[contenteditable='true']").last();
    const plan = buildMentionInsertionPlan(text, cleanMentions);

    if (await richText.count()) {
      await clearFocusedRichText(page, richText);
      const mentionResults = await typeMentionSegments(page, plan.segments);

      return {
        mentionResults,
        warnings: mentionResults.map((result) => result.warning).filter(Boolean)
      };
    }

    const warning = "Rich-text mentions unavailable on this form.";
    const fallbackResults = mentionResultsForUnavailableEditor(cleanMentions, warning);

    for (const field of [
      dialog.getByLabel(/summary/i),
      dialog.locator("textarea").first()
    ]) {
      try {
        if (await field.count()) {
          await field.fill(plan.plainText);
          return {
            mentionResults: fallbackResults,
            warnings: [warning]
          };
        }
      } catch {
        // Continue to the normal error path.
      }
    }
  }

  const textareaCandidates = [
    dialog.getByLabel(/summary/i),
    dialog.locator("textarea").first()
  ];

  for (const field of textareaCandidates) {
    try {
      if (await field.count()) {
        await field.fill(text);
        return { mentionResults: [], warnings: [] };
      }
    } catch {
      // Continue to contenteditable fallback.
    }
  }

  const richText = dialog.locator("[contenteditable='true']").last();

  if (await richText.count()) {
    await richText.click();
    await richText.evaluate((node, nextValue) => {
      node.textContent = "";
      node.innerHTML = "";
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.textContent = nextValue;
      node.dispatchEvent(new Event("input", { bubbles: true }));
    }, text);
    return { mentionResults: [], warnings: [] };
  }

  throw new Error("Could not locate a note summary field in ShelfCycle.");
}

async function waitForSavedNote(page, title) {
  try {
    await page.getByText(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).waitFor({ timeout: 8000 });
  } catch {
    // If the app redirects or refreshes without a strong success banner, the caller still gets the page URL.
  }
}

async function fillFieldByLabel(root, labelPattern, value) {
  const text = String(value ?? "").trim();

  if (!text) {
    return false;
  }

  const field = root.getByLabel(labelPattern).first();

  try {
    if (await field.count()) {
      await field.fill(text);
      return true;
    }
  } catch {
    // Fall through to placeholder/order-based helpers.
  }

  return false;
}

function candidateText(...values) {
  return values
    .map((value) => String(value ?? ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyRecordEditButtonCandidate(candidate = {}) {
  const directText = candidateText(
    candidate.text,
    candidate.ariaLabel,
    candidate.title,
    candidate.testId,
    candidate.name
  );
  const broadText = candidateText(
    directText,
    candidate.className,
    candidate.html
  );
  const viewportWidth = Number(candidate.viewportWidth) || 1440;
  const top = Number(candidate.top);
  const right = Number(candidate.right);
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  const visible = candidate.visible !== false && width > 0 && height > 0;
  const unsafe = /\b(save|cancel|delete|remove|new|add|create|import|export|archive|upload)\b/i.test(directText);
  const hasEditSignal = /\bedit\b|pencil|iconedit|tabler-icon-edit|lucide-(?:icon-)?(?:edit|pencil)|data-icon=["']?(?:edit|pencil)/i.test(broadText);
  const isUpperRight = Number.isFinite(top) && Number.isFinite(right) && top >= 0 && top <= 280 && right >= viewportWidth * 0.58;
  const iconOnly = !candidateText(candidate.text) && (candidate.hasSvg || width <= 76);
  let score = 0;

  if (!visible || unsafe) {
    score = -1;
  } else {
    if (hasEditSignal) {
      score += 100;
    }

    if (isUpperRight) {
      score += 30;
    }

    if (iconOnly) {
      score += 15;
    }

    if (Number.isFinite(top) && top <= 180) {
      score += 5;
    }
  }

  return {
    ...candidate,
    directText,
    hasEditSignal,
    iconOnly,
    isUpperRight,
    score,
    unsafe,
    visible
  };
}

async function clickVisibleLocator(page, locator) {
  const visible = await firstVisible(locator);

  if (!visible) {
    return false;
  }

  await visible.scrollIntoViewIfNeeded().catch(() => null);
  await visible.click({ timeout: 5000 }).catch(async () => {
    await visible.click({ timeout: 5000, force: true });
  });
  await page.waitForTimeout(500);
  return true;
}

async function clickHeuristicRecordEditButton(page) {
  const buttons = page.locator("button");
  const candidates = await buttons.evaluateAll((nodes) => nodes.map((node, index) => {
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const html = node.outerHTML.slice(0, 1500);
    const className = typeof node.className === "string" ? node.className : String(node.getAttribute("class") || "");

    return {
      index,
      text: node.innerText || node.textContent || "",
      ariaLabel: node.getAttribute("aria-label") || "",
      title: node.getAttribute("title") || "",
      testId: node.getAttribute("data-testid") || node.getAttribute("data-test") || "",
      className,
      html,
      hasSvg: Boolean(node.querySelector("svg")),
      top: rect.top,
      right: rect.right,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      visible: style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0
    };
  }));
  const ranked = candidates
    .map((candidate) => classifyRecordEditButtonCandidate(candidate))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const exactCandidate = ranked.find((candidate) => candidate.hasEditSignal);
  const upperRightIconCandidates = ranked.filter((candidate) => candidate.isUpperRight && candidate.iconOnly);
  const fallbackCandidate = upperRightIconCandidates.length === 1 ? upperRightIconCandidates[0] : null;
  const candidate = exactCandidate ?? fallbackCandidate;

  if (!candidate) {
    return false;
  }

  await buttons.nth(candidate.index).click({ timeout: 5000 }).catch(async () => {
    await buttons.nth(candidate.index).click({ timeout: 5000, force: true });
  });
  await page.waitForTimeout(500);
  return true;
}

async function clickRecordEditButton(page, recordLabel = "record") {
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(750).catch(() => null);

  const candidates = [
    page.getByRole("button", { name: /^edit$/i }).first(),
    page.getByRole("button", { name: /edit/i }).first(),
    page.getByRole("link", { name: /edit/i }).first(),
    page.locator('[title*="Edit" i]').first(),
    page.locator('[aria-label*="Edit" i]').first(),
    page.locator('[data-testid*="edit" i], [data-test*="edit" i]').first(),
    page.locator('button[aria-label*="Edit" i]').first(),
    page.locator('button:has(svg[class*="edit" i])').first(),
    page.locator('button:has(svg[class*="pencil" i])').first(),
    page.locator('button:has([class*="tabler-icon-edit" i])').first(),
    page.locator('a[href*="/edit"]').first()
  ];

  for (const candidate of candidates) {
    if (await clickVisibleLocator(page, candidate)) {
      return true;
    }
  }

  if (await clickHeuristicRecordEditButton(page)) {
    return true;
  }

  throw new Error(`Could not find an Edit button for the ShelfCycle ${recordLabel}.`);
}

async function saveOpenDialog(page, dialog, { recordName = "", actionLabel = "save" } = {}) {
  await closeOpenDropdowns(page).catch(() => null);
  const saveButton = dialog.getByRole("button", { name: /^save$/i }).first();

  await saveButton.click({ timeout: 10000 }).catch(async (error) => {
    await closeOpenDropdowns(page).catch(() => null);
    await saveButton.click({ timeout: 5000, force: true }).catch(() => {
      throw error;
    });
  });
  await requireDialogClosedAfterSave(page, dialog, {
    recordName,
    actionLabel
  });
}

async function fillFirstMatching(root, selectors = [], value = "") {
  const text = String(value ?? "").trim();

  if (!text) {
    return false;
  }

  for (const selector of selectors) {
    const field = root.locator(selector).first();

    try {
      if (await field.count()) {
        await field.fill(text);
        return true;
      }
    } catch {
      // Try next selector.
    }
  }

  return false;
}

async function selectSearchOption(root, { label, placeholder, value } = {}) {
  const text = String(value ?? "").trim();

  if (!text) {
    return false;
  }

  const candidates = [
    label ? root.getByLabel(label).first() : null,
    placeholder ? root.locator(`input[type="search"][placeholder*="${placeholder}"]`).first() : null
  ].filter(Boolean);

  for (const field of candidates) {
    try {
      if (!(await field.count())) {
        continue;
      }

      await field.click();
      await field.fill(text);
      await root.page().waitForTimeout(600);

      const option = root.page().getByRole("option", { name: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first();

      if (await option.count()) {
        await option.click();
        return true;
      }

      await field.press("Enter");
      return true;
    } catch {
      // Try next selector.
    }
  }

  return false;
}

async function selectSearchOptions(root, { label, placeholder, values = [] } = {}) {
  const cleanValues = [...new Set((Array.isArray(values) ? values : [values]).map((value) => String(value || "").trim()).filter(Boolean))];
  let selectedCount = 0;

  for (const value of cleanValues) {
    const selected = await selectSearchOption(root, { label, placeholder, value });

    if (selected) {
      selectedCount += 1;
      await root.page().keyboard.press("Escape").catch(() => null);
      await root.page().waitForTimeout(150).catch(() => null);
    }
  }

  return selectedCount;
}

async function closeOpenDropdowns(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.keyboard.press("Escape").catch(() => null);
    await page.waitForTimeout(150).catch(() => null);
  }
}

async function visibleDropdownOptionTexts(page) {
  const optionLocators = [
    "[role='option']",
    ".mantine-Combobox-option",
    ".mantine-Select-option",
    ".mantine-MultiSelect-option"
  ].join(", ");

  return page.locator(optionLocators).evaluateAll((elements) => {
    const seen = new Set();
    const values = [];

    for (const element of elements) {
      const text = (element.innerText || element.textContent || "").trim();
      const key = text.toLowerCase();

      if (!text || seen.has(key)) {
        continue;
      }

      seen.add(key);
      values.push(text);
    }

    return values;
  }).catch(() => []);
}

async function openSearchDropdown(root, { label, placeholder } = {}) {
  const candidates = [
    label ? root.getByLabel(label).first() : null,
    placeholder ? root.locator(`input[type="search"][placeholder*="${placeholder}"]`).first() : null,
    root.getByRole("combobox", label ? { name: label } : {}).first(),
    root.locator("[role='combobox']").last()
  ].filter(Boolean);

  for (const field of candidates) {
    try {
      if (!(await field.count())) {
        continue;
      }

      await field.click({ timeout: 2500 });
      await root.page().waitForTimeout(350);
      return true;
    } catch {
      // Try the next control shape.
    }
  }

  return false;
}

async function selectAllSearchOptions(root, { label, placeholder, fallbackValues = [] } = {}) {
  const opened = await openSearchDropdown(root, { label, placeholder });
  const page = root.page();
  const visibleValues = opened ? await visibleDropdownOptionTexts(page) : [];
  const expectedValues = visibleValues.length
    ? visibleValues
    : [...new Set((Array.isArray(fallbackValues) ? fallbackValues : [fallbackValues]).map((value) => String(value || "").trim()).filter(Boolean))];

  if (!expectedValues.length) {
    return {
      selectedCount: 0,
      expectedValues
    };
  }

  let selectedCount = 0;

  for (const value of expectedValues) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    await openSearchDropdown(root, { label, placeholder });
    const optionCandidates = [
      page.getByRole("option", { name: new RegExp(`^${escaped}$`, "i") }).first(),
      page.getByRole("option", { name: new RegExp(escaped, "i") }).first(),
      page.locator(".mantine-Combobox-option, .mantine-Select-option, .mantine-MultiSelect-option").filter({ hasText: new RegExp(`^${escaped}$`, "i") }).first(),
      page.locator(".mantine-Combobox-option, .mantine-Select-option, .mantine-MultiSelect-option").filter({ hasText: new RegExp(escaped, "i") }).first()
    ];
    let selected = false;

    for (const option of optionCandidates) {
      try {
        if (!(await option.count())) {
          continue;
        }

        if (await option.isVisible({ timeout: 500 }).catch(() => false)) {
          await option.click({ timeout: 2500 });
          selected = true;
          break;
        }
      } catch {
        // Try the next option shape.
      }
    }

    if (!selected) {
      selected = await selectSearchOption(root, { label, placeholder, value });
    }

    if (selected) {
      selectedCount += 1;
    }

    await closeOpenDropdowns(page);
  }

  await closeOpenDropdowns(page);

  return {
    selectedCount,
    expectedValues
  };
}

async function setCheckboxByLabel(root, labelPattern, value) {
  if (value === undefined || value === null || value === "") {
    return false;
  }

  const checked = typeof value === "boolean"
    ? value
    : /\b(true|yes|y|prospect)\b/i.test(String(value));
  const control = root.getByLabel(labelPattern).first();

  try {
    if (await control.count()) {
      await control.setChecked(checked);
      return true;
    }
  } catch {
    try {
      await control.click();
      return true;
    } catch {
      // Leave default if the checkbox/switch cannot be located safely.
    }
  }

  return false;
}

function orgUrlFromRelative(href = "") {
  const raw = String(href || "").trim();

  if (!raw) {
    return "";
  }

  if (raw.startsWith("/org-clearedge/")) {
    return `https://app.shelfcycle.com${raw}`;
  }

  if (raw.startsWith("/customers/") || raw.startsWith("/suppliers/")) {
    return `https://app.shelfcycle.com/org-clearedge${raw}`;
  }

  return raw;
}

async function resolveCompanyUrlFromContacts(page, companyName = "") {
  const label = String(companyName || "").trim();

  if (!label) {
    return "";
  }

  await page.goto(safeShelfCycleUrl("https://app.shelfcycle.com/org-clearedge/contacts"), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const link = page.getByRole("link", { name: new RegExp(`^${escaped}$`, "i") }).first();

  if (!(await link.count())) {
    return "";
  }

  const href = await link.getAttribute("href");
  return orgUrlFromRelative(href);
}

async function resolveCompanyRecordUrl(page, { kind = "customer", name = "" } = {}) {
  const label = String(name || "").trim();

  if (!label) {
    return "";
  }

  const listUrl = `https://app.shelfcycle.com/org-clearedge/${recordSegment(kind)}`;

  try {
    return await findCompanyRecordUrl(page, {
      kind,
      name: label,
      listUrl,
      trustCurrentRecord: false
    });
  } catch {
    // Retry customer lookups through the Prospect chip. ShelfCycle hides
    // prospect records behind that filter, so normal customer search can miss
    // a valid target selected by the user.
  }

  if (kind === "customer") {
    try {
      const prospectUrl = await findProspectCustomerRecordUrl(page, label);

      if (prospectUrl) {
        return prospectUrl;
      }
    } catch {
      // Fall through to the Contacts page for older records where the company
      // relationship is easier to open through an existing contact row.
    }
  }

  return resolveCompanyUrlFromContacts(page, label);
}

export async function openShelfCycleSessionForLogin({ url = DEFAULT_URL } = {}) {
  const context = await createContext({ headless: false });
  const page = await getWorkingPage(context);
  const targetUrl = safeShelfCycleUrl(url);

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.bringToFront();
  await dismissCommonPopups(page);

  return {
    ok: true,
    message: "ShelfCycle browser session opened. Log in if prompted, then return to the review page.",
    url: page.url(),
    context
  };
}

export async function submitShelfCycleNote(submission = {}) {
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    let targetUrl = submission.url;

    if (!submission.customerId && submission.customerName) {
      const companyUrl = await resolveCompanyRecordUrl(page, {
        kind: "customer",
        name: submission.customerName
      });

      if (!companyUrl.includes("/customers/")) {
        throw new Error(`Could not resolve a customer page for ${submission.customerName || "the selected company"}.`);
      }

      targetUrl = `${companyUrl.replace(/\/+$/, "")}/notes`;
    }

    if (!submission.supplierId && submission.supplierName) {
      const companyUrl = await resolveCompanyRecordUrl(page, {
        kind: "supplier",
        name: submission.supplierName
      });

      if (!companyUrl.includes("/suppliers/")) {
        throw new Error(`Could not resolve a supplier page for ${submission.supplierName || "the selected company"}.`);
      }

      targetUrl = `${companyUrl.replace(/\/+$/, "")}/notes`;
    }

    await page.goto(safeShelfCycleUrl(targetUrl), { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await dismissCommonPopups(page);

    const newNoteButton = page.getByRole("button", { name: /new note/i }).first();
    await newNoteButton.click({ timeout: 10000 });

    const dialog = page.getByRole("dialog").last();
    await dialog.waitFor({ timeout: 10000 });

    const dateField = dialog.getByLabel(/date/i).first();
    if (await dateField.count()) {
      await dateField.fill(submission.fields.date);
    }

    await selectNoteType(dialog, submission.fields.type);

    const titleField = dialog.getByLabel(/title/i).first();
    if (await titleField.count()) {
      await titleField.fill(submission.fields.title);
    }

    const summaryResult = await fillRichText(dialog, submission.fields.summary, {
      mentions: submission.fields.mentions ?? []
    });

    const saveButton = dialog.getByRole("button", { name: /^save$/i }).first();
    await saveButton.click({ timeout: 10000 });

    await waitForSavedNote(page, submission.fields.title);

    return {
      ok: true,
      recordType: "note",
      customerId: submission.customerId,
      customerName: submission.customerName,
      title: submission.fields.title,
      mentionResults: summaryResult.mentionResults,
      warnings: summaryResult.warnings,
      savedAtUrl: page.url()
    };
  } finally {
    await context.close();
  }
}

export function contactTargetKindFromSubmission(submission = {}) {
  const companyType = String(submission.fields?.companyType || "").toLowerCase();

  if (submission.supplierId || submission.supplierName || companyType.includes("supplier")) {
    return "supplier";
  }

  return "customer";
}

export async function submitShelfCycleContact(submission = {}) {
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    const targetKind = contactTargetKindFromSubmission(submission);
    let targetUrl = submission.url;

    if (submission.supplierId) {
      targetUrl = `https://app.shelfcycle.com/org-clearedge/suppliers/${submission.supplierId}/contacts`;
    } else if (submission.supplierName) {
      const companyUrl = await resolveCompanyRecordUrl(page, {
        kind: "supplier",
        name: submission.supplierName
      });

      if (!companyUrl.includes("/suppliers/")) {
        throw new Error(`Could not resolve a supplier page for ${submission.supplierName || "the selected company"}.`);
      }

      targetUrl = `${companyUrl.replace(/\/+$/, "")}/contacts`;
    } else if (!submission.customerId) {
      const companyUrl = await resolveCompanyRecordUrl(page, {
        kind: "customer",
        name: submission.customerName
      });

      if (!companyUrl.includes("/customers/")) {
        throw new Error(`Could not resolve a customer page for ${submission.customerName || "the selected company"}.`);
      }

      targetUrl = `${companyUrl.replace(/\/+$/, "")}/contacts`;
    }

    await page.goto(safeShelfCycleUrl(targetUrl), { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await dismissCommonPopups(page);

    await page.getByRole("button", { name: /new contact/i }).click({ timeout: 10000 });
    const dialog = page.getByRole("dialog").last();
    await dialog.waitFor({ timeout: 10000 });

    await fillContactDialogFields(dialog, submission.fields);
    const documentTypes = normalizeContactDocumentTypes(targetKind, submission.fields.documentTypes);
    const {
      selectedCount: selectedDocumentTypeCount,
      expectedValues: expectedDocumentTypes
    } = await selectAllSearchOptions(dialog, {
      label: /document types/i,
      placeholder: "Document Types",
      fallbackValues: documentTypes
    });

    if (selectedDocumentTypeCount < expectedDocumentTypes.length) {
      throw new Error(`Could not select all ShelfCycle contact document types. Selected ${selectedDocumentTypeCount} of ${expectedDocumentTypes.length}: ${expectedDocumentTypes.join(", ")}`);
    }

    await closeOpenDropdowns(page);
    const saveButton = dialog.getByRole("button", { name: /^save$/i }).first();
    await saveButton.click({ timeout: 10000 }).catch(async (error) => {
      await closeOpenDropdowns(page);
      await saveButton.click({ timeout: 5000, force: true }).catch(() => {
        throw error;
      });
    });
    const contactLabel = submission.fields.name || submission.fields.email;
    await requireDialogClosedAfterSave(page, dialog, {
      recordName: contactLabel,
      actionLabel: "save contact"
    });

    const contactPattern = new RegExp(escapeRegExp(contactLabel), "i");
    let contactVisible = await page.getByText(contactPattern).first().isVisible({ timeout: 8000 }).catch(() => false);

    if (!contactVisible) {
      await page.goto(safeShelfCycleUrl(targetUrl), { waitUntil: "domcontentloaded" });
      await dismissCommonPopups(page);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
      contactVisible = await page.getByText(contactPattern).first().isVisible({ timeout: 8000 }).catch(() => false);
    }

    if (!contactVisible) {
      throw new Error(`ShelfCycle did not show the created contact "${contactLabel}" after save.`);
    }

    return {
      ok: true,
      recordType: "contact",
      customerId: submission.customerId,
      customerName: submission.customerName,
      supplierId: submission.supplierId,
      supplierName: submission.supplierName,
      name: submission.fields.name,
      email: submission.fields.email,
      savedAtUrl: page.url()
    };
  } finally {
    await context.close();
  }
}

async function fillContactDialogFields(dialog, fields = {}) {
  await fillFieldByLabel(dialog, /^name\b/i, fields.name);
  await fillFieldByLabel(dialog, /^title\b/i, fields.title);
  await fillFieldByLabel(dialog, /^email\b/i, fields.email);
  await fillFieldByLabel(dialog, /^phone\b|office/i, fields.phone || fields.officePhone);
  await fillFieldByLabel(dialog, /mobile/i, fields.mobilePhone);
  await fillFieldByLabel(dialog, /fax/i, fields.faxPhone);
}

async function resolveContactRecordUrl(page, submission = {}) {
  if (submission.contactId) {
    return `https://app.shelfcycle.com/org-clearedge/contacts/${submission.contactId}`;
  }

  const label = String(submission.contactName || submission.fields?.name || submission.fields?.email || "").trim();

  if (!label) {
    throw new Error("Could not resolve a contact page because the contact name/email is missing.");
  }

  const targetKind = contactTargetKindFromSubmission(submission);
  let targetUrl = "";

  if (submission.supplierId) {
    targetUrl = `https://app.shelfcycle.com/org-clearedge/suppliers/${submission.supplierId}/contacts`;
  } else if (submission.customerId) {
    targetUrl = `https://app.shelfcycle.com/org-clearedge/customers/${submission.customerId}/contacts`;
  } else if (submission.supplierName) {
    const companyUrl = await resolveCompanyRecordUrl(page, {
      kind: "supplier",
      name: submission.supplierName
    });
    targetUrl = `${companyUrl.replace(/\/+$/, "")}/contacts`;
  } else if (submission.customerName) {
    const companyUrl = await resolveCompanyRecordUrl(page, {
      kind: "customer",
      name: submission.customerName
    });
    targetUrl = `${companyUrl.replace(/\/+$/, "")}/contacts`;
  } else {
    targetUrl = "https://app.shelfcycle.com/org-clearedge/contacts";
  }

  await page.goto(safeShelfCycleUrl(targetUrl), { waitUntil: "domcontentloaded" });
  await page.bringToFront();
  await dismissCommonPopups(page);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(800);

  const pattern = new RegExp(escapeRegExp(label), "i");
  const candidates = [
    page.locator('a[href*="/contacts/"]').filter({ hasText: pattern }).first(),
    page.getByRole("link", { name: pattern }).first(),
    page.locator("tr").filter({ hasText: pattern }).first(),
    page.locator("[role='row']").filter({ hasText: pattern }).first()
  ];

  for (const candidate of candidates) {
    const visible = await firstVisible(candidate);

    if (!visible) {
      continue;
    }

    await visible.scrollIntoViewIfNeeded().catch(() => null);
    await Promise.all([
      page.waitForURL(/\/org-clearedge\/contacts\/[^/?#]+/i, { timeout: 7000 }).catch(() => null),
      visible.click({ timeout: 5000 }).catch(async () => visible.click({ timeout: 5000, force: true }))
    ]);
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => null);

    if (/\/org-clearedge\/contacts\/[^/?#]+/i.test(page.url())) {
      return page.url();
    }

    const dialog = page.getByRole("dialog").last();
    if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
      return page.url();
    }
  }

  throw new Error(`Could not resolve a ${targetKind} contact page for ${label}.`);
}

export async function submitShelfCycleContactUpdate(submission = {}) {
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    const contactUrl = await resolveContactRecordUrl(page, submission);

    if (/\/org-clearedge\/contacts\/[^/?#]+/i.test(contactUrl) && page.url() !== contactUrl) {
      await page.goto(safeShelfCycleUrl(contactUrl), { waitUntil: "domcontentloaded" });
    }

    await page.bringToFront();
    await dismissCommonPopups(page);

    let dialog = page.getByRole("dialog").last();
    if (!(await dialog.isVisible({ timeout: 1000 }).catch(() => false))) {
      await clickRecordEditButton(page, "contact");
      dialog = page.getByRole("dialog").last();
    }

    await dialog.waitFor({ timeout: 10000 });
    await fillContactDialogFields(dialog, submission.fields ?? {});
    await saveOpenDialog(page, dialog, {
      recordName: submission.contactName || submission.fields?.name || submission.fields?.email,
      actionLabel: "update contact"
    });

    return {
      ok: true,
      recordType: "contact",
      contactId: submission.contactId,
      contactName: submission.contactName || submission.fields?.name || submission.fields?.email,
      customerId: submission.customerId,
      customerName: submission.customerName,
      supplierId: submission.supplierId,
      supplierName: submission.supplierName,
      savedAtUrl: page.url()
    };
  } finally {
    await context.close();
  }
}

export async function submitShelfCycleCustomer(submission = {}) {
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    const fields = submission.fields ?? {};

    await page.goto(safeShelfCycleUrl(submission.url || "https://app.shelfcycle.com/org-clearedge/customers"), { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await dismissCommonPopups(page);

    await page.getByRole("button", { name: /new customer/i }).click({ timeout: 10000 });
    const dialog = page.getByRole("dialog").last();
    await dialog.waitFor({ timeout: 10000 });

    await fillFieldByLabel(dialog, /^name\b/i, fields.name);
    await fillFieldByLabel(dialog, /^email\b/i, fields.email);
    await fillFieldByLabel(dialog, /^website\b/i, fields.website);
    await fillFieldByLabel(dialog, /phone number/i, fields.phoneNumber);
    await fillFieldByLabel(dialog, /^street address$/i, fields.streetAddress);
    await fillFieldByLabel(dialog, /street address 2/i, fields.streetAddress2);
    await fillFieldByLabel(dialog, /^city\b/i, fields.city);
    await fillFieldByLabel(dialog, /state|region/i, fields.stateRegion);
    await fillFieldByLabel(dialog, /^zip\b|postal/i, fields.zip);
    await selectSearchOption(dialog, { label: /^country$/i, placeholder: "Select country", value: fields.country });
    await fillFieldByLabel(dialog, /credit limit/i, fields.creditLimit);
    await selectSearchOption(dialog, { label: /payment term/i, placeholder: "Select a payment term", value: fields.paymentTerm });
    await selectSearchOption(dialog, { label: /default sales person/i, placeholder: "Sales Person", value: fields.defaultSalesPerson });
    await selectSearchOption(dialog, { label: /default csr/i, placeholder: "Customer Service Representative", value: fields.defaultCsr });
    await setCheckboxByLabel(dialog, /create as prospect/i, fields.prospect);

    const saveButton = dialog.getByRole("button", { name: /^save$/i }).first();
    await saveButton.click({ timeout: 10000 });
    await requireDialogClosedAfterSave(page, dialog, {
      recordName: fields.name,
      actionLabel: "save customer"
    });
    const savedAtUrl = await findCompanyRecordUrl(page, {
      kind: "customer",
      name: fields.name,
      listUrl: "https://app.shelfcycle.com/org-clearedge/customers"
    });

    return {
      ok: true,
      recordType: "customer",
      customerId: parseShelfCycleRecordId(savedAtUrl, "customer"),
      customerName: fields.name,
      savedAtUrl
    };
  } finally {
    await context.close();
  }
}

export async function submitShelfCycleSupplier(submission = {}) {
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    const fields = submission.fields ?? {};

    await page.goto(safeShelfCycleUrl(submission.url || "https://app.shelfcycle.com/org-clearedge/suppliers"), { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await dismissCommonPopups(page);

    await page.getByRole("button", { name: /new supplier/i }).click({ timeout: 10000 });
    const dialog = page.getByRole("dialog").last();
    await dialog.waitFor({ timeout: 10000 });

    await fillSupplierDialogFields(dialog, fields);

    const saveButton = dialog.getByRole("button", { name: /^save$/i }).first();
    await saveButton.click({ timeout: 10000 });
    await requireDialogClosedAfterSave(page, dialog, {
      recordName: fields.name,
      actionLabel: "save supplier"
    });
    const savedAtUrl = await findCompanyRecordUrl(page, {
      kind: "supplier",
      name: fields.name,
      listUrl: "https://app.shelfcycle.com/org-clearedge/suppliers"
    });

    return {
      ok: true,
      recordType: "supplier",
      supplierId: parseShelfCycleRecordId(savedAtUrl, "supplier"),
      supplierName: fields.name,
      savedAtUrl
    };
  } finally {
    await context.close();
  }
}

async function fillSupplierDialogFields(dialog, fields = {}) {
  await fillFieldByLabel(dialog, /^name\b/i, fields.name);
  await fillFieldByLabel(dialog, /^phone\b/i, fields.phone);
  await fillFieldByLabel(dialog, /^email\b/i, fields.email);
  await fillFieldByLabel(dialog, /^website\b/i, fields.website);
  await fillFieldByLabel(dialog, /^street 1\b|^street address$/i, fields.street1);
  await fillFieldByLabel(dialog, /^street 2\b|street address 2/i, fields.street2);
  await fillFieldByLabel(dialog, /^city\b/i, fields.city);
  await selectSearchOption(dialog, { label: /^country$/i, placeholder: "Select country", value: fields.country });
  await fillFieldByLabel(dialog, /state|region/i, fields.stateRegion);
  await fillFieldByLabel(dialog, /^zip\b|postal/i, fields.zip);
  await selectSearchOption(dialog, { label: /payment terms/i, placeholder: "Select Payment Terms", value: fields.paymentTerms });
  await fillFieldByLabel(dialog, /credit limit/i, fields.creditLimit);
  await fillFieldByLabel(dialog, /ach routing/i, fields.achRoutingNumber);
  await fillFieldByLabel(dialog, /ach account/i, fields.achAccountNumber);
  await selectSearchOption(dialog, { label: /cost account/i, placeholder: "Select Cost Account", value: fields.costAccount });
  await selectSearchOption(dialog, { label: /preferred unit of measure/i, placeholder: "Select Unit", value: fields.preferredUnitOfMeasure });
  await selectSearchOption(dialog, { label: /default supplier rep/i, placeholder: "Supplier Rep", value: fields.defaultSupplierRep });
}

export async function submitShelfCycleSupplierUpdate(submission = {}) {
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    const fields = submission.fields ?? {};
    const targetUrl = submission.supplierId
      ? `https://app.shelfcycle.com/org-clearedge/suppliers/${submission.supplierId}`
      : await resolveCompanyRecordUrl(page, {
          kind: "supplier",
          name: submission.supplierName || fields.name
        });

    if (!targetUrl || !targetUrl.includes("/suppliers/")) {
      throw new Error(`Could not resolve a supplier page for ${submission.supplierName || fields.name || "the selected supplier"}.`);
    }

    await page.goto(safeShelfCycleUrl(targetUrl), { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await dismissCommonPopups(page);
    await clickRecordEditButton(page, "supplier");
    const dialog = page.getByRole("dialog").last();
    await dialog.waitFor({ timeout: 10000 });
    await fillSupplierDialogFields(dialog, fields);
    await saveOpenDialog(page, dialog, {
      recordName: submission.supplierName || fields.name,
      actionLabel: "update supplier"
    });

    return {
      ok: true,
      recordType: "supplier",
      supplierId: submission.supplierId || parseShelfCycleRecordId(page.url(), "supplier"),
      supplierName: submission.supplierName || fields.name,
      savedAtUrl: page.url()
    };
  } finally {
    await context.close();
  }
}

export async function submitShelfCyclePriceBookEntry(submission = {}) {
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    await page.goto(safeShelfCycleUrl(submission.url), { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await dismissCommonPopups(page);

    await page.getByRole("button", { name: /^new$/i }).click({ timeout: 10000 });
    const dialog = page.getByRole("dialog").last();
    await dialog.waitFor({ timeout: 10000 });

    await selectSearchOption(dialog, { label: /^customer$/i, placeholder: "Customer", value: submission.fields.customerName });
    await selectSearchOption(dialog, { label: /product code/i, value: submission.fields.productCode || submission.fields.productName });
    await fillFieldByLabel(dialog, /price \(\$\/pkg\)/i, submission.fields.pricePerPackage);
    await fillFieldByLabel(dialog, /price \(\$\/\)/i, submission.fields.pricePerUnit);
    await fillFieldByLabel(dialog, /date from/i, submission.fields.dateFrom);
    await fillFieldByLabel(dialog, /date to/i, submission.fields.dateTo);
    await fillFieldByLabel(dialog, /^note$/i, submission.fields.note);

    const saveButton = dialog.getByRole("button", { name: /^save$/i }).first();
    await saveButton.click({ timeout: 10000 });

    return {
      ok: true,
      recordType: "pricing_record",
      customerName: submission.fields.customerName,
      productCode: submission.fields.productCode,
      savedAtUrl: page.url()
    };
  } finally {
    await context.close();
  }
}

export async function submitShelfCycleProductCode(submission = {}) {
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    const fields = submission.fields ?? {};
    const isUpdate = fields.mode === "update" || Boolean(submission.productId || submission.productName);
    const targetUrl = isUpdate
      ? (submission.productId
        ? `https://app.shelfcycle.com/org-clearedge/products/${submission.productId}`
        : await findCompanyRecordUrl(page, {
            kind: "product",
            name: submission.productName || fields.code || fields.productName,
            listUrl: "https://app.shelfcycle.com/org-clearedge/products",
            trustCurrentRecord: false
          }))
      : (submission.url || "https://app.shelfcycle.com/org-clearedge/products");

    await page.goto(safeShelfCycleUrl(targetUrl), { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await dismissCommonPopups(page);

    if (isUpdate) {
      await clickRecordEditButton(page, "product");
    } else {
      await page.getByRole("button", { name: /new product code/i }).click({ timeout: 10000 });
    }

    const dialog = page.getByRole("dialog").last();
    await dialog.waitFor({ timeout: 10000 });

    await fillProductCodeDialogFields(dialog, fields);

    if (fields.sdsPath) {
      await dialog.locator('input[type="file"]').first().setInputFiles(fields.sdsPath);
    }

    await saveOpenDialog(page, dialog, {
      recordName: submission.productName || fields.code || fields.productName,
      actionLabel: isUpdate ? "update product" : "save product"
    });
    const verificationLabel = fields.code || fields.productName || submission.productName;
    if (verificationLabel) {
      await page.getByText(new RegExp(escapeRegExp(verificationLabel), "i")).waitFor({ timeout: 10000 }).catch(() => null);
    }

    return {
      ok: true,
      recordType: "product_code",
      productId: submission.productId || parseShelfCycleRecordId(page.url(), "product"),
      productName: submission.productName || fields.productName || fields.code,
      code: fields.code,
      mode: isUpdate ? "update" : "create",
      savedAtUrl: page.url()
    };
  } finally {
    await context.close();
  }
}

async function fillProductCodeDialogFields(dialog, fields = {}) {
  await fillFieldByLabel(dialog, /^code/i, fields.code);
  await selectSearchOption(dialog, { label: /product family/i, placeholder: "Select a Product Family", value: fields.productFamily || fields.productName });
  await selectSearchOption(dialog, { label: /packaging type/i, placeholder: "Packaging Type", value: fields.packagingType || "Fixed" });
  await selectSearchOption(dialog, { label: /^packaging/i, placeholder: "Select Packaging", value: fields.packaging });
  await fillFirstMatching(dialog, ['input[placeholder="123.45"]'], fields.quantityPerPackage);
  await selectSearchOption(dialog, { label: /supplier type/i, placeholder: "Select a Supplier Type", value: fields.supplierType || "Variable" });
  await selectSearchOption(dialog, { label: /^supplier$/i, placeholder: "Supplier", value: fields.supplier });
  await fillFieldByLabel(dialog, /cas number/i, fields.casNumber);
  await fillFieldByLabel(dialog, /nmfc/i, fields.nmfcCode);
  await fillFieldByLabel(dialog, /freight class/i, fields.freightClass);
  await selectSearchOption(dialog, { label: /pallet/i, placeholder: "Select a Pallet", value: fields.pallet });
  await fillFieldByLabel(dialog, /packages per pallet/i, fields.packagesPerPallet);
  await selectSearchOption(dialog, { label: /un\/na number/i, placeholder: "e.g., UN1993", value: fields.unNumber });
  await selectSearchOption(dialog, { label: /packing group/i, placeholder: "Select packing group", value: fields.packingGroup });
  await fillFieldByLabel(dialog, /proper shipping name/i, fields.properShippingName);
}

export async function submitShelfCycleProductDocument(submission = {}) {
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    await page.goto(safeShelfCycleUrl(submission.url), { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await dismissCommonPopups(page);

    await page.getByRole("button", { name: /^edit$/i }).first().click({ timeout: 10000 });
    const dialog = page.getByRole("dialog").last();
    await dialog.waitFor({ timeout: 10000 });

    await dialog.locator('input[type="file"]').first().setInputFiles(submission.fields.filePath);
    const saveButton = dialog.getByRole("button", { name: /^save$/i }).first();
    await saveButton.click({ timeout: 10000 });

    return {
      ok: true,
      recordType: "product_document",
      productId: submission.productId,
      filePath: submission.fields.filePath,
      savedAtUrl: page.url()
    };
  } finally {
    await context.close();
  }
}

export async function loadSubmissionPayload(payloadPath) {
  return JSON.parse(await readFile(payloadPath, "utf8"));
}
