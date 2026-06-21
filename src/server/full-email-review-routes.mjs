import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  applyFullEmailDecision,
  authorizeFullEmailReview,
  readFullEmailReview
} from "../lib/full-email-review-service.mjs";
import { loadLocalReviewAction } from "../lib/local-review-actions.mjs";
import { LOCAL_HOSTED_SETTINGS_PATH, LOCAL_REVIEW_ACTIONS_DIR } from "./paths.mjs";
import { CORS_HEADERS, json, readBody } from "./http-utils.mjs";

const FULL_EMAIL_PATH = "/api/review-action/full-email";
const FULL_EMAIL_STATE_DIR = path.join(LOCAL_REVIEW_ACTIONS_DIR, "full-email");

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function loadLocalGmailConfig() {
  const settings = await readJsonIfPresent(LOCAL_HOSTED_SETTINGS_PATH) ?? {};
  return settings.gmailConfig ?? {};
}

function statePath(actionId = "") {
  return path.join(FULL_EMAIL_STATE_DIR, `${actionId}.json`);
}

async function loadFullEmailState(actionId = "") {
  return await readJsonIfPresent(statePath(actionId)) ?? {};
}

async function saveFullEmailState(actionId = "", state = {}) {
  await mkdir(FULL_EMAIL_STATE_DIR, { recursive: true });
  await writeFile(statePath(actionId), JSON.stringify(state, null, 2), "utf8");
}

function errorPayload(error) {
  return {
    ok: false,
    error: {
      code: error?.code || "FULL_EMAIL_REVIEW_ERROR",
      message: error instanceof Error ? error.message : "Full email review failed."
    },
    gmailMutationPerformed: false
  };
}

export async function handleFullEmailReviewRequest(request, response) {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (url.pathname !== FULL_EMAIL_PATH) {
    return false;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, CORS_HEADERS);
    response.end();
    return true;
  }

  try {
    if (request.method === "GET") {
      const action = await authorizeFullEmailReview({
        actionId: url.searchParams.get("id") || "",
        token: url.searchParams.get("token") || "",
        loadAction: (actionId) => loadLocalReviewAction(LOCAL_REVIEW_ACTIONS_DIR, actionId)
      });
      const result = await readFullEmailReview({
        action,
        state: await loadFullEmailState(action.id),
        gmailConfig: await loadLocalGmailConfig(),
        refresh: ["1", "true", "yes"].includes((url.searchParams.get("refresh") || "").toLowerCase())
      });

      await saveFullEmailState(action.id, result.state);
      json(response, 200, {
        ok: true,
        review: result.review,
        decisions: result.decisions,
        cached: result.cached,
        gmailMutationPerformed: false
      });
      return true;
    }

    if (request.method === "POST") {
      const payload = await readBody(request);
      const action = await authorizeFullEmailReview({
        actionId: payload.id || payload.reviewActionId || "",
        token: payload.token || "",
        loadAction: (actionId) => loadLocalReviewAction(LOCAL_REVIEW_ACTIONS_DIR, actionId)
      });
      const result = applyFullEmailDecision({
        action,
        state: await loadFullEmailState(action.id),
        messageId: payload.messageId || "",
        decision: payload.decision || ""
      });

      await saveFullEmailState(action.id, result.state);
      json(response, 200, {
        ok: true,
        decision: result.decision,
        decisions: result.decisions,
        gmailMutationPerformed: false
      });
      return true;
    }

    json(response, 405, {
      ok: false,
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed."
      },
      gmailMutationPerformed: false
    });
    return true;
  } catch (error) {
    json(response, error?.statusCode ?? 500, errorPayload(error));
    return true;
  }
}
