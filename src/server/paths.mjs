import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(__dirname, "../..");
export const publicRoot = path.join(projectRoot, "public");
export const dataRoot = path.join(projectRoot, "data");
export const DEFAULT_INTELLIGENCE_FILE = path.join(dataRoot, "clearedge-intelligence.json");
export const LEGACY_INTELLIGENCE_FILE = path.join(dataRoot, "clearedge-brain-notebook-intelligence.json");
export const AUTOMATION_RUNNER_PATH = path.join(projectRoot, "src/lib/shelfcycle-automation-runner.mjs");
export const LOCAL_DAILY_BRIEF_RUNNER_PATH = path.join(projectRoot, "apps/daily-brief/run-local-scheduled.mjs");
export const LOCAL_DAILY_BRIEF_RUNS_DIR = path.join(projectRoot, ".local/daily-brief-runs");
export const LOCAL_DAILY_BRIEF_PROGRESS_PATH = path.join(LOCAL_DAILY_BRIEF_RUNS_DIR, "current-status.json");
export const LOCAL_DAILY_BRIEF_LATEST_SUMMARY_PATH = path.join(LOCAL_DAILY_BRIEF_RUNS_DIR, "latest-run-summary.json");
export const LOCAL_DAILY_BRIEF_LATEST_PREVIEW_PATH = path.join(LOCAL_DAILY_BRIEF_RUNS_DIR, "latest-brief-preview.json");
export const LOCAL_DAILY_BRIEF_LOCK_DIR = path.join(projectRoot, ".local/daily-brief-runner.lock");
export const LOCAL_DAILY_BRIEF_REQUEST_LOCK_DIR = path.join(projectRoot, ".local/daily-brief-request.lock");
export const LOCAL_BRIEF_CONTROL_PATH = path.join(projectRoot, ".local/brief-control.local.json");
export const LOCAL_REVIEW_ACTIONS_DIR = path.join(projectRoot, ".local/review-actions");
export const LOCAL_PRODUCT_DOCUMENTS_DIR = path.join(projectRoot, ".local/product-documents");
export const LOCAL_WORKFLOW_RUNS_DIR = path.join(projectRoot, ".local/workflow-runs");
export const LOCAL_KNOWLEDGE_PATH = path.join(projectRoot, ".local/clearedge-knowledge-local.json");
export const LOCAL_OPENAI_CONFIG_PATH = path.join(projectRoot, ".local/openai.local.json");
export const LOCAL_HOSTED_SETTINGS_PATH = path.join(projectRoot, ".local/hosted-brief-settings.local.json");
