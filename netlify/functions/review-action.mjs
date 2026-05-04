import { loadReviewAction } from "./_shared/knowledge-store.mjs";

function sanitizeActionRecord(action = {}) {
  const { viewToken, ...safe } = action;
  return safe;
}

export default async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const actionId = url.searchParams.get("id") || "";
  const token = url.searchParams.get("token") || "";

  if (!actionId || !token) {
    return new Response("Missing review action id or token.", { status: 400 });
  }

  const action = await loadReviewAction(actionId);

  if (!action) {
    return new Response("Review action not found.", { status: 404 });
  }

  if (action.viewToken !== token) {
    return new Response("Invalid review token.", { status: 403 });
  }

  return Response.json({
    ok: true,
    action: sanitizeActionRecord(action)
  });
};

export const config = {
  path: "/api/review-action"
};
