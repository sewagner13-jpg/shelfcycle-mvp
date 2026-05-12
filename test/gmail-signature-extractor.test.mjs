import test from "node:test";
import assert from "node:assert/strict";

import {
  extractGmailSignaturesFromThread,
  extractSignatureImageWithAi,
  parseSignatureText,
  signatureBlockFromText
} from "../src/lib/gmail-signature-extractor.mjs";
import { enrichThreadsWithWorkspaceArtifacts } from "../src/lib/google-workspace-client.mjs";

function encodeBody(value = "") {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signatureMessage({ id = "msg-1", body = "", attachmentId = "att-1" } = {}) {
  return {
    id,
    threadId: "thread-1",
    internalDate: String(Date.parse("2026-05-12T10:00:00Z")),
    payload: {
      headers: [
        { name: "From", value: "Doyun Kim <dykim1@korgc.com>" },
        { name: "To", value: "Sean Wagner <sean@clear-edge.net>" },
        { name: "Subject", value: "RE: Green Chemical/ ClearEdge ACS follow-up" }
      ],
      parts: [
        {
          mimeType: "text/plain",
          body: {
            data: encodeBody(body)
          }
        },
        {
          filename: "image001.jpg",
          mimeType: "image/jpeg",
          body: {
            attachmentId,
            size: 24000
          }
        }
      ]
    }
  };
}

test("parseSignatureText extracts international contact details from a Gmail signature block", () => {
  const result = parseSignatureText(`
    Green Chemical
    Doyun Kim
    Manager | Chemical Sales team
    15F, Changgang Building, 86, Mapo-daero,
    Mapo-gu, Seoul, Korea (04168)
    Tel: +82-2-3158-8827 (Dir) C.P +82-10-8824-7318
    Fax: +82-2-3158-8820
    http://www.korgc.com
  `, {
    sender: { name: "Doyun Kim", email: "dykim1@korgc.com" },
    subject: "RE: Green Chemical/ ClearEdge ACS follow-up"
  });

  assert.equal(result.personName, "Doyun Kim");
  assert.equal(result.companyName, "Green Chemical");
  assert.equal(result.title, "Manager Chemical Sales team");
  assert.equal(result.email, "dykim1@korgc.com");
  assert.equal(result.phone, "+82-2-3158-8827");
  assert.equal(result.mobilePhone, "+82-10-8824-7318");
  assert.equal(result.faxPhone, "+82-2-3158-8820");
  assert.equal(result.website, "http://www.korgc.com");
  assert.equal(result.city, "Seoul");
  assert.equal(result.country, "Korea");
  assert.equal(result.zip, "04168");
});

test("signatureBlockFromText keeps signature tail and drops quoted history", () => {
  const block = signatureBlockFromText(`
    Hello Sean,
    I have CCed our monomer salesperson.

    Kindly,
    Doyun
    Tel: +82-2-3158-8827

    On May 11, Sean wrote:
    Kind regards,
    Sean Wagner
  `);

  assert.equal(block.includes("Doyun"), true);
  assert.equal(block.includes("Sean Wagner"), false);
});

test("extractSignatureImageWithAi sends Gmail signature image to OpenAI vision schema", async () => {
  const calls = [];
  const result = await extractSignatureImageWithAi({
    imageDataUrl: "data:image/jpeg;base64,abc123",
    filename: "image001.jpg",
    sender: { name: "Doyun Kim", email: "dykim1@korgc.com" },
    subject: "RE: Green Chemical/ ClearEdge ACS follow-up",
    config: {
      apiKey: "test-key",
      model: "test-model"
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              personName: "Doyun Kim",
              title: "Manager | Chemical Sales team",
              email: "",
              phone: "+82-2-3158-8827",
              mobilePhone: "+82-10-8824-7318",
              faxPhone: "+82-2-3158-8820",
              companyName: "Green Chemical",
              website: "http://www.korgc.com",
              streetAddress: "15F, Changgang Building, 86, Mapo-daero, Mapo-gu, Seoul, Korea (04168)",
              streetAddress2: "",
              city: "Seoul",
              stateRegion: "",
              zip: "04168",
              country: "Korea",
              visibleText: "Green Chemical Doyun Kim Manager",
              confidence: 0.9
            })
          };
        }
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.fields.email, "dykim1@korgc.com");
  assert.equal(result.fields.companyName, "Green Chemical");
  assert.equal(calls[0].body.input[0].content.some((item) => item.type === "input_image"), true);
  assert.equal(calls[0].body.text.format.name, "clearedge_gmail_signature_ocr");
});

