import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMimeEmail } from "../src/lib/gmail-client.mjs";

test("buildMimeEmail builds a simple plain-text message", () => {
  const mime = buildMimeEmail({
    to: "brittany@clear-edge.net",
    subject: "Supplier invoice",
    body: "Please review."
  });

  assert.match(mime, /^To: brittany@clear-edge\.net/m);
  assert.match(mime, /^Subject: Supplier invoice/m);
  assert.match(mime, /^Content-Type: text\/plain; charset=UTF-8/m);
  assert.match(mime, /Please review\.$/);
});

test("buildMimeEmail includes attachments in multipart MIME", () => {
  const mime = buildMimeEmail({
    to: "sean@clear-edge.net",
    subject: "Fwd: Broker invoice",
    body: "Forwarded with attachment.",
    boundary: "test-boundary",
    attachments: [
      {
        filename: "broker-invoice.pdf",
        mimeType: "application/pdf",
        data: Buffer.from("hello")
      }
    ]
  });

  assert.match(mime, /Content-Type: multipart\/mixed; boundary="test-boundary"/);
  assert.match(mime, /Content-Disposition: attachment; filename="broker-invoice.pdf"/);
  assert.match(mime, /aGVsbG8=/);
  assert.match(mime, /--test-boundary--/);
});
