import { requireBearerToken } from "./_shared/auth.mjs";
import { saveBriefSettings } from "./_shared/knowledge-store.mjs";

export default async (req) => {
  const auth = requireBearerToken(req);

  if (!auth.ok) {
    return auth.response;
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const settings = await req.json();

  if (!settings?.gmailConfig?.clientId || !settings?.gmailConfig?.refreshToken) {
    return new Response("Invalid settings payload. gmailConfig with clientId and refreshToken is required. clientSecret is optional for desktop OAuth clients.", {
      status: 400
    });
  }

  await saveBriefSettings(settings);

  return Response.json({
    ok: true,
    configured: true,
    hasRecipient: Boolean(settings.recipient),
    hasUser: Boolean(settings.gmailConfig?.user)
  });
};

export const config = {
  path: "/api/settings-sync"
};
