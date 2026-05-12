import { loadReviewAction } from "./_shared/knowledge-store.mjs";
import { collectExecutableActions, collectProposedActions } from "../../src/lib/shelfcycle-action-router.mjs";
import { buildShelfCycleReadyNote } from "../../src/lib/shelfcycle-ready-note.mjs";

function sanitizeActionRecord(action = {}) {
  const { viewToken, ...safe } = action;
  return safe;
}

function requestCredentials(payload = {}) {
  if (payload.id && payload.token) {
    return {
      id: payload.id,
      token: payload.token
    };
  }

  if (!payload.reviewUrl) {
    return {
      id: "",
      token: ""
    };
  }

  try {
    const url = new URL(payload.reviewUrl);

    return {
      id: url.searchParams.get("id") || "",
      token: url.searchParams.get("token") || ""
    };
  } catch {
    return {
      id: "",
      token: ""
    };
  }
}

function enrichAction(action = {}) {
  const enrichedAction = {
    ...sanitizeActionRecord(action),
    shelfCycleReadyNote: action.shelfCycleReadyNote?.source === "user_approved"
      ? action.shelfCycleReadyNote
      : buildShelfCycleReadyNote(action)
  };
  const proposedActions = collectProposedActions(enrichedAction);

  return {
    ...enrichedAction,
    proposedActions,
    executableActions: collectExecutableActions(enrichedAction)
  };
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payload = await req.json().catch(() => ({}));
  const { id, token } = requestCredentials(payload);

  if (!id || !token) {
    return Response.json({
      ok: false,
      error: "Missing review action id or token."
    }, {
      status: 400
    });
  }

  const action = await loadReviewAction(id);

  if (!action) {
    return Response.json({
      ok: false,
      error: "Review action not found."
    }, {
      status: 404
    });
  }

  if (action.viewToken !== token) {
    return Response.json({
      ok: false,
      error: "Invalid review token."
    }, {
      status: 403
    });
  }

  return Response.json({
    ok: true,
    action: enrichAction(action)
  });
};

export const config = {
  path: "/api/load-review-action"
};
