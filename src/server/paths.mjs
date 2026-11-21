import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(__dirname, "../..");
export const publicRoot = path.join(projectRoot, "public");
export const dataRoot = path.join(projectRoot, "data");
// Runtime state normally lives in <project>/.local. SHELFCYCLE_LOCAL_DIR lets tests point
// the server at a scratch directory so they never touch the real workflow runs or briefs.
export const localStateRoot = process.env.SHELFCYCLE_LOCAL_DIR
  ? path.resolve(process.env.SHELFCYCLE_LOCAL_DIR)
  : path.join(projectRoot, ".local");
export const DEFAULT_INTELLIGENCE_FILE = path.join(dataRoot, "clearedge-intelligence.json");
export const LEGACY_INTELLIGENCE_FILE = path.join(dataRoot, "clearedge-brain-notebook-intelligence.json");
export const AUTOMATION_RUNNER_PATH = path.join(projectRoot, "src/lib/shelfcycle-automation-runner.mjs");
export const LOCAL_DAILY_BRIEF_RUNNER_PATH = path.join(projectRoot, "apps/daily-brief/run-local-scheduled.mjs");
export const LOCAL_DAILY_BRIEF_RUNS_DIR = path.join(localStateRoot, "daily-brief-runs");
export const LOCAL_DAILY_BRIEF_PROGRESS_PATH = path.join(LOCAL_DAILY_BRIEF_RUNS_DIR, "current-status.json");
export const LOCAL_DAILY_BRIEF_LATEST_SUMMARY_PATH = path.join(LOCAL_DAILY_BRIEF_RUNS_DIR, "latest-run-summary.json");
export const LOCAL_DAILY_BRIEF_LATEST_PREVIEW_PATH = path.join(LOCAL_DAILY_BRIEF_RUNS_DIR, "latest-brief-preview.json");
export const LOCAL_DAILY_BRIEF_LOCK_DIR = path.join(localStateRoot, "daily-brief-runner.lock");
export const LOCAL_DAILY_BRIEF_REQUEST_LOCK_DIR = path.join(localStateRoot, "daily-brief-request.lock");
export const LOCAL_BRIEF_CONTROL_PATH = path.join(localStateRoot, "brief-control.local.json");
export const LOCAL_REVIEW_ACTIONS_DIR = path.join(localStateRoot, "review-actions");
export const LOCAL_PRODUCT_DOCUMENTS_DIR = path.join(localStateRoot, "product-documents");
export const LOCAL_WORKFLOW_RUNS_DIR = path.join(localStateRoot, "workflow-runs");
export const LOCAL_KNOWLEDGE_PATH = path.join(localStateRoot, "clearedge-knowledge-local.json");
export const LOCAL_OPENAI_CONFIG_PATH = path.join(localStateRoot, "openai.local.json");
export const LOCAL_HOSTED_SETTINGS_PATH = path.join(localStateRoot, "hosted-brief-settings.local.json");
