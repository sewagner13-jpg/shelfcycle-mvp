import { requireBearerToken } from "./_shared/auth.mjs";
import { saveKnowledgeBundle } from "./_shared/knowledge-store.mjs";

export default async (req) => {
  const auth = requireBearerToken(req);

  if (!auth.ok) {
    return auth.response;
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const bundle = await req.json();

  if (!bundle?.products || !bundle?.customers || !bundle?.contacts) {
    return new Response("Invalid knowledge bundle payload", { status: 400 });
  }

  await saveKnowledgeBundle(bundle);

  return Response.json({
    ok: true,
    organization: bundle.organization,
    generatedAt: bundle.generatedAt,
    counts: {
      customers: bundle.customers.length,
      contacts: bundle.contacts.length,
      products: bundle.products.length,
      locations: bundle.locations.length
    }
  });
};

export const config = {
  path: "/api/knowledge-sync"
};
