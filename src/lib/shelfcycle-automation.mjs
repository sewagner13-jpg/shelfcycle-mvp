import { access, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

async function fillRichText(dialog, value) {
  const text = String(value || "").trim();

  if (!text) {
    return;
  }

  const textareaCandidates = [
    dialog.getByLabel(/summary/i),
    dialog.locator("textarea").first()
  ];

  for (const field of textareaCandidates) {
    try {
      if (await field.count()) {
        await field.fill(text);
        return;
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
    return;
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

export async function openShelfCycleSessionForLogin() {
  const context = await createContext({ headless: false });
  const page = await getWorkingPage(context);

  await page.goto(DEFAULT_URL, { waitUntil: "domcontentloaded" });
  await page.bringToFront();
  await dismissCommonPopups(page);

  return {
    ok: true,
    message: "ShelfCycle browser session opened. Log in if prompted, then close the browser when you are done.",
    context
  };
}

export async function submitShelfCycleNote(submission = {}) {
  const context = await createContext({ headless: false });

  try {
    const page = await getWorkingPage(context);
    await page.goto(submission.url, { waitUntil: "domcontentloaded" });
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

    await fillRichText(dialog, submission.fields.summary);

    const saveButton = dialog.getByRole("button", { name: /^save$/i }).first();
    await saveButton.click({ timeout: 10000 });

    await waitForSavedNote(page, submission.fields.title);

    return {
      ok: true,
      recordType: "note",
      customerId: submission.customerId,
      customerName: submission.customerName,
      title: submission.fields.title,
      savedAtUrl: page.url()
    };
  } finally {
    await context.close();
  }
}

export async function loadSubmissionPayload(payloadPath) {
  return JSON.parse(await readFile(payloadPath, "utf8"));
}
