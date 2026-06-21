import {
  applyFullEmailDecision,
  authorizeFullEmailReview,
  readFullEmailReview
} from "../../src/lib/full-email-review-service.mjs";
import {
  loadBriefSettings,
  loadFullEmailReviewState,
  loadReviewAction,
  saveFullEmailReviewState
} from "./_shared/knowledge-store.mjs";

function respond(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
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

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const action = await authorizeFullEmailReview({
        actionId: url.searchParams.get("id") || "",
        token: url.searchParams.get("token") || "",
        loadAction: loadReviewAction
      });
      const settings = await loadBriefSettings() ?? {};
      const result = await readFullEmailReview({
        action,
        state: await loadFullEmailReviewState(action.id) ?? {},
        gmailConfig: settings.gmailConfig ?? {},
        refresh: ["1", "true", "yes"].includes((url.searchParams.get("refresh") || "").toLowerCase())
      });

      await saveFullEmailReviewState(action.id, result.state);
      return respond({
        ok: true,
        review: result.review,
        decisions: result.decisions,
        cached: result.cached,
        gmailMutationPerformed: false
      });
    }

    if (req.method === "POST") {
      const payload = await req.json().catch(() => ({}));
      const action = await authorizeFullEmailReview({
        actionId: payload.id || payload.reviewActionId || "",
        token: payload.token || "",
        loadAction: loadReviewAction
      });
      const result = applyFullEmailDecision({
        action,
        state: await loadFullEmailReviewState(action.id) ?? {},
        messageId: payload.messageId || "",
        decision: payload.decision || ""
      });

      await saveFullEmailReviewState(action.id, result.state);
      return respond({
        ok: true,
        decision: result.decision,
        decisions: result.decisions,
        gmailMutationPerformed: false
      });
    }

    return respond({
      ok: false,
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Method not allowed."
      },
      gmailMutationPerformed: false
    }, 405);
  } catch (error) {
    return respond(errorPayload(error), error?.statusCode ?? 500);
  }
};

export const config = {
  path: "/api/review-action/full-email"
};
