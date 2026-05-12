import { requireBearerToken } from "./_shared/auth.mjs";
import { saveReviewAction } from "./_shared/knowledge-store.mjs";

function validAction(action = {}) {
  return Boolean(action && typeof action === "object" && action.id && action.viewToken);
}

export default async (req) => {
  const auth = requireBearerToken(req);

  if (!auth.ok) {
    return auth.response;
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const payload = await req.json().catch(() => ({}));
  const actions = Array.isArray(payload.actions)
    ? payload.actions
    : payload.action
      ? [payload.action]
      : validAction(payload)
        ? [payload]
        : [];

  if (!actions.length || actions.some((action) => !validAction(action))) {
    return Response.json({
      ok: false,
      error: "Each synced review action must include id and viewToken."
    }, {
      status: 400
    });
  }

  for (const action of actions) {
    await saveReviewAction(action);
  }

  return Response.json({
    ok: true,
    synced: actions.length,
    ids: actions.map((action) => action.id)
  });
};

export const config = {
  path: "/api/review-action-sync"
};
