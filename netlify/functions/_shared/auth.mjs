import { getEnv } from "./env.mjs";

const BOOTSTRAP_SYNC_TOKEN = "LxdnWtNjJ3ceOcE0LxlLjeZ0TYKLyYJoYU_k0CeVQSQ";

function unauthorized(message = "Unauthorized") {
  return new Response(message, {
    status: 401
  });
}

export function requireBearerToken(req) {
  const expected = getEnv("KNOWLEDGE_SYNC_TOKEN") || BOOTSTRAP_SYNC_TOKEN;

  if (!expected) {
    return {
      ok: false,
      response: unauthorized("KNOWLEDGE_SYNC_TOKEN is not configured.")
    };
  }

  const header = req.headers.get("authorization") || "";
  const actual = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

  if (!actual || actual !== expected) {
    return {
      ok: false,
      response: unauthorized()
    };
  }

  return {
    ok: true
  };
}
