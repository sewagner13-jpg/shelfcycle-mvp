import { startServer } from "./server.mjs";
import { handleFullEmailReviewRequest } from "./full-email-review-routes.mjs";

export function startServerWithFullEmailReview({ port = 4318 } = {}) {
  const server = startServer({ port });
  const [appRequestHandler] = server.listeners("request");

  if (!appRequestHandler) {
    return server;
  }

  server.off("request", appRequestHandler);
  server.on("request", async (request, response) => {
    try {
      if (!await handleFullEmailReviewRequest(request, response)) {
        await appRequestHandler.call(server, request, response);
      }
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }

      response.writeHead(error?.statusCode ?? 500, {
        "content-type": "application/json; charset=utf-8"
      });
      response.end(JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected server error",
        gmailMutationPerformed: false
      }, null, 2));
    }
  });

  return server;
}