test("extractGmailSignaturesFromThread merges text and OCR signatures without raw image storage", async () => {
  const result = await extractGmailSignaturesFromThread({
    id: "thread-1",
    messages: [
      signatureMessage({
        body: [
          "Hello Sean,",
          "I have CCed our monomer salesperson.",
          "",
          "Kindly,",
          "Doyun",
          "Tel: +82-2-3158-8827"
        ].join("\n")
      })
    ]
  }, {
    attachments: [
      {
        filename: "image001.jpg",
        mimeType: "image/jpeg",
        attachmentId: "att-1",
        messageId: "msg-1",
        threadId: "thread-1",
        size: 24000
      }
    ],
    signatureConfig: {
      apiKey: "test-key",
      model: "test-model"
    },
    fetchAttachmentDataImpl: async () => ({
      data: Buffer.from("fake-image").toString("base64url")
    }),
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            personName: "Doyun Kim",
            title: "Manager | Chemical Sales team",
            email: "",
            phone: "+82-2-3158-8827",
            mobilePhone: "+82-10-8824-7318",
            faxPhone: "+82-2-3158-8820",
            companyName: "Green Chemical",
            website: "http://www.korgc.com",
            streetAddress: "15F, Changgang Building, 86, Mapo-daero, Mapo-gu, Seoul, Korea (04168)",
            streetAddress2: "",
            city: "Seoul",
            stateRegion: "",
            zip: "04168",
            country: "Korea",
            visibleText: "Green Chemical Doyun Kim Manager",
            confidence: 0.9
          })
        };
      }
    })
  });

  assert.equal(result.signatures.length, 1);
  assert.equal(result.signatures[0].personName, "Doyun Kim");
  assert.equal(result.signatures[0].email, "dykim1@korgc.com");
  assert.equal(result.signatures[0].sourceMethods.includes("text_signature"), true);
  assert.equal(result.signatures[0].sourceMethods.includes("image_ocr"), true);
  assert.equal(result.signatures[0].sourceText, undefined);
});

test("extractGmailSignaturesFromThread OCRs inline image body data without storing raw image data", async () => {
  let attachmentFetches = 0;
  const base = signatureMessage({ body: "Kindly,\nDoyun", attachmentId: "" });
  const result = await extractGmailSignaturesFromThread({
    id: "thread-1",
    messages: [
      {
        ...base,
        payload: {
          ...base.payload,
          parts: [
            {
              mimeType: "text/plain",
              body: {
                data: encodeBody("Kindly,\nDoyun")
              }
            },
            {
              filename: "image001.jpg",
              mimeType: "image/jpeg",
              body: {
                data: Buffer.from("inline-image").toString("base64url"),
                size: 20000
              }
            }
          ]
        }
      }
    ]
  }, {
    attachments: [],
    signatureConfig: {
      apiKey: "test-key",
      model: "test-model"
    },
    fetchAttachmentDataImpl: async () => {
      attachmentFetches += 1;
      return {};
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            personName: "Doyun Kim",
            title: "Manager",
            email: "",
            phone: "+82-2-3158-8827",
            mobilePhone: "",
            faxPhone: "",
            companyName: "Green Chemical",
            website: "http://www.korgc.com",
            streetAddress: "",
            streetAddress2: "",
            city: "",
            stateRegion: "",
            zip: "",
            country: "",
            visibleText: "Green Chemical Doyun Kim",
            confidence: 0.85
          })
        };
      }
    })
  });

  assert.equal(attachmentFetches, 0);
  assert.equal(result.signatures[0].companyName, "Green Chemical");
  assert.equal(result.signatures[0].inlineData, undefined);
});

test("enrichThreadsWithWorkspaceArtifacts stores structured signature contacts on workspace artifacts", async () => {
  const [thread] = await enrichThreadsWithWorkspaceArtifacts([
    {
      id: "thread-1",
      messages: [
        signatureMessage({
          body: [
            "Hello Sean,",
            "",
            "Kindly,",
            "Doyun Kim",
            "Manager | Chemical Sales team",
            "Green Chemical",
            "Tel: +82-2-3158-8827"
          ].join("\n"),
          attachmentId: ""
        })
      ]
    }
  ], {
    enableDriveEnrichment: false,
    signatureExtractionConfig: {
      enabled: false
    }
  });

  assert.equal(thread.workspaceArtifacts.emailSignatures.length, 1);
  assert.equal(thread.workspaceArtifacts.emailSignatures[0].companyName, "Green Chemical");
  assert.equal(thread.workspaceArtifacts.emailSignatures[0].phone, "+82-2-3158-8827");
});
