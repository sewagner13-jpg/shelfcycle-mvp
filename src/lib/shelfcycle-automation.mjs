import { access, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { normalizeContactDocumentTypes } from "./shelfcycle-contact-document-types.mjs";
import {
  dropdownSelectionMatches,
  dropdownValueCandidates,
  isNonRegulatedTransportValue,
  normalizeHazardClassDropdownValues,
  normalizePackagingDropdownValue,
  normalizePackagingTypeDropdownValue,
  normalizePackingGroupDropdownValue,
  normalizeShelfCycleProductAutomationFields,
  normalizeUnNumberDropdownValue,
  normalizeUnitOfMeasureDropdownValue,
  splitOptionValues
} from "./shelfcycle-dropdown-normalizers.mjs";
import {
  SHELFCYCLE_COMPANY_DROPDOWN_FIELDS,
  SHELFCYCLE_PRODUCT_CODE_FIELDS,
  SHELFCYCLE_PRODUCT_FAMILY_FIELDS,
  shelfCycleDropdownArgs,
  shelfCycleTextPlaceholder
} from "./shelfcycle-field-map.mjs";
import { missingShelfCycleProductFields } from "./shelfcycle-product-requirements.mjs";
import { buildMentionInsertionPlan } from "./shelfcycle-mentions.mjs";
import {
  appendWorkflowLog,
  loadWorkflowRun,
  updateWorkflowStep,
  ACTION_STATE,
  WORKFLOW_STEP_STATUS
} from "./workflow-runs.mjs";

const PROFILE_DIR = path.join(process.cwd(), ".local", "shelfcycle-browser-profile");
const DEFAULT_URL = "https://app.shelfcycle.com/org-clearedge";

export {
  normalizeHazardClassDropdownValues,
  normalizePackagingTypeDropdownValue,
  normalizePackingGroupDropdownValue,
  normalizeUnNumberDropdownValue,
  normalizeUnitOfMeasureDropdownValue
};

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

function workflowContext(submission = {}) {
  const workflow = submission.workflow ?? {};
  return {
    runId: workflow.runId || "",
    storageDir: workflow.storageDir || ""
  };
}

let activeManualAssistSubmission = null;

function activateManualAssistSubmission(submission = {}) {
  if (submission?.workflow?.runId && submission?.workflow?.storageDir) {
    activeManualAssistSubmission = submission;
  }
}

function manualAssistSubmissionFor(submission = {}) {
  return submission?.workflow?.runId && submission?.workflow?.storageDir
    ? submission
    : activeManualAssistSubmission ?? {};
}

function manualAssistCheckpointForDropdown({ label, placeholder, value } = {}) {
  const labelText = label instanceof RegExp
    ? label.source
        .replace(/\(\?!.*?\)/g, " ")
        .replace(/\\[bdsw]|\^|\$|\[|\]|\(|\)|\?|\+|\*|\||\//g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : String(label || "").trim();
  const field = placeholder || labelText || "ShelfCycle dropdown";
  const valueText = String(value || "").trim();

  return {
    field,
    label: valueText ? `${field}: ${valueText}` : field,
    value: valueText,
    phase: "shelfcycle_dropdown"
  };
}

function isSubmissionDryRun(submission = {}) {
  return submission.dryRun === true || submission.fields?.dryRun === true;
}

function visualPacingMs(submission = {}) {
  const value = Number(submission.visualPacingMs ?? submission.fields?.visualPacingMs ?? process.env.SHELFCYCLE_AGENT_VISUAL_PACING_MS ?? 0);

  return Number.isFinite(value) && value > 0 ? Math.min(value, 5000) : 0;
}

function dryRunHoldMs(submission = {}) {
  const value = Number(submission.dryRunHoldMs ?? submission.fields?.dryRunHoldMs ?? process.env.SHELFCYCLE_AGENT_DRY_RUN_HOLD_MS ?? 1200);

  return Number.isFinite(value) && value > 0 ? Math.min(value, 120000) : 0;
}

async function visualStepPause(page, submission = {}, message = "") {
  const delay = visualPacingMs(submission);

  if (!delay) {
    return;
  }

  if (message) {
    await reportPageProgress(page, submission, message, {
      phase: "visual_step_pause"
    });
  }

  await page.waitForTimeout(delay).catch(() => null);
}

async function holdDryRunOpen(page, submission = {}) {
  await page.waitForTimeout(dryRunHoldMs(submission)).catch(() => null);
}

export function isProductCodeUpdateSubmission(submission = {}) {
  const fields = submission.fields ?? {};
  return fields.mode === "update" || Boolean(submission.productId);
}

async function reportShelfCycleProgress(submission = {}, message = "", detail = {}) {
  const { runId, storageDir } = workflowContext(submission);

  if (!runId || !storageDir || !message) {
    return;
  }

  await appendWorkflowLog(storageDir, runId, {
    message,
    detail: Object.fromEntries(
      Object.entries(detail).filter(([, value]) => value !== undefined && value !== null && value !== "")
    )
  }).catch(() => {});
  await updateWorkflowStep(storageDir, runId, "shelfcycle_submit", {
    status: WORKFLOW_STEP_STATUS.RUNNING,
    detail: message,
    artifacts: {
      ...(detail.currentUrl ? { activeShelfCycleUrl: detail.currentUrl } : {}),
      ...(detail.phase ? { activeShelfCyclePhase: detail.phase } : {})
    }
  }).catch(() => {});
}

async function reportPageProgress(page, submission = {}, message = "", detail = {}) {
  const currentUrl = typeof page?.url === "function" ? page.url() : "";

  await reportShelfCycleProgress(submission, message, {
    currentUrl,
    ...detail
  });
}

async function waitForManualAssistIfRequested(page, submission = {}, checkpoint = {}, { force = false } = {}) {
  const { runId, storageDir } = workflowContext(submission);

  if (!runId || !storageDir) {
    return false;
  }

  const run = await loadWorkflowRun(storageDir, runId).catch(() => null);
  const manualAssist = run?.artifacts?.manualAssist ?? {};

  if (!manualAssist.requested && !force) {
    return false;
  }

  const label = checkpoint.label || checkpoint.field || "current ShelfCycle field";
  const reasonText = checkpoint.reason ? ` Reason: ${checkpoint.reason}` : "";
  const attemptedText = checkpoint.value ? ` Attempted value: ${checkpoint.value}.` : "";
  const optionsText = Array.isArray(checkpoint.visibleOptions) && checkpoint.visibleOptions.length
    ? ` Visible options included: ${checkpoint.visibleOptions.slice(0, 8).join(", ")}.`
    : "";
  const message = force
    ? `Agent paused for manual assist at ${label}.${attemptedText}${reasonText}${optionsText} Fix the field in ShelfCycle, then click Resume in ClearEdge.`
    : `Manual assist active at ${label}.${attemptedText} Make the needed ShelfCycle selection, then click Resume in ClearEdge.`;
  const startedAt = new Date().toISOString();

  await updateWorkflowStep(storageDir, runId, "shelfcycle_submit", {
    status: WORKFLOW_STEP_STATUS.WAITING,
    detail: message,
    actionState: ACTION_STATE.MANUAL_ASSIST,
    artifacts: {
      activeShelfCycleUrl: typeof page?.url === "function" ? page.url() : "",
      activeShelfCyclePhase: checkpoint.phase || "manual_assist",
      manualAssist: {
        ...manualAssist,
        requested: true,
        active: true,
        requestedAt: manualAssist.requestedAt || startedAt,
        requestedBy: manualAssist.requestedBy || (force ? "agent" : "user"),
        field: checkpoint.field || "",
        label,
        phase: checkpoint.phase || "",
        reason: checkpoint.reason || "",
        value: checkpoint.value || "",
        visibleOptions: Array.isArray(checkpoint.visibleOptions) ? checkpoint.visibleOptions.slice(0, 12) : [],
        pausedAt: manualAssist.pausedAt || startedAt,
        message
      }
    }
  }).catch(() => {});
  await appendWorkflowLog(storageDir, runId, {
    message,
    detail: {
      currentUrl: typeof page?.url === "function" ? page.url() : "",
      phase: checkpoint.phase || "",
      field: checkpoint.field || "",
      reason: checkpoint.reason || "",
      value: checkpoint.value || "",
      visibleOptions: Array.isArray(checkpoint.visibleOptions) ? checkpoint.visibleOptions.slice(0, 12) : []
    }
  }).catch(() => {});

  const deadline = Date.now() + 30 * 60 * 1000;

  while (Date.now() < deadline) {
    await page.waitForTimeout(1000).catch(() => null);
    const latest = await loadWorkflowRun(storageDir, runId).catch(() => null);
    const latestAssist = latest?.artifacts?.manualAssist ?? {};

    if (!latestAssist.requested) {
      await updateWorkflowStep(storageDir, runId, "shelfcycle_submit", {
        status: WORKFLOW_STEP_STATUS.RUNNING,
        detail: `Manual assist complete. Continuing ShelfCycle automation after ${label}.`,
        actionState: ACTION_STATE.RUNNING,
        artifacts: {
          manualAssist: {
            ...latestAssist,
            requested: false,
            active: false,
            resumedAt: latestAssist.resumedAt || new Date().toISOString(),
            message: ""
          }
        }
      }).catch(() => {});
      await appendWorkflowLog(storageDir, runId, {
        message: `Manual assist complete. Continuing after ${label}.`
      }).catch(() => {});
      return true;
    }

    if (latest?.status === "failed" || latest?.status === "cancelled") {
      throw new Error("ShelfCycle automation stopped while waiting for manual assist.");
    }
  }

  throw new Error(`Manual assist timed out at ${label}. Click Resume sooner, or restart the ShelfCycle action.`);
}

async function focusAgentPage(page) {
  try {
    await page.bringToFront();
  } catch {
    // Browser focus is best-effort; automation can continue if the OS refuses focus.
  }
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

export function isTransientSaveClickError(error) {
  const message = String(error?.message || error || "");

  return /not stable|detached from the DOM|element is not attached|intercepts pointer events|target closed|execution context was destroyed/i.test(message);
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

async function waitForVisible(locator, timeout = 2500) {
  try {
    await locator.waitFor({ state: "visible", timeout });
    return locator;
  } catch {
    return firstVisible(locator);
  }
}

async function visibleButtonSnapshot(page) {
  return page.locator("button").evaluateAll((buttons) => buttons
    .map((button) => {
      const rect = button.getBoundingClientRect();
      const text = (button.innerText || button.textContent || "").replace(/\s+/g, " ").trim();
      const visible = Boolean(rect.width && rect.height && window.getComputedStyle(button).visibility !== "hidden");

      return {
        text,
        aria: button.getAttribute("aria-label") || "",
        title: button.getAttribute("title") || "",
        visible,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    })
    .filter((button) => button.visible)
    .slice(0, 30)).catch(() => []);
}

async function clickShelfCycleButton(page, candidates = [], { label = "button", timeout = 10000 } = {}) {
  const perCandidateTimeout = Math.max(1500, Math.min(timeout, 4000));

  for (const candidate of candidates) {
    const visible = await waitForVisible(candidate, perCandidateTimeout);

    if (!visible) {
      continue;
    }

    await visible.scrollIntoViewIfNeeded().catch(() => null);

    try {
      await visible.click({ timeout });
      return true;
    } catch {
      try {
        await visible.click({ timeout: Math.min(timeout, 5000), force: true });
        return true;
      } catch {
        // Try the next locator; ShelfCycle tables and popovers can intercept clicks.
      }
    }
  }

  const buttons = await visibleButtonSnapshot(page);
  throw new Error(`Could not click the ShelfCycle ${label}. Current URL: ${page.url()}. Visible buttons: ${compactErrorText(JSON.stringify(buttons))}`);
}

async function clickVisibleButtonByExactText(page, label = "") {
  const result = await page.evaluate((expectedLabel) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const expected = normalize(expectedLabel);
    const candidates = [...document.querySelectorAll("button")].filter((button) => {
      const rect = button.getBoundingClientRect();
      const style = window.getComputedStyle(button);
      const text = normalize(button.innerText || button.textContent || button.getAttribute("aria-label") || "");

      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        text === expected;
    });

    const button = candidates[candidates.length - 1];

    if (!button) {
      return { clicked: false, count: candidates.length };
    }

    button.scrollIntoView({ block: "center", inline: "center" });
    button.click();
    return { clicked: true, count: candidates.length };
  }, label).catch((error) => ({ clicked: false, error: String(error) }));

  if (result.clicked) {
    return true;
  }

  return false;
}

async function clickInlineAddButtonForField(dialog, { placeholder = "", label = "", fieldName = "field" } = {}) {
  const page = dialog.page();

  await page.waitForTimeout(300).catch(() => null);
  const result = await page.evaluate((args) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    };
    const labelFor = (root, input) => {
      if (!input.id) {
        return "";
      }

      return root.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.innerText || "";
    };
    const placeholderNeedle = normalize(args.placeholder);
    const labelNeedle = normalize(args.label);
    const roots = [...document.querySelectorAll("[role='dialog']")]
      .filter(visible)
      .reverse();

    for (const root of roots) {
      const inputs = [...root.querySelectorAll("input")].filter((input) => {
        if (!visible(input)) {
          return false;
        }

        const placeholderText = normalize(input.getAttribute("placeholder"));
        const labelText = normalize(labelFor(root, input));

        return (placeholderNeedle && placeholderText.includes(placeholderNeedle)) ||
          (labelNeedle && labelText.includes(labelNeedle));
      });

      for (const input of inputs) {
        const inputRect = input.getBoundingClientRect();
        const buttons = [...root.querySelectorAll("button")].filter((button) => {
          if (!visible(button)) {
            return false;
          }

          const rect = button.getBoundingClientRect();
          const overlapsInputRow = rect.bottom >= inputRect.top - 4 && rect.top <= inputRect.bottom + 4;
          const sitsToRight = rect.left >= inputRect.right - 6 && rect.left <= inputRect.right + 96;

          return overlapsInputRow && sitsToRight;
        });
        const button = buttons[0];

        if (button) {
          button.scrollIntoView({ block: "center", inline: "center" });
          button.click();
          return {
            ok: true,
            input: {
              label: labelFor(root, input),
              placeholder: input.getAttribute("placeholder") || ""
            }
          };
        }
      }
    }

    return {
      ok: false,
      visibleDialogs: roots.map((root) => {
        const rect = root.getBoundingClientRect();

        return {
          text: (root.innerText || root.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      }),
      visibleButtons: roots.flatMap((root) => [...root.querySelectorAll("button")].filter((button) => {
        if (!visible(button)) {
          return false;
        }

        return true;
      })).map((button) => {
        const rect = button.getBoundingClientRect();

        return {
          text: (button.innerText || button.textContent || "").replace(/\s+/g, " ").trim(),
          aria: button.getAttribute("aria-label") || "",
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      }).slice(0, 20)
    };
  }, { placeholder, label });

  if (result.ok) {
    return true;
  }

  throw new Error(`Could not click the ShelfCycle add button for ${fieldName}. ${compactErrorText(JSON.stringify(result))}`);
}

async function waitForNewRecordButton(page, recordLabel = "record") {
  const targetText = `New ${recordLabel}`;

  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await page.waitForFunction((expectedLabel) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const expected = normalize(expectedLabel);

    return [...document.querySelectorAll("button")].some((button) => {
      const rect = button.getBoundingClientRect();
      const style = window.getComputedStyle(button);
      const text = normalize(button.innerText || button.textContent || button.getAttribute("aria-label") || "");

      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        text === expected;
    });
  }, targetText, { timeout: 15000 }).catch(() => null);
}

export async function clickNewRecordButton(page, recordLabel = "record") {
  const exactName = new RegExp(`^\\s*(?:\\+\\s*)?New\\s+${escapeRegExp(recordLabel)}\\s*$`, "i");
  const looseName = new RegExp(`new\\s+${escapeRegExp(recordLabel)}`, "i");
  const exactText = `New ${recordLabel}`;

  await waitForNewRecordButton(page, recordLabel);

  try {
    await clickShelfCycleButton(page, [
      page.getByRole("button", { name: exactName }).last(),
      page.locator("button").filter({ hasText: exactName }).last(),
      page.getByRole("button", { name: looseName }).last(),
      page.locator("button").filter({ hasText: looseName }).last()
    ], {
      label: `New ${recordLabel} button`,
      timeout: 12000
    });
  } catch (error) {
    if (await clickVisibleButtonByExactText(page, exactText)) {
      return;
    }

    throw error;
  }
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

async function findExistingCompanyRecordUrlBeforeCreate(page, { kind = "customer", name = "", listUrl = "" } = {}) {
  const text = String(name || "").trim();

  if (!text) {
    return "";
  }

  try {
    return await findCompanyRecordUrl(page, {
      kind,
      name: text,
      listUrl,
      trustCurrentRecord: false
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");

    if (/showed .* search results/i.test(message)) {
      throw error;
    }

    return "";
  }
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
    } catch (error) {
      if (strict && /multiple matches/i.test(error instanceof Error ? error.message : String(error))) {
        throw error;
      }
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

async function clickLastVisibleDialogSaveButton(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    };
    const dialogs = [...document.querySelectorAll("[role='dialog']")].filter(visible);
    const dialog = dialogs.at(-1);

    if (!dialog) {
      return false;
    }

    const save = [...dialog.querySelectorAll("button")]
      .filter(visible)
      .find((button) => /^save$/i.test((button.innerText || button.textContent || "").trim()));

    if (!save) {
      return false;
    }

    save.scrollIntoView({ block: "center", inline: "center" });
    save.click();
    return true;
  }).catch(() => false);
}

async function clickDialogSaveButton(page, dialog) {
  const saveButton = dialog.getByRole("button", { name: /^save$/i }).first();
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const dialogVisible = await dialog.isVisible({ timeout: 500 }).catch(() => false);

    if (!dialogVisible) {
      return;
    }

    try {
      await saveButton.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => null);
      await saveButton.click({ timeout: attempt === 0 ? 10000 : 3500 });
      return;
    } catch (error) {
      lastError = error;

      if (!(await dialog.isVisible({ timeout: 500 }).catch(() => false))) {
        return;
      }

      if (!isTransientSaveClickError(error)) {
        break;
      }
    }

    await closeOpenDropdowns(page).catch(() => null);

    try {
      await saveButton.click({ timeout: 3500, force: true });
      return;
    } catch (error) {
      lastError = error;

      if (!(await dialog.isVisible({ timeout: 500 }).catch(() => false))) {
        return;
      }
    }

    if (await clickLastVisibleDialogSaveButton(page)) {
      return;
    }

    await page.waitForTimeout(350).catch(() => null);
  }

  if (await clickLastVisibleDialogSaveButton(page)) {
    return;
  }

  throw lastError ?? new Error("Could not click the ShelfCycle Save button.");
}

async function saveOpenDialog(page, dialog, { recordName = "", actionLabel = "save" } = {}) {
  await closeOpenDropdowns(page).catch(() => null);
  await clickDialogSaveButton(page, dialog);
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

function patternArg(pattern) {
  if (pattern instanceof RegExp) {
    return {
      type: "regex",
      source: pattern.source,
      flags: pattern.flags
    };
  }

  return {
    type: "text",
    value: String(pattern || "")
  };
}

function safeAttributeValue(value = "") {
  return String(value || "").replace(/"/g, '\\"');
}

function placeholderRegex(placeholder = "") {
  return new RegExp(`^\\s*${escapeRegExp(placeholder)}\\s*$`, "i");
}

async function taggedSearchField(root, { label, placeholder } = {}) {
  const page = root.page();
  const key = `clearedge-field-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const result = await root.evaluateAll((roots, args) => {
    const rootNode = roots[0];

    if (!rootNode) {
      return { ok: false };
    }

    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    };
    const textMatches = (value, matcher, { exact = false } = {}) => {
      const text = String(value || "").replace(/\s+/g, " ").trim();

      if (!text) {
        return false;
      }

      if (matcher?.type === "regex") {
        return new RegExp(matcher.source, matcher.flags).test(text);
      }

      if (!matcher?.value) {
        return false;
      }

      const normalizedText = text.toLowerCase();
      const normalizedNeedle = String(matcher.value).replace(/\s+/g, " ").trim().toLowerCase();

      return exact
        ? normalizedText === normalizedNeedle
        : normalizedText.includes(normalizedNeedle);
    };
    const labelFor = (element) => {
      const id = element.getAttribute("id");
      const explicit = id ? rootNode.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText : "";
      const wrapper = element.closest(".mantine-InputWrapper-root, [class*='InputWrapper'], label, [data-combobox-target], [role='group']");
      const nearby = wrapper ? (wrapper.innerText || wrapper.textContent || "") : "";

      return [
        explicit,
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder"),
        element.getAttribute("name"),
        nearby
      ].filter(Boolean).join(" ");
    };
    const controls = [...rootNode.querySelectorAll([
      "input:not([type='hidden'])",
      "textarea",
      "[role='combobox']",
      "button[aria-haspopup='listbox']",
      "button[aria-expanded]"
    ].join(","))]
      .filter(visible)
      .map((element) => ({
        element,
        labelText: labelFor(element),
        placeholderText: element.getAttribute("placeholder") || "",
        role: element.getAttribute("role") || "",
        tag: element.tagName.toLowerCase()
      }));
    const scoreControl = (control) => {
      let score = 0;

      if (textMatches(control.placeholderText, args.placeholder, { exact: true })) {
        score += 100;
      }

      if (textMatches(control.labelText, args.label)) {
        score += 60;
      }

      if (control.tag === "input" || control.tag === "textarea") {
        score += 25;
      }

      if (control.role === "combobox") {
        score += 10;
      }

      return score;
    };
    const matched = controls
      .map((control) => ({ ...control, score: scoreControl(control) }))
      .filter((control) => control.score > 0)
      .sort((a, b) => b.score - a.score || a.element.getBoundingClientRect().top - b.element.getBoundingClientRect().top)[0];

    if (!matched) {
      return {
        ok: false,
        controls: controls.map((control) => ({
          labelText: control.labelText.slice(0, 160),
          placeholderText: control.placeholderText,
          role: control.role,
          tag: control.tag
        })).slice(0, 12)
      };
    }

    matched.element.setAttribute("data-clearedge-search-field", args.key);
    return {
      ok: true,
      labelText: matched.labelText.slice(0, 160),
      placeholderText: matched.placeholderText,
      role: matched.role,
      tag: matched.tag
    };
  }, {
    key,
    label: patternArg(label),
    placeholder: placeholder ? patternArg(placeholder) : null
  }).catch((error) => ({ ok: false, error: String(error) }));

  if (!result.ok) {
    return null;
  }

  return page.locator(`[data-clearedge-search-field="${safeAttributeValue(key)}"]`).first();
}

async function searchFieldCandidates(root, { label, placeholder } = {}) {
  const candidates = [
    placeholder ? root.getByPlaceholder(placeholderRegex(placeholder)).first() : null,
    await taggedSearchField(root, { label, placeholder }),
    label ? root.getByLabel(label).first() : null,
    label ? root.getByRole("combobox", { name: label }).first() : null
  ].filter(Boolean);

  return candidates;
}

async function waitForSearchField(root, { label, placeholder, timeout = 5000 } = {}) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const candidates = await searchFieldCandidates(root, { label, placeholder });

    for (const candidate of candidates) {
      try {
        if (!(await candidate.count())) {
          continue;
        }

        const isVisible = await candidate.isVisible({ timeout: 300 }).catch(() => true);

        if (!isVisible) {
          continue;
        }

        if (placeholder) {
          const actualPlaceholder = await candidate.evaluate((element) => element.getAttribute("placeholder") || "").catch(() => "");

          if (actualPlaceholder && !placeholderRegex(placeholder).test(actualPlaceholder)) {
            continue;
          }
        }

        {
          return candidate;
        }
      } catch {
        // Try the next candidate shape.
      }
    }

    await root.page().waitForTimeout(200).catch(() => null);
  }

  return null;
}

async function openAndSearchDropdownField(field, searchValue = "", { expectedPlaceholder = "" } = {}) {
  const page = field.page();
  const fieldKey = `clearedge-active-dropdown-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  await closeOpenDropdowns(page).catch(() => null);
  await field.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => null);
  if (expectedPlaceholder) {
    const actualPlaceholder = await field.evaluate((element) => element.getAttribute("placeholder") || "").catch(() => "");

    if (actualPlaceholder && !placeholderRegex(expectedPlaceholder).test(actualPlaceholder)) {
      return false;
    }
  }
  await field.evaluate((element, key) => {
    element.setAttribute("data-clearedge-active-dropdown-field", key);
  }, fieldKey).catch(() => null);

  try {
    await field.click({ timeout: 3000 });
  } catch {
    await field.click({ timeout: 3000, force: true });
  }

  await page.waitForTimeout(150).catch(() => null);
  await waitForVisibleDropdownOptions(page, { timeout: 1500 }).catch(() => null);
  if (expectedPlaceholder && !(await visibleDropdownOptionTexts(page)).length) {
    await forceOpenDropdownForPlaceholder(page, expectedPlaceholder);
    await waitForVisibleDropdownOptions(page, { timeout: 1500 }).catch(() => null);
  }

  if (String(searchValue || "").trim()) {
    try {
      await field.fill(searchValue, { timeout: 2000 });
      await waitForVisibleDropdownOptions(page, { timeout: 2500 }).catch(() => null);
      return true;
    } catch {
      // Mantine sometimes exposes a button/combobox wrapper rather than a fillable input.
    }
  }

  if (!String(searchValue || "").trim()) {
    const visibleOptions = await visibleDropdownOptionTexts(page);
    return visibleOptions.length > 0;
  }

  const filledFocusedInput = await page.evaluate(({ value, key }) => {
    const tagged = document.querySelector(`[data-clearedge-active-dropdown-field="${key}"]`);
    const active = document.activeElement;

    if (!tagged || !active) {
      return false;
    }

    const taggedWrapper = tagged.closest(".mantine-InputWrapper-root, [class*='InputWrapper'], [data-combobox-target], [role='combobox']") || tagged;
    const activeWrapper = active.closest(".mantine-InputWrapper-root, [class*='InputWrapper'], [data-combobox-target], [role='combobox']") || active;
    const belongsToTaggedField = active === tagged ||
      tagged.contains(active) ||
      activeWrapper === taggedWrapper ||
      taggedWrapper.contains(active);

    if (!belongsToTaggedField) {
      return false;
    }

    const editable = active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active.isContentEditable;

    if (!editable) {
      return false;
    }

    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      active.value = "";
      active.dispatchEvent(new Event("input", { bubbles: true }));
      active.value = value;
      active.dispatchEvent(new Event("input", { bubbles: true }));
      active.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    active.textContent = value;
    active.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, { value: searchValue, key: fieldKey }).catch(() => false);

  if (filledFocusedInput) {
    await waitForVisibleDropdownOptions(page, { timeout: 2500 }).catch(() => null);
    return true;
  }

  const visibleOptions = await visibleDropdownOptionTexts(page);
  return visibleOptions.length > 0;
}

async function forceOpenDropdownForPlaceholder(page, expectedPlaceholder = "") {
  if (!expectedPlaceholder) {
    return false;
  }

  return page.evaluate((placeholder) => {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const expected = normalize(placeholder);
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    };
    const input = [...document.querySelectorAll("input:not([type='hidden'])")]
      .filter(visible)
      .find((element) => normalize(element.getAttribute("placeholder")) === expected);

    if (!input) {
      return false;
    }

    const targets = [
      input,
      input.closest("[role='combobox']"),
      input.closest("[data-combobox-target]"),
      input.closest(".mantine-Input-root, [class*='Input-root']")
    ].filter(Boolean);

    input.scrollIntoView({ block: "center", inline: "center" });
    input.focus();

    for (const target of targets) {
      for (const eventName of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        target.dispatchEvent(new MouseEvent(eventName, {
          bubbles: true,
          cancelable: true,
          view: window
        }));
      }
    }

    return true;
  }, expectedPlaceholder).catch(() => false);
}

async function clickDropdownOptionByLocator(page, { value = "", disambiguator = "", allowContains = true } = {}) {
  const candidates = dropdownValueCandidates(value);
  const selector = ".mantine-Combobox-option, .mantine-Select-option, .mantine-MultiSelect-option, .mantine-Select-item, .mantine-MultiSelect-item, [role='option']";

  await waitForVisibleDropdownOptions(page, { timeout: 2000 }).catch(() => null);

  for (const candidate of candidates) {
    const escaped = escapeRegExp(candidate);
    const exactPattern = new RegExp(`^\\s*${escaped}\\s*$`, "i");
    const containsPattern = new RegExp(escaped, "i");
    const locators = [
      page.getByRole("option", { name: exactPattern }).last(),
      page.locator(selector).filter({ hasText: exactPattern }).last()
    ];

    if (allowContains) {
      locators.push(
        page.getByRole("option", { name: containsPattern }).last(),
        page.locator(selector).filter({ hasText: containsPattern }).last()
      );
    }

    for (const locator of locators) {
      try {
        if (!(await locator.count())) {
          continue;
        }

        const text = (await locator.innerText({ timeout: 1000 }).catch(() => "")).replace(/\s+/g, " ").trim();

        if (!dropdownSelectionMatches({
          expected: value,
          actual: text,
          disambiguator,
          allowContains
        })) {
          continue;
        }

        if (!(await locator.isVisible({ timeout: 800 }).catch(() => false))) {
          continue;
        }

        await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => null);
        await locator.click({ timeout: 4000 }).catch(async () => locator.click({ timeout: 2500, force: true }));
        return {
          clicked: true,
          selectedText: text,
          visibleOptions: await visibleDropdownOptionTexts(page),
          locatorClicked: true
        };
      } catch {
        // Try the next option locator.
      }
    }
  }

  return {
    clicked: false,
    visibleOptions: await visibleDropdownOptionTexts(page)
  };
}

async function waitForVisibleDropdownOptions(page, { timeout = 1500 } = {}) {
  await page.waitForFunction(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    };

    return [...document.querySelectorAll([
      "[role='option']",
      ".mantine-Combobox-option",
      ".mantine-Select-option",
      ".mantine-MultiSelect-option",
      ".mantine-Select-item",
      ".mantine-MultiSelect-item"
    ].join(","))].some(visible);
  }, { timeout });
}

async function clickVisibleDropdownOption(page, { value = "", disambiguator = "", allowContains = true } = {}) {
  const text = String(value ?? "").trim();

  if (!text) {
    return {
      clicked: false,
      visibleOptions: []
    };
  }

  const values = dropdownValueCandidates(text);
  const optionKey = `clearedge-option-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const result = await page.evaluate((args) => {
    const normalize = (input) => String(input || "").replace(/\s+/g, " ").trim().toLowerCase();
    const normalizeMatch = (input) => String(input || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .replace(/\bco\.\s*,?\s*ltd\.?\b/gi, "co ltd")
      .replace(/\bco\.\b/gi, "co")
      .replace(/\bltd\.\b/gi, "ltd")
      .replace(/\binc\.\b/gi, "inc")
      .replace(/[^a-z0-9]+/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const optionParts = (optionText = "") => [
      String(optionText || ""),
      ...String(optionText || "").split(/[|;\n]+/),
      ...String(optionText || "").split(/[|;\n]+/).map((part) => part.replace(/^[^:]{1,30}:\s*/, ""))
    ]
      .map((part) => part.trim())
      .filter(Boolean);
    const scoreOption = (optionText = "") => {
      const needles = (args.values || [args.value]).map(normalizeMatch).filter(Boolean);
      const option = normalizeMatch(optionText);
      const disambiguationNeedle = normalizeMatch(args.disambiguator);

      if (!needles.length || !option) {
        return 0;
      }

      let score = Math.max(0, ...needles.map((needle) => {
        const parts = optionParts(optionText).map(normalizeMatch).filter(Boolean);
        const partMatches = parts.some((part) => part === needle);
        const partStarts = parts.some((part) => part.startsWith(`${needle} `));
        const optionContains = option.includes(needle);
        const needleTokens = needle.split(" ").filter((token) => token.length > 1);
        const optionTokens = new Set(option.split(" ").filter(Boolean));
        const tokenCoverage = needleTokens.length >= 2 && needleTokens.every((token) => optionTokens.has(token));

        if (option === needle) {
          return 100;
        }

        if (partMatches) {
          return 96;
        }

        if (partStarts) {
          return 92;
        }

        if (args.allowContains && optionContains) {
          return 88;
        }

        if (args.allowContains && tokenCoverage) {
          return 82;
        }

        return 0;
      }));

      if (score && disambiguationNeedle && option.includes(disambiguationNeedle)) {
        score += 4;
      }

      return score;
    };
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    };
    const optionSelector = [
      "[role='option']",
      ".mantine-Combobox-option",
      ".mantine-Select-item",
      ".mantine-MultiSelect-item"
    ].join(",");
    const dropdownSelector = [
      "[role='listbox']",
      "[data-combobox-dropdown]",
      ".mantine-Combobox-dropdown",
      ".mantine-Popover-dropdown",
      "[class*='Combobox-dropdown']",
      "[class*='Popover-dropdown']",
      "[class*='Select-dropdown']",
      "[class*='MultiSelect-dropdown']"
    ].join(",");
    const optionEntries = (root) => [...root.querySelectorAll(optionSelector)]
      .filter(visible)
      .map((element) => ({
        element,
        text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim()
      }))
      .filter((option) => option.text);
    const activeDropdowns = [...document.querySelectorAll(dropdownSelector)]
      .filter(visible)
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
        options: optionEntries(element)
      }))
      .filter((entry) => entry.options.length)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const needles = (args.values || [args.value]).map(normalize).filter(Boolean);
    const disambiguator = normalize(args.disambiguator);
    const scopedOptions = activeDropdowns.at(-1)?.options ?? [];
    const elements = scopedOptions.length ? scopedOptions : optionEntries(document);
    const exactMatches = elements.filter((option) => needles.some((needle) => normalize(option.text) === needle));
    const containsMatches = elements.filter((option) => needles.some((needle) => normalize(option.text).includes(needle)));
    const scoredMatches = elements
      .map((option) => ({
        ...option,
        score: scoreOption(option.text)
      }))
      .filter((option) => option.score >= 82)
      .sort((a, b) => b.score - a.score || a.text.length - b.text.length);
    const disambiguated = disambiguator
      ? scoredMatches.filter((option) => normalize(option.text).includes(disambiguator))
      : [];
    const candidate = exactMatches[0] ??
      (disambiguated.length === 1 ? disambiguated[0] : null) ??
      scoredMatches[0] ??
      (args.allowContains && containsMatches.length === 1 ? containsMatches[0] : null);

    if (candidate) {
      candidate.element.scrollIntoView({ block: "center", inline: "center" });
      candidate.element.setAttribute("data-clearedge-dropdown-option", args.optionKey);
      return {
        clicked: false,
        candidateKey: args.optionKey,
        selectedText: candidate.text,
        visibleOptions: elements.map((option) => option.text).slice(0, 20),
        matchCount: scoredMatches.length || exactMatches.length || containsMatches.length,
        matchScore: candidate.score ?? 100
      };
    }

    return {
      clicked: false,
      visibleOptions: elements.map((option) => option.text).slice(0, 20),
      matchCount: scoredMatches.length || exactMatches.length || containsMatches.length
    };
  }, {
    value: text,
    values,
    disambiguator,
    allowContains,
    optionKey
  });

  if (!result.candidateKey) {
    return result;
  }

  const option = page.locator(`[data-clearedge-dropdown-option="${optionKey}"]`).first();

  try {
    await option.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => null);
    await option.click({ timeout: 4000 });

    return {
      ...result,
      clicked: true
    };
  } catch (error) {
    try {
      await option.click({ timeout: 2500, force: true });

      return {
        ...result,
        clicked: true,
        forced: true
      };
    } catch {
      const jsClicked = await page.evaluate((key) => {
        const element = document.querySelector(`[data-clearedge-dropdown-option="${key}"]`);

        if (!element) {
          return false;
        }

        element.scrollIntoView({ block: "center", inline: "center" });
        for (const eventName of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          element.dispatchEvent(new MouseEvent(eventName, {
            bubbles: true,
            cancelable: true,
            view: window
          }));
        }
        return true;
      }, optionKey).catch(() => false);

      if (jsClicked) {
        await page.waitForTimeout(150).catch(() => null);
        return {
          ...result,
          clicked: true,
          jsClicked: true
        };
      }

      return {
        ...result,
        clicked: false,
        clickError: compactErrorText(error?.message || String(error))
      };
    }
  }
}

async function verifySearchOptionSelection(field, { value = "", selectedText = "", disambiguator = "" } = {}) {
  await field.page().waitForTimeout(250).catch(() => null);
  const snapshot = await field.evaluate((input) => {
    const root = input.closest(".mantine-InputWrapper-root, [class*='InputWrapper'], .mantine-Select-root, .mantine-MultiSelect-root, .mantine-Combobox-root") ||
      input.closest("[data-combobox-target]") ||
      input.closest("label, div") ||
      input.parentElement;
    const rootText = root ? (root.innerText || root.textContent || "").replace(/\s+/g, " ").trim() : "";
    const descendantValues = root
      ? [...root.querySelectorAll("input, textarea")]
          .map((element) => element.value || element.getAttribute("value") || "")
          .filter(Boolean)
      : [];
    const ancestorTexts = [];
    let ancestor = input.parentElement;

    for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
      const text = (ancestor.innerText || ancestor.textContent || "").replace(/\s+/g, " ").trim();

      if (text && text.length <= 300) {
        ancestorTexts.push(text);
      }
    }

    return {
      value: input.value || input.getAttribute("value") || "",
      text: rootText,
      ariaValueText: input.getAttribute("aria-valuetext") || "",
      title: input.getAttribute("title") || "",
      placeholder: input.getAttribute("placeholder") || "",
      descendantValues,
      ancestorTexts
    };
  }).catch(() => ({
    value: "",
    text: "",
    ariaValueText: "",
    title: "",
    placeholder: ""
  }));
  const actualValues = [
    snapshot.value,
    ...(snapshot.descendantValues ?? []),
    snapshot.text,
    ...(snapshot.ancestorTexts ?? []),
    snapshot.ariaValueText,
    snapshot.title,
    selectedText
  ].filter(Boolean);
  const matched = actualValues.find((actual) => dropdownSelectionMatches({
    expected: value,
    actual,
    disambiguator
  }));

  return {
    ok: Boolean(matched),
    source: matched ? "field_snapshot" : "",
    actual: matched || snapshot.value || snapshot.text || selectedText || "",
    snapshot
  };
}

async function clickVisibleDropdownOptionWithRetry(page, {
  value = "",
  disambiguator = "",
  allowContains = true,
  attempts = 8,
  delayMs = 350,
  manualAssistCheckpoint = null
} = {}) {
  let lastResult = {
    clicked: false,
    visibleOptions: []
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const assisted = manualAssistCheckpoint
      ? await waitForManualAssistIfRequested(page, manualAssistSubmissionFor(), manualAssistCheckpoint)
      : false;

    if (assisted) {
      return {
        clicked: true,
        manualAssist: true,
        attempt: attempt + 1
      };
    }

    lastResult = await clickDropdownOptionByLocator(page, {
      value,
      disambiguator,
      allowContains
    });

    if (lastResult.clicked) {
      return {
        ...lastResult,
        attempt: attempt + 1
      };
    }

    lastResult = await clickVisibleDropdownOption(page, {
      value,
      disambiguator,
      allowContains
    });

    if (lastResult.clicked) {
      return {
        ...lastResult,
        attempt: attempt + 1
      };
    }

    await page.waitForTimeout(delayMs).catch(() => null);
  }

  return lastResult;
}

async function selectSearchOption(root, { label, placeholder, value, strict = false, disambiguator = "", attempts = 2, search = true } = {}) {
  const text = String(value ?? "").trim();

  if (!text) {
    return false;
  }

  let lastError = null;
  const manualAssistCheckpoint = manualAssistCheckpointForDropdown({ label, placeholder, value: text });

  if (await waitForManualAssistIfRequested(root.page(), manualAssistSubmissionFor(), manualAssistCheckpoint)) {
    return true;
  }

  const requiredField = strict ? await waitForSearchField(root, { label, placeholder, timeout: 5000 }) : null;
  const candidates = requiredField ? [requiredField] : await searchFieldCandidates(root, { label, placeholder });

  const searchValues = search ? dropdownValueCandidates(text) : [""];

  for (const field of candidates) {
    try {
      if (!(await field.count())) {
        continue;
      }

      for (const searchValue of searchValues) {
        const opened = await openAndSearchDropdownField(field, searchValue, {
          expectedPlaceholder: placeholder
        });

        if (!opened) {
          continue;
        }

        await root.page().waitForTimeout(250);
        const optionResult = await clickVisibleDropdownOptionWithRetry(root.page(), {
          value: text,
          disambiguator,
          allowContains: true,
          attempts,
          manualAssistCheckpoint
        });

        if (optionResult.clicked) {
          const verification = optionResult.manualAssist
            ? { ok: true, source: "manual_assist" }
            : await verifySearchOptionSelection(field, {
                value: text,
                selectedText: optionResult.selectedText,
                disambiguator
              });

          if (verification.ok) {
            await closeOpenDropdowns(root.page()).catch(() => null);
            return true;
          }

          if (strict) {
            const visibleOptions = optionResult.visibleOptions?.length
              ? optionResult.visibleOptions
              : await visibleDropdownOptionTexts(root.page());
            const reason = `ShelfCycle selected "${optionResult.selectedText || "an option"}" for "${text}", but the field did not verify after selection.`;
            const assisted = await waitForManualAssistIfRequested(root.page(), manualAssistSubmissionFor(), {
              ...manualAssistCheckpoint,
              reason,
              visibleOptions
            }, {
              force: true
            });

            if (assisted) {
              return true;
            }

            throw new Error(`${reason} Visible options: ${visibleOptions.slice(0, 8).join(", ") || "none"}.`);
          }
        }
      }

      if (strict) {
        const visibleOptions = await visibleDropdownOptionTexts(root.page());
        const reason = `ShelfCycle did not show a selectable option for "${text}" in ${manualAssistCheckpoint.field}.`;
        const assisted = await waitForManualAssistIfRequested(root.page(), manualAssistSubmissionFor(), {
          ...manualAssistCheckpoint,
          reason,
          visibleOptions
        }, {
          force: true
        });

        if (assisted) {
          return true;
        }

        throw new Error(`${reason} Visible options: ${visibleOptions.slice(0, 8).join(", ") || "none"}.`);
      }

      await closeOpenDropdowns(root.page()).catch(() => null);
      return false;
    } catch (error) {
      lastError = error;
      await closeOpenDropdowns(root.page()).catch(() => null);
      // Try next selector.
    }
  }

  if (strict && lastError) {
    const assisted = await waitForManualAssistIfRequested(root.page(), manualAssistSubmissionFor(), {
      ...manualAssistCheckpoint,
      reason: compactErrorText(lastError?.message || String(lastError))
    }, {
      force: true
    });

    if (assisted) {
      return true;
    }

    throw lastError;
  }

  if (strict) {
    const assisted = await waitForManualAssistIfRequested(root.page(), manualAssistSubmissionFor(), {
      ...manualAssistCheckpoint,
      reason: `Could not locate the required ShelfCycle dropdown field for "${text}".`
    }, {
      force: true
    });

    if (assisted) {
      return true;
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
      // Do not press Escape here: Mantine dialogs treat Escape as modal close,
      // which was closing the Product Code form before the adjacent add button
      // could create a new Product Family.
      await root.page().waitForTimeout(150).catch(() => null);
    }
  }

  await closeOpenDropdowns(root.page()).catch(() => null);
  return selectedCount;
}

async function selectExactPlaceholderOption(root, { placeholder = "", value = "", strict = false, disambiguator = "", attempts = 4 } = {}) {
  const text = String(value || "").trim();

  if (!text) {
    return false;
  }

  const page = root.page();
  const field = root.getByPlaceholder(placeholderRegex(placeholder)).first();
  const manualAssistCheckpoint = manualAssistCheckpointForDropdown({
    label: placeholder,
    placeholder,
    value: text
  });

  if (await field.count().catch(() => 0)) {
    const currentValue = await field.inputValue({ timeout: 1000 }).catch(() => "");

    if (dropdownSelectionMatches({
      expected: text,
      actual: currentValue,
      disambiguator
    })) {
      return true;
    }
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (!(await field.count())) {
        break;
      }

      await closeOpenDropdowns(page).catch(() => null);
      await field.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => null);
      await field.click({ timeout: 3000 }).catch(async () => field.click({ timeout: 2500, force: true }));
      await waitForVisibleDropdownOptions(page, { timeout: 2500 }).catch(() => null);
      let result = await clickDropdownOptionByLocator(page, {
        value: text,
        disambiguator,
        allowContains: true
      });

      if (!result.clicked) {
        await forceOpenDropdownForPlaceholder(page, placeholder);
        await waitForVisibleDropdownOptions(page, { timeout: 2500 }).catch(() => null);
        result = await clickDropdownOptionByLocator(page, {
          value: text,
          disambiguator,
          allowContains: true
        });
      }

      if (result.clicked) {
        const verification = await verifySearchOptionSelection(field, {
          value: text,
          selectedText: result.selectedText,
          disambiguator
        });

        if (verification.ok) {
          await closeOpenDropdowns(page).catch(() => null);
          return true;
        }
      }
    } catch {
      // Retry exact-placeholder selection; Mantine can detach dropdown rows during animation.
    }

    await page.waitForTimeout(350).catch(() => null);
  }

  if (strict) {
    const visibleOptions = await visibleDropdownOptionTexts(page);
    const assisted = await waitForManualAssistIfRequested(page, manualAssistSubmissionFor(), {
      ...manualAssistCheckpoint,
      reason: `Could not select "${text}" from the exact ShelfCycle field "${placeholder}".`,
      visibleOptions
    }, {
      force: true
    });

    if (assisted) {
      return true;
    }

    throw new Error(`ShelfCycle did not show a selectable option for "${text}" in ${placeholder}. Visible options: ${visibleOptions.slice(0, 8).join(", ") || "none"}.`);
  }

  return false;
}

async function closeOpenDropdowns(page) {
  await page.evaluate(() => {
    const active = document.activeElement;

    if (active instanceof HTMLElement) {
      active.blur();
    }
  }).catch(() => null);
  await page.waitForTimeout(150).catch(() => null);
}

async function visibleDropdownOptionTexts(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    };
    const optionSelector = [
      "[role='option']",
      ".mantine-Combobox-option",
      ".mantine-Select-option",
      ".mantine-MultiSelect-option",
      ".mantine-Select-item",
      ".mantine-MultiSelect-item"
    ].join(",");
    const dropdownSelector = [
      "[role='listbox']",
      "[data-combobox-dropdown]",
      ".mantine-Combobox-dropdown",
      ".mantine-Popover-dropdown",
      "[class*='Combobox-dropdown']",
      "[class*='Popover-dropdown']",
      "[class*='Select-dropdown']",
      "[class*='MultiSelect-dropdown']"
    ].join(",");
    const optionTexts = (root) => [...root.querySelectorAll(optionSelector)]
      .filter(visible)
      .map((element) => (element.innerText || element.textContent || "").trim())
      .filter(Boolean);
    const dropdowns = [...document.querySelectorAll(dropdownSelector)]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();

        return {
          element,
          rect,
          values: optionTexts(element)
        };
      })
      .filter((entry) => entry.values.length)
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const activeValues = dropdowns.at(-1)?.values ?? optionTexts(document);
    const seen = new Set();
    const values = [];

    for (const text of activeValues) {
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
  activateManualAssistSubmission(submission);
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
  activateManualAssistSubmission(submission);
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

    const contactLabel = submission.fields.name || submission.fields.email;
    await saveOpenDialog(page, dialog, {
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

export function locationTargetKindFromSubmission(submission = {}) {
  const companyType = String(submission.fields?.companyType || "").toLowerCase();

  if (submission.supplierId || submission.supplierName || companyType.includes("supplier")) {
    return "supplier";
  }

  return "customer";
}

export async function submitShelfCycleLocation(submission = {}) {
  activateManualAssistSubmission(submission);
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    const fields = submission.fields ?? {};
    const targetKind = locationTargetKindFromSubmission(submission);
    const targetName = targetKind === "supplier" ? submission.supplierName : submission.customerName;
    const targetId = targetKind === "supplier" ? submission.supplierId : submission.customerId;
    let companyUrl = "";

    if (targetId) {
      companyUrl = `https://app.shelfcycle.com/org-clearedge/${targetKind === "supplier" ? "suppliers" : "customers"}/${targetId}`;
    } else {
      companyUrl = await resolveCompanyRecordUrl(page, {
        kind: targetKind,
        name: targetName
      });
    }

    if (!companyUrl || !companyUrl.includes(`/${targetKind === "supplier" ? "suppliers" : "customers"}/`)) {
      throw new Error(`Could not resolve a ${targetKind} page for ${targetName || "the selected company"}.`);
    }

    const targetUrl = `${companyUrl.replace(/\/+$/, "")}/${targetKind === "supplier" ? "locations" : "addresses"}`;
    await page.goto(safeShelfCycleUrl(targetUrl), { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await dismissCommonPopups(page);

    await clickNewRecordButton(page, targetKind === "supplier" ? "Location" : "Shipping Address");
    const dialog = page.getByRole("dialog").last();
    await dialog.waitFor({ timeout: 10000 });

    await fillLocationDialogFields(dialog, fields, targetKind);
    await saveOpenDialog(page, dialog, {
      recordName: fields.name,
      actionLabel: targetKind === "supplier" ? "save supplier location" : "save customer shipping address"
    });

    const locationPattern = new RegExp(escapeRegExp(fields.name), "i");
    let locationVisible = await page.getByText(locationPattern).first().isVisible({ timeout: 8000 }).catch(() => false);

    if (!locationVisible) {
      await page.goto(safeShelfCycleUrl(targetUrl), { waitUntil: "domcontentloaded" });
      await dismissCommonPopups(page);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
      locationVisible = await page.getByText(locationPattern).first().isVisible({ timeout: 8000 }).catch(() => false);
    }

    if (!locationVisible) {
      throw new Error(`ShelfCycle did not show the created location "${fields.name}" after save.`);
    }

    return {
      ok: true,
      recordType: targetKind === "supplier" ? "supplier_location" : "customer_address",
      customerId: targetKind === "customer" ? (targetId || parseShelfCycleRecordId(companyUrl, "customer")) : "",
      customerName: targetKind === "customer" ? targetName : "",
      supplierId: targetKind === "supplier" ? (targetId || parseShelfCycleRecordId(companyUrl, "supplier")) : "",
      supplierName: targetKind === "supplier" ? targetName : "",
      name: fields.name,
      savedAtUrl: page.url()
    };
  } finally {
    await context.close();
  }
}

async function fillLocationDialogFields(dialog, fields = {}, targetKind = "customer") {
  await fillFieldByLabel(dialog, /^name\b/i, fields.name);
  await fillFieldByLabel(dialog, /^email\b/i, fields.email);
  await fillFieldByLabel(dialog, /phone number/i, fields.phoneNumber || fields.phone);
  await fillFieldByLabel(dialog, /^street address$/i, fields.streetAddress || fields.street1);
  await fillFieldByLabel(dialog, /street address 2/i, fields.streetAddress2 || fields.street2);
  await fillFieldByLabel(dialog, /^city\b/i, fields.city);
  await fillFieldByLabel(dialog, /state|region/i, fields.stateRegion);
  await fillFieldByLabel(dialog, /^zip\b|postal/i, fields.zip);
  await selectSearchOption(dialog, companyDropdown("country", { value: fields.country }));

  if (targetKind === "customer") {
    await fillFieldByLabel(dialog, /default shipping instructions/i, fields.defaultShippingInstructions);
  }
}

function productCodeDropdown(key, overrides = {}) {
  return shelfCycleDropdownArgs(SHELFCYCLE_PRODUCT_CODE_FIELDS, key, overrides);
}

function productFamilyDropdown(key, overrides = {}) {
  return shelfCycleDropdownArgs(SHELFCYCLE_PRODUCT_FAMILY_FIELDS, key, overrides);
}

function companyDropdown(key, overrides = {}) {
  return shelfCycleDropdownArgs(SHELFCYCLE_COMPANY_DROPDOWN_FIELDS, key, overrides);
}

async function guardProductCodeField(dialog, expectedCode = "", phase = "product code entry") {
  const code = String(expectedCode || "").trim();

  if (!code) {
    return;
  }

  const placeholder = shelfCycleTextPlaceholder(SHELFCYCLE_PRODUCT_CODE_FIELDS, "code");
  const field = dialog.locator(`input[placeholder="${placeholder}"]`).first();

  if (!(await field.count().catch(() => 0))) {
    return;
  }

  const actual = String(await field.inputValue({ timeout: 1000 }).catch(() => "") || "").trim();

  if (!actual || actual === code) {
    return;
  }

  await field.fill(code).catch(() => null);
  throw new Error(`Safety stop during ${phase}: ShelfCycle Code field was changed to "${actual}". It was restored to "${code}", and automation stopped instead of continuing with a corrupted product code.`);
}

async function productCodeDryRunSnapshot(dialog) {
  return dialog.evaluate((root) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    };
    const labelFor = (input) => {
      const id = input.getAttribute("id");
      const explicit = id ? root.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText : "";
      const wrapper = input.closest(".mantine-InputWrapper-root, [class*='InputWrapper'], label, [data-combobox-target], [role='group']");
      const text = wrapper ? (wrapper.innerText || wrapper.textContent || "") : "";

      return [explicit, input.getAttribute("placeholder"), text]
        .filter(Boolean)
        .join(" | ")
        .replace(/\s+/g, " ")
        .trim();
    };

    return [...root.querySelectorAll("input:not([type='hidden']), textarea")]
      .filter(visible)
      .map((input) => ({
        label: labelFor(input).slice(0, 180),
        placeholder: input.getAttribute("placeholder") || "",
        value: input.value || input.getAttribute("value") || ""
      }));
  }).catch(() => []);
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
  activateManualAssistSubmission(submission);
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
  activateManualAssistSubmission(submission);
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    const fields = submission.fields ?? {};

    await page.goto(safeShelfCycleUrl(submission.url || "https://app.shelfcycle.com/org-clearedge/customers"), { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await dismissCommonPopups(page);

    await clickNewRecordButton(page, "Customer");
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
    await selectSearchOption(dialog, companyDropdown("country", { value: fields.country }));
    await fillFieldByLabel(dialog, /credit limit/i, fields.creditLimit);
    await selectSearchOption(dialog, companyDropdown("customerPaymentTerm", { value: fields.paymentTerm }));
    await selectSearchOption(dialog, companyDropdown("defaultSalesPerson", { value: fields.defaultSalesPerson }));
    await selectSearchOption(dialog, companyDropdown("defaultCsr", { value: fields.defaultCsr }));
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
  activateManualAssistSubmission(submission);
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    const fields = submission.fields ?? {};

    await page.goto(safeShelfCycleUrl(submission.url || "https://app.shelfcycle.com/org-clearedge/suppliers"), { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await dismissCommonPopups(page);

    const existingSupplierUrl = await findExistingCompanyRecordUrlBeforeCreate(page, {
      kind: "supplier",
      name: fields.name,
      listUrl: "https://app.shelfcycle.com/org-clearedge/suppliers"
    });

    if (existingSupplierUrl) {
      throw new Error(`ShelfCycle already has supplier ${fields.name}. Use Update existing supplier instead of creating a duplicate. Existing supplier URL: ${existingSupplierUrl}`);
    }

    await page.goto(safeShelfCycleUrl(submission.url || "https://app.shelfcycle.com/org-clearedge/suppliers"), { waitUntil: "domcontentloaded" });
    await dismissCommonPopups(page);
    await clickNewRecordButton(page, "Supplier");
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
  await selectSearchOption(dialog, companyDropdown("country", { value: fields.country }));
  await fillFieldByLabel(dialog, /state|region/i, fields.stateRegion);
  await fillFieldByLabel(dialog, /^zip\b|postal/i, fields.zip);
  await selectSearchOption(dialog, companyDropdown("supplierPaymentTerms", { value: fields.paymentTerms }));
  await fillFieldByLabel(dialog, /credit limit/i, fields.creditLimit);
  await fillFieldByLabel(dialog, /ach routing/i, fields.achRoutingNumber);
  await fillFieldByLabel(dialog, /ach account/i, fields.achAccountNumber);
  await selectSearchOption(dialog, companyDropdown("costAccount", { value: fields.costAccount }));
  await selectSearchOption(dialog, companyDropdown("preferredUnitOfMeasure", { value: fields.preferredUnitOfMeasure }));
  await selectSearchOption(dialog, companyDropdown("defaultSupplierRep", { value: fields.defaultSupplierRep }));
}

export async function submitShelfCycleSupplierUpdate(submission = {}) {
  activateManualAssistSubmission(submission);
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
  activateManualAssistSubmission(submission);
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

async function fillProductFamilyDialogFields(dialog, fields = {}) {
  await fillFieldByLabel(dialog, /^name\b|product family/i, fields.productFamily || fields.name);
  await fillFieldByLabel(dialog, /^description\b|product family description/i, fields.productFamilyDescription || fields.description);
  await fillFieldByLabel(dialog, /chemical name/i, fields.chemicalName);
  await fillFieldByLabel(dialog, /aliases?/i, fields.aliases);
  await fillFieldByLabel(dialog, /cas number/i, fields.casNumber);
  await selectSearchOption(dialog, productCodeDropdown("unNumber", { value: normalizeUnNumberDropdownValue(fields.unNumber), attempts: 2 }));
  await selectSearchOption(dialog, productCodeDropdown("packingGroup", { value: normalizePackingGroupDropdownValue(fields.packingGroup, fields), attempts: 2 }));
  await selectSearchOptions(dialog, productCodeDropdown("hazardClass", { values: normalizeHazardClassDropdownValues(fields.hazardClass) }));
  await selectSearchOptions(dialog, productCodeDropdown("specialDesignation", { values: isNonRegulatedTransportValue(fields.specialDesignation) ? [] : splitOptionValues(fields.specialDesignation) }));
  await fillFieldByLabel(dialog, /proper shipping name/i, fields.properShippingName);
  await selectSearchOption(dialog, productCodeDropdown("signalWord", { value: fields.signalWord }));
  await selectSearchOptions(dialog, productCodeDropdown("hazardSymbols", { values: splitOptionValues(fields.hazardSymbols) }));
  await fillFieldByLabel(dialog, /physical state/i, fields.physicalState);
  await fillFieldByLabel(dialog, /appearance/i, fields.appearance);
  await fillFieldByLabel(dialog, /density/i, fields.density);
  await fillFieldByLabel(dialog, /specific gravity/i, fields.specificGravity);
  await fillFieldByLabel(dialog, /viscosity/i, fields.viscosity);
  await fillFieldByLabel(dialog, /flash point/i, fields.flashPoint);
  await fillFieldByLabel(dialog, /boiling point/i, fields.boilingPoint);
  await fillFieldByLabel(dialog, /storage/i, fields.storage);
  await fillFieldByLabel(dialog, /shelf life/i, fields.shelfLife);
  await fillFieldByLabel(dialog, /recommended use/i, fields.recommendedUse);
  await fillFieldByLabel(dialog, /document date/i, fields.documentDate);
}

async function fillNestedProductFamilyDialogFields(dialog, fields = {}) {
  await fillFieldByLabel(dialog, /^name\b/i, fields.productFamily || fields.name);
  await selectSearchOption(dialog, productFamilyDropdown("supplier", { value: fields.supplier }));
  await fillFieldByLabel(dialog, /molecular formula/i, fields.molecularFormula || fields.formula);
  await selectSearchOptions(dialog, productFamilyDropdown("unNumber", { values: splitOptionValues(normalizeUnNumberDropdownValue(fields.unNumber)) }));
  await selectSearchOption(dialog, productFamilyDropdown("signalWord", { value: fields.signalWord }));
  await fillFieldByLabel(dialog, /cas number/i, fields.casNumber);

  if (fields.sdsPath) {
    await dialog.locator('input[type="file"]').first().setInputFiles(fields.sdsPath).catch(() => null);
  }

  await selectSearchOption(dialog, productFamilyDropdown("superfundTaxType", { value: fields.superfundTaxType }));
  await selectSearchOptions(dialog, productFamilyDropdown("hazardSymbols", { values: splitOptionValues(fields.hazardSymbols) }));
}

async function selectExistingSearchOption(root, { label, placeholder, value, disambiguator = "", attempts = 12 } = {}) {
  return selectSearchOption(root, {
    label,
    placeholder,
    value,
    disambiguator,
    attempts
  });
}

async function productCodeDialog(page) {
  const dialog = page.locator("[role='dialog']").filter({ hasText: /Product Code/i }).last();
  await dialog.waitFor({ timeout: 10000 });
  return dialog;
}

async function taggedVisibleDialogByText(page, pattern, description = "dialog") {
  const key = `clearedge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const result = await page.waitForFunction((args) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
    };
    const regex = new RegExp(args.source, args.flags);
    const matches = [...document.querySelectorAll("[role='dialog']")]
      .filter(visible)
      .map((dialog) => ({
        dialog,
        text: (dialog.innerText || dialog.textContent || "").replace(/\s+/g, " ").trim()
      }))
      .filter((entry) => regex.test(entry.text));
    const match = matches.at(-1);

    if (!match) {
      return null;
    }

    match.dialog.setAttribute("data-clearedge-dialog-key", args.key);
    return {
      ok: true,
      text: match.text.slice(0, 300),
      visibleDialogCount: matches.length
    };
  }, {
    key,
    source: pattern.source,
    flags: pattern.flags
  }, {
    timeout: 10000
  }).catch(() => null);

  if (!result) {
    const visibleDialogs = await page.locator("[role='dialog']").evaluateAll((dialogs) => dialogs.map((dialog) => {
      const rect = dialog.getBoundingClientRect();
      const style = window.getComputedStyle(dialog);

      return {
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden",
        text: (dialog.innerText || dialog.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300)
      };
    })).catch(() => []);
    throw new Error(`Could not find the visible ShelfCycle ${description}. Visible dialogs: ${compactErrorText(JSON.stringify(visibleDialogs))}`);
  }

  const dialog = page.locator(`[data-clearedge-dialog-key="${key}"]`).first();
  await dialog.waitFor({ state: "visible", timeout: 5000 });
  return dialog;
}

async function nestedProductFamilyDialog(page) {
  return taggedVisibleDialogByText(page, /New Product\s+Name \*/i, "nested Product Family form");
}

async function openNewProductCodeDialog(page, submission = {}, productLabel = "product code") {
  await reportPageProgress(page, submission, `Clicking New Product Code for ${productLabel}.`, {
    phase: "product_code_new_button",
    productCode: productLabel
  });
  await clickShelfCycleButton(page, [
    page.getByRole("button", { name: /^new product code$/i }).last(),
    page.locator("button").filter({ hasText: /^New Product Code$/i }).last()
  ], {
    label: "New Product Code button",
    timeout: 12000
  });

  return productCodeDialog(page);
}

async function ensureProductFamilyForProductCodeDialog(page, dialog, fields = {}, submission = {}) {
  const familyName = fields.productFamily || fields.name || "";

  if (!familyName) {
    return {
      ok: true,
      created: false,
      dryRunComplete: false
    };
  }

  const shouldCreateFamily = fields.ensureProductFamily || fields.productFamilyMode === "create_then_select";
  const selectedExisting = await selectExistingSearchOption(dialog, {
    ...productCodeDropdown("productFamily"),
    value: familyName,
    disambiguator: fields.supplier,
    attempts: 14
  });

  if (selectedExisting) {
    await reportPageProgress(page, submission, `Selected existing Product Family ${familyName}.`, {
      phase: "product_family_selected",
      productFamily: familyName
    });
    return {
      ok: true,
      created: false,
      selected: true,
      dryRunComplete: false
    };
  }

  if (!shouldCreateFamily) {
    throw new Error(`ShelfCycle Product Family "${familyName}" was not found. Approve Product Family creation before creating the Product Code.`);
  }

  await reportPageProgress(page, submission, `Opening nested Product Family form for ${familyName}.`, {
    phase: "product_family_nested_open",
    productFamily: familyName
  });
  await clickInlineAddButtonForField(dialog, {
    label: SHELFCYCLE_PRODUCT_CODE_FIELDS.productFamily.label,
    placeholder: SHELFCYCLE_PRODUCT_CODE_FIELDS.productFamily.placeholder,
    fieldName: "Product Family"
  });

  const familyDialog = await nestedProductFamilyDialog(page);

  await reportPageProgress(page, submission, `Entering nested Product Family fields for ${familyName}.`, {
    phase: "product_family_nested_fill",
    productFamily: familyName
  });
  await fillNestedProductFamilyDialogFields(familyDialog, {
    ...fields,
    productFamily: familyName,
    name: familyName
  });

  if (isSubmissionDryRun(submission)) {
    await reportPageProgress(page, submission, `Dry run complete for nested Product Family ${familyName}. Form was filled but not saved.`, {
      phase: "product_family_nested_dry_run_complete",
      productFamily: familyName
    });
    await holdDryRunOpen(page, submission);
    return {
      ok: true,
      created: false,
      dryRunComplete: true,
      message: "Dry run: nested Product Family form filled but not saved."
    };
  }

  await reportPageProgress(page, submission, `Saving nested Product Family ${familyName}.`, {
    phase: "product_family_nested_save",
    productFamily: familyName
  });
  await saveOpenDialog(page, familyDialog, {
    recordName: familyName,
    actionLabel: "save product family"
  });
  await reportPageProgress(page, submission, `Product Family ${familyName} saved. Selecting it for the Product Code.`, {
    phase: "product_family_nested_saved",
    productFamily: familyName
  });
  await page.waitForTimeout(1500).catch(() => null);

  const productDialog = await productCodeDialog(page).catch(() => dialog);
  const selectedCreated = await selectExistingSearchOption(productDialog, {
    ...productCodeDropdown("productFamily"),
    value: familyName,
    disambiguator: fields.supplier,
    attempts: 20
  });

  if (!selectedCreated) {
    throw new Error(`Product Family ${familyName} was saved but could not be selected on the Product Code form.`);
  }

  return {
    ok: true,
    created: true,
    selected: true,
    dryRunComplete: false
  };
}

async function openProductFamilyDialog(page, fields = {}, submission = {}) {
  const isUpdate = fields.mode === "update" || Boolean(fields.productFamilyId);
  const familyName = fields.productFamily || fields.name || "";

  await reportShelfCycleProgress(submission, `Opening ShelfCycle Product Families for ${familyName || "new family"}.`, {
    phase: "product_family_open"
  });
  await page.goto("https://app.shelfcycle.com/org-clearedge/products?groupBy=PRODUCT_FAMILY", { waitUntil: "domcontentloaded" });
  await focusAgentPage(page);
  await reportPageProgress(page, submission, "Product Family list is open in the visible ShelfCycle browser.", {
    phase: "product_family_list"
  });
  await dismissCommonPopups(page);

  if (familyName) {
    await reportPageProgress(page, submission, `Searching ShelfCycle for existing Product Family: ${familyName}.`, {
      phase: "product_family_search",
      productFamily: familyName
    });
    const familyUrl = await findExistingCompanyRecordUrlBeforeCreate(page, {
      kind: "product",
      name: familyName,
      listUrl: "https://app.shelfcycle.com/org-clearedge/products?groupBy=PRODUCT_FAMILY"
    }).catch(() => "");

    if (familyUrl) {
      await reportShelfCycleProgress(submission, `Found existing Product Family before creating a duplicate. Opening edit form for ${familyName}.`, {
        phase: "product_family_found",
        currentUrl: familyUrl,
        productFamily: familyName
      });
      await page.goto(safeShelfCycleUrl(familyUrl), { waitUntil: "domcontentloaded" });
      await focusAgentPage(page);
      await dismissCommonPopups(page);
      await clickRecordEditButton(page, "product family");
      const dialog = page.getByRole("dialog").last();
      await dialog.waitFor({ timeout: 10000 });
      await reportPageProgress(page, submission, `Product Family edit form is open for ${familyName}.`, {
        phase: "product_family_edit_form",
        productFamily: familyName
      });
      return {
        dialog,
        mode: "update"
      };
    }
  }

  await reportPageProgress(page, submission, `Clicking New Product Family for ${familyName || "new family"}.`, {
    phase: "product_family_new_button",
    productFamily: familyName
  });
  const productCodeForm = await openNewProductCodeDialog(page, submission, familyName || "new family");
  await clickInlineAddButtonForField(productCodeForm, {
    label: SHELFCYCLE_PRODUCT_CODE_FIELDS.productFamily.label,
    placeholder: SHELFCYCLE_PRODUCT_CODE_FIELDS.productFamily.placeholder,
    fieldName: "Product Family"
  });
  const dialog = await nestedProductFamilyDialog(page);
  await reportPageProgress(page, submission, `New Product Family form is open for ${familyName || "new family"}.`, {
    phase: "product_family_create_form",
    productFamily: familyName
  });

  return {
    dialog,
    mode: "create"
  };
}

async function submitShelfCycleProductFamilyOnPage(page, submission = {}) {
  const fields = submission.fields ?? {};
  const familyName = fields.productFamily || fields.name || submission.productFamilyName || "";

  if (!familyName) {
    throw new Error("Product Family name is required before creating a ShelfCycle Product Family.");
  }

  await reportShelfCycleProgress(submission, `Starting Product Family ${submission.productFamilyId ? "update" : "create/verify"}: ${familyName}.`, {
    phase: "product_family_start",
    productFamily: familyName
  });
  const { dialog, mode } = await openProductFamilyDialog(page, {
    ...fields,
    productFamilyId: submission.productFamilyId || ""
  }, submission);

  await reportPageProgress(page, submission, `Entering Product Family fields for ${familyName}.`, {
    phase: "product_family_fill",
    productFamily: familyName
  });
  const productFamilyFields = {
    ...fields,
    productFamily: familyName,
    name: familyName
  };

  if (mode === "create") {
    await fillNestedProductFamilyDialogFields(dialog, productFamilyFields);
  } else {
    await fillProductFamilyDialogFields(dialog, productFamilyFields);
  }

  if (isSubmissionDryRun(submission)) {
    await reportPageProgress(page, submission, `Dry run complete for Product Family ${familyName}. Form was filled but not saved.`, {
      phase: "product_family_dry_run_complete",
      productFamily: familyName,
      mode
    });
    await holdDryRunOpen(page, submission);
    return {
      ok: true,
      dryRun: true,
      recordType: "product_family",
      productFamilyId: submission.productFamilyId || "",
      productFamilyName: familyName,
      mode,
      savedAtUrl: page.url(),
      message: "Dry run: Product Family form filled but not saved."
    };
  }

  await reportPageProgress(page, submission, `Saving Product Family ${familyName}.`, {
    phase: "product_family_save",
    productFamily: familyName,
    mode
  });
  await saveOpenDialog(page, dialog, {
    recordName: familyName,
    actionLabel: mode === "update" ? "update product family" : "save product family"
  });
  await reportPageProgress(page, submission, `Product Family ${familyName} saved.`, {
    phase: "product_family_saved",
    productFamily: familyName,
    mode
  });

  return {
    ok: true,
    recordType: "product_family",
    productFamilyId: submission.productFamilyId || parseShelfCycleRecordId(page.url(), "product"),
    productFamilyName: familyName,
    mode,
    savedAtUrl: page.url()
  };
}

export async function submitShelfCycleProductFamily(submission = {}) {
  submission = {
    ...submission,
    fields: normalizeShelfCycleProductAutomationFields(submission.fields ?? {})
  };
  activateManualAssistSubmission(submission);
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    const result = await submitShelfCycleProductFamilyOnPage(page, submission);

    return result;
  } finally {
    await context.close();
  }
}

export async function submitShelfCycleProductCode(submission = {}) {
  submission = {
    ...submission,
    fields: normalizeShelfCycleProductAutomationFields(submission.fields ?? {})
  };
  activateManualAssistSubmission(submission);
  const fields = submission.fields ?? {};
  const isUpdate = isProductCodeUpdateSubmission(submission);

  if (!isUpdate) {
    const missing = missingShelfCycleProductFields(fields);

    if (missing.length) {
      throw new Error(`Product-code automation preflight failed. Missing required ShelfCycle fields: ${missing.map((field) => field.label).join(", ")}.`);
    }
  }

  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    const productLabel = fields.code || fields.productName || submission.productName || "product code";

    await focusAgentPage(page);
    await reportShelfCycleProgress(submission, `Starting visible ShelfCycle product workflow for ${productLabel}.`, {
      phase: "product_code_start",
      productCode: productLabel,
      mode: isUpdate ? "update" : "create"
    });

    if (isUpdate) {
      await reportShelfCycleProgress(submission, `Opening existing ShelfCycle Product Code for update: ${productLabel}.`, {
        phase: "product_code_update_open",
        productCode: productLabel
      });
    } else {
      await reportShelfCycleProgress(submission, `Opening ShelfCycle Products list to create Product Code: ${productLabel}.`, {
        phase: "product_code_create_open",
        productCode: productLabel
      });
    }
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
    await focusAgentPage(page);
    await reportPageProgress(page, submission, `ShelfCycle Product page is open for ${isUpdate ? "update" : "new Product Code"}.`, {
      phase: "product_code_page_open",
      productCode: productLabel,
      mode: isUpdate ? "update" : "create"
    });
    await dismissCommonPopups(page);

    if (isUpdate) {
      await reportPageProgress(page, submission, `Clicking Edit for Product Code ${productLabel}.`, {
        phase: "product_code_edit_button",
        productCode: productLabel
      });
      await clickRecordEditButton(page, "product");
    } else {
      await openNewProductCodeDialog(page, submission, productLabel);
    }

    const dialog = isUpdate ? page.getByRole("dialog").last() : await productCodeDialog(page);
    await dialog.waitFor({ timeout: 10000 });
    await reportPageProgress(page, submission, `Product Code form is open. Entering package and regulatory fields for ${productLabel}.`, {
      phase: "product_code_form_open",
      productCode: productLabel
    });

    const activeProductCodeDialog = isUpdate ? dialog : await productCodeDialog(page).catch(() => dialog);
    const fillResult = await fillProductCodeDialogFields(activeProductCodeDialog, fields, {
      resolveProductFamily: !isUpdate && Boolean(fields.productFamily),
      submission
    });

    if (fillResult?.dryRunComplete) {
      return {
        ok: true,
        dryRun: true,
        recordType: "product_code",
        productId: "",
        productName: submission.productName || fields.productName || fields.code,
        code: fields.code,
        mode: "create",
        savedAtUrl: page.url(),
        message: fillResult.message || "Dry run: nested Product Family form filled but Product Code was not saved."
      };
    }
    await reportPageProgress(page, submission, `Product Code fields entered for ${productLabel}.`, {
      phase: "product_code_fields_filled",
      productCode: productLabel
    });

    if (fields.sdsPath) {
      await reportPageProgress(page, submission, `Attaching SDS/TDS file for ${productLabel}.`, {
        phase: "product_code_attach_sds",
        productCode: productLabel,
        filePath: fields.sdsPath
      });
      await activeProductCodeDialog.locator('input[type="file"]').first().setInputFiles(fields.sdsPath);
    }

    if (isSubmissionDryRun(submission)) {
      const dryRunSnapshot = await productCodeDryRunSnapshot(activeProductCodeDialog);

      await reportPageProgress(page, submission, `Dry run complete for Product Code ${productLabel}. Form was filled but not saved.`, {
        phase: "product_code_dry_run_complete",
        productCode: productLabel,
        dryRunSnapshot
      });
      await holdDryRunOpen(page, submission);
      return {
        ok: true,
        dryRun: true,
        recordType: "product_code",
        productId: submission.productId || "",
        productName: submission.productName || fields.productName || fields.code,
        code: fields.code,
        mode: isUpdate ? "update" : "create",
        savedAtUrl: page.url(),
        message: "Dry run: Product Code form filled but not saved.",
        fieldSnapshot: dryRunSnapshot
      };
    }

    await reportPageProgress(page, submission, `Saving Product Code ${productLabel} in ShelfCycle.`, {
      phase: "product_code_save",
      productCode: productLabel
    });
    try {
      await saveOpenDialog(page, activeProductCodeDialog, {
        recordName: submission.productName || fields.code || fields.productName,
        actionLabel: isUpdate ? "update product" : "save product"
      });
    } catch (error) {
      const message = String(error?.message || error || "");
      const canAssist = /required|received null|Packaging Type|Unit Of Measure|Product Family|Supplier Type|Supplier|Packaging\b/i.test(message);

      if (!canAssist) {
        throw error;
      }

      const assisted = await waitForManualAssistIfRequested(page, submission, {
        field: "Product Code required fields",
        label: `required Product Code fields for ${productLabel}`,
        phase: "product_code_required_field_assist",
        reason: compactErrorText(message)
      }, {
        force: true
      });

      if (!assisted) {
        throw error;
      }

      await reportPageProgress(page, submission, `Manual assist completed. Retrying Product Code save for ${productLabel}.`, {
        phase: "product_code_save_retry",
        productCode: productLabel
      });
      await saveOpenDialog(page, activeProductCodeDialog, {
        recordName: submission.productName || fields.code || fields.productName,
        actionLabel: isUpdate ? "update product" : "save product"
      });
    }
    const verificationLabel = fields.code || fields.productName || submission.productName;
    if (verificationLabel) {
      await reportPageProgress(page, submission, `Verifying ShelfCycle saved Product Code ${verificationLabel}.`, {
        phase: "product_code_verify",
        productCode: verificationLabel
      });
      await page.getByText(new RegExp(escapeRegExp(verificationLabel), "i")).waitFor({ timeout: 10000 }).catch(() => null);
    }
    await reportPageProgress(page, submission, `ShelfCycle product workflow complete for ${productLabel}.`, {
      phase: "product_code_complete",
      productCode: productLabel
    });

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

async function fillProductCodeDialogFields(dialog, fields = {}, { skipProductFamily = false, resolveProductFamily = false, submission = {} } = {}) {
  const page = dialog.page();
  const productLabel = fields.code || fields.productName || "product code";

  await fillFieldByLabel(dialog, /^code/i, fields.code);
  await guardProductCodeField(dialog, fields.code, "Code field entry");
  await visualStepPause(page, submission, `Visual check: Code entered for ${productLabel}.`);
  if (!skipProductFamily) {
    await waitForManualAssistIfRequested(page, submission, {
      field: "Product Family",
      label: `Product Family for ${productLabel}`,
      phase: "product_code_select_family"
    });
    await reportPageProgress(page, submission, `Selecting Product Family for ${productLabel}.`, {
      phase: "product_code_select_family",
      productCode: productLabel,
      productFamily: fields.productFamily || fields.productName
    });
    if (resolveProductFamily && fields.productFamily) {
      const familyResult = await ensureProductFamilyForProductCodeDialog(page, dialog, fields, submission);

      if (familyResult.dryRunComplete) {
        return familyResult;
      }

      dialog = await productCodeDialog(page).catch(() => dialog);
      await guardProductCodeField(dialog, fields.code, "Product Family selection");
    } else {
      await selectSearchOption(dialog, {
        ...productCodeDropdown("productFamily"),
        value: fields.productFamily || fields.productName,
        strict: true,
        disambiguator: fields.supplier,
        attempts: 14
      });
      await guardProductCodeField(dialog, fields.code, "Product Family selection");
    }
    await visualStepPause(page, submission, `Visual check: Product Family selected for ${productLabel}.`);
  }
  await waitForManualAssistIfRequested(page, submission, {
    field: "Packaging",
    label: `Packaging fields for ${productLabel}`,
    phase: "product_code_packaging_fields"
  });
  await reportPageProgress(page, submission, `Selecting packaging fields for ${productLabel}.`, {
    phase: "product_code_packaging_fields",
    productCode: productLabel,
    packagingType: normalizePackagingTypeDropdownValue(fields.packagingType || "Fixed"),
    packaging: normalizePackagingDropdownValue(fields.packaging, { unitOfMeasure: fields.unitOfMeasure }),
    unitOfMeasure: normalizeUnitOfMeasureDropdownValue(fields.unitOfMeasure)
  });
  await selectExactPlaceholderOption(dialog, {
    placeholder: SHELFCYCLE_PRODUCT_CODE_FIELDS.packagingType.placeholder,
    value: normalizePackagingTypeDropdownValue(fields.packagingType || "Fixed"),
    strict: true,
    attempts: 10
  });
  await guardProductCodeField(dialog, fields.code, "Packaging Type selection");
  await visualStepPause(page, submission, `Visual check: Packaging Type selected for ${productLabel}.`);
  await selectExactPlaceholderOption(dialog, {
    placeholder: SHELFCYCLE_PRODUCT_CODE_FIELDS.packaging.placeholder,
    value: normalizePackagingDropdownValue(fields.packaging, { unitOfMeasure: fields.unitOfMeasure }),
    strict: true,
    attempts: 12
  });
  await guardProductCodeField(dialog, fields.code, "Packaging selection");
  await visualStepPause(page, submission, `Visual check: Packaging selected for ${productLabel}.`);
  await fillFirstMatching(dialog, [`input[placeholder="${shelfCycleTextPlaceholder(SHELFCYCLE_PRODUCT_CODE_FIELDS, "quantityPerPackage")}"]`], fields.quantityPerPackage);
  await guardProductCodeField(dialog, fields.code, "Quantity entry");
  await visualStepPause(page, submission, `Visual check: Quantity entered for ${productLabel}.`);
  if (await dialog.getByPlaceholder(placeholderRegex(SHELFCYCLE_PRODUCT_CODE_FIELDS.unitOfMeasure.placeholder)).count().catch(() => 0)) {
    await selectExactPlaceholderOption(dialog, {
      placeholder: SHELFCYCLE_PRODUCT_CODE_FIELDS.unitOfMeasure.placeholder,
      value: normalizeUnitOfMeasureDropdownValue(fields.unitOfMeasure),
      strict: true,
      attempts: 10
    });
    await guardProductCodeField(dialog, fields.code, "Unit Of Measure selection");
  }
  await waitForManualAssistIfRequested(page, submission, {
    field: "Supplier",
    label: `Supplier fields for ${productLabel}`,
    phase: "product_code_supplier_fields"
  });
  const supplierTypeValue = normalizePackagingTypeDropdownValue(fields.supplierType || "Variable");
  await selectExactPlaceholderOption(dialog, {
    placeholder: SHELFCYCLE_PRODUCT_CODE_FIELDS.supplierType.placeholder,
    value: supplierTypeValue,
    strict: true,
    attempts: 10
  });
  await guardProductCodeField(dialog, fields.code, "Supplier Type selection");
  await visualStepPause(page, submission, `Visual check: Supplier Type selected for ${productLabel}.`);
  await page.waitForTimeout(500).catch(() => null);
  await selectSearchOption(dialog, {
    ...productCodeDropdown("supplier"),
    value: fields.supplier,
    strict: Boolean(fields.supplier && /\bfixed\b/i.test(String(supplierTypeValue || ""))),
    attempts: 12
  });
  await guardProductCodeField(dialog, fields.code, "Supplier selection");
  await visualStepPause(page, submission, `Visual check: Supplier selected for ${productLabel}.`);
  await fillFieldByLabel(dialog, /cas number/i, fields.casNumber);
  await fillFieldByLabel(dialog, /nmfc/i, fields.nmfcCode);
  await fillFieldByLabel(dialog, /freight class/i, fields.freightClass);
  await selectSearchOption(dialog, productCodeDropdown("pallet", { value: fields.pallet }));
  await visualStepPause(page, submission, `Visual check: CAS/freight fields entered for ${productLabel}.`);
  await fillFieldByLabel(dialog, /packages per pallet/i, fields.packagesPerPallet);

  const unNumberValue = normalizeUnNumberDropdownValue(fields.unNumber);
  const packingGroupValue = normalizePackingGroupDropdownValue(fields.packingGroup, fields);
  const hazardClassValues = normalizeHazardClassDropdownValues(fields.hazardClass);

  await waitForManualAssistIfRequested(page, submission, {
    field: "Hazardous Materials Information",
    label: `transport dropdowns for ${productLabel}`,
    phase: "product_code_transport_fields"
  });
  await reportPageProgress(page, submission, `Selecting transport fields for ${productLabel}: UN/NA ${unNumberValue || "blank"}, Packing Group ${packingGroupValue || "blank"}.`, {
    phase: "product_code_transport_fields",
    productCode: productLabel,
    unNumber: unNumberValue,
    packingGroup: packingGroupValue,
    hazardClass: hazardClassValues.join(", ")
  });
  await selectSearchOption(dialog, productCodeDropdown("unNumber", { value: unNumberValue, attempts: 2 }));
  await selectExactPlaceholderOption(dialog, {
    placeholder: SHELFCYCLE_PRODUCT_CODE_FIELDS.packingGroup.placeholder,
    value: packingGroupValue,
    attempts: 2
  });
  await visualStepPause(page, submission, `Visual check: transport dropdowns selected for ${productLabel}.`);

  if (!hazardClassValues.length && isNonRegulatedTransportValue(fields.hazardClass)) {
    await reportPageProgress(page, submission, `Skipping Hazard Class dropdown for ${productLabel}; source says not regulated.`, {
      phase: "product_code_hazard_class_skipped",
      productCode: productLabel
    });
  }
  await selectSearchOptions(dialog, productCodeDropdown("hazardClass", { values: hazardClassValues }));
  await selectSearchOptions(dialog, productCodeDropdown("specialDesignation", { values: isNonRegulatedTransportValue(fields.specialDesignation) ? [] : splitOptionValues(fields.specialDesignation) }));
  await fillFieldByLabel(dialog, /proper shipping name/i, fields.properShippingName);
  await visualStepPause(page, submission, `Visual check: shipping name entered for ${productLabel}.`);
  await waitForManualAssistIfRequested(page, submission, {
    field: "GHS / physical fields",
    label: `GHS and physical fields for ${productLabel}`,
    phase: "product_code_ghs_fields"
  });
  await selectExactPlaceholderOption(dialog, {
    placeholder: SHELFCYCLE_PRODUCT_CODE_FIELDS.signalWord.placeholder,
    value: fields.signalWord
  });
  await selectSearchOptions(dialog, productCodeDropdown("hazardSymbols", { values: splitOptionValues(fields.hazardSymbols) }));
  await visualStepPause(page, submission, `Visual check: GHS fields selected for ${productLabel}.`);
  await fillFieldByLabel(dialog, /physical state/i, fields.physicalState);
  await fillFieldByLabel(dialog, /appearance/i, fields.appearance);
  await fillFieldByLabel(dialog, /density/i, fields.density);
  await fillFieldByLabel(dialog, /specific gravity/i, fields.specificGravity);
  await fillFieldByLabel(dialog, /viscosity/i, fields.viscosity);
  await fillFieldByLabel(dialog, /flash point/i, fields.flashPoint);
  await fillFieldByLabel(dialog, /boiling point/i, fields.boilingPoint);
  await fillFieldByLabel(dialog, /storage/i, fields.storage);
  await fillFieldByLabel(dialog, /shelf life/i, fields.shelfLife);
  await fillFieldByLabel(dialog, /recommended use/i, fields.recommendedUse);
  await fillFieldByLabel(dialog, /document date/i, fields.documentDate);

  return {
    ok: true
  };
}

export async function submitShelfCycleProductDocument(submission = {}) {
  activateManualAssistSubmission(submission);
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
  const submission = JSON.parse(await readFile(payloadPath, "utf8"));
  activateManualAssistSubmission(submission);
  return submission;
}
