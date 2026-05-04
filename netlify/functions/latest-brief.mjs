import { requireBearerToken } from "./_shared/auth.mjs";
import { loadLatestBrief } from "./_shared/knowledge-store.mjs";

export default async (req) => {
  const auth = requireBearerToken(req);

  if (!auth.ok) {
    return auth.response;
  }

  const brief = await loadLatestBrief();

  if (!brief) {
    return new Response("No brief has been generated yet.", { status: 404 });
  }

  return new Response(brief, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
};

export const config = {
  path: "/api/latest-brief"
};
