import test from "node:test";
import assert from "node:assert/strict";

import {
  collectGmailAttachmentMetadata,
  extractGoogleDriveFileIds
} from "../src/lib/google-workspace-client.mjs";

function encodeBody(text = "") {
  return Buffer.from(text, "utf8").toString("base64url");
}

test("extractGoogleDriveFileIds finds docs and drive file links", () => {
  const text = `
    Pricing file: https://drive.google.com/file/d/abc123_DEF-ghi/view?usp=sharing
    TDS sheet: https://docs.google.com/spreadsheets/d/xyz987_ABC/edit#gid=0
    Duplicate: https://drive.google.com/open?id=abc123_DEF-ghi
  `;

  const ids = extractGoogleDriveFileIds(text);

  assert.deepEqual(ids, ["abc123_DEF-ghi", "xyz987_ABC"]);
});

test("collectGmailAttachmentMetadata walks nested payload parts", () => {
  const payload = {
    mimeType: "multipart/mixed",
    parts: [
      {
        mimeType: "text/plain",
        body: {
          data: encodeBody("Please see attached SDS.")
        }
      },
      {
        filename: "Product-SDS.pdf",
        mimeType: "application/pdf",
        body: {
          attachmentId: "att-1",
          size: 2048
        }
      },
      {
        mimeType: "multipart/alternative",
        parts: [
          {
            filename: "RUCOSAN-TDS.pdf",
            mimeType: "application/pdf",
            body: {
              attachmentId: "att-2",
              size: 4096
            }
          }
        ]
      }
    ]
  };

  const attachments = collectGmailAttachmentMetadata(payload);
  const filenames = attachments.map((item) => item.filename).sort();

  assert.equal(attachments.length, 2);
  assert.deepEqual(filenames, ["Product-SDS.pdf", "RUCOSAN-TDS.pdf"]);
  assert.equal(attachments.find((item) => item.filename === "RUCOSAN-TDS.pdf")?.size, 4096);
});
