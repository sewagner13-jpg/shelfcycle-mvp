import { compactWhitespace, uniqueStrings } from "./normalize.mjs";
import { getAccessToken } from "./gmail-client.mjs";

const DRIVE_LINK_PATTERNS = [
  /https?:\/\/drive\.google\.com\/file\/d\/([A-Z0-9_-]+)/gi,
  /https?:\/\/drive\.google\.com\/open\?id=([A-Z0-9_-]+)/gi,
  /https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation|forms)\/d\/([A-Z0-9_-]+)/gi
];

function getBodyText(payload = {}) {
  if (payload.parts?.length) {
    return payload.parts.map((part) => getBodyText(part)).join("\n");
  }

  if (!payload.body?.data) {
    return "";
  }

  try {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function dedupeBy(items = [], keyFn = (item) => JSON.stringify(item)) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const key = keyFn(item);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(item);
  }

  return output;
}

export function extractGoogleDriveFileIds(text = "") {
  const ids = [];

  for (const pattern of DRIVE_LINK_PATTERNS) {
    let match;

    while ((match = pattern.exec(text))) {
      ids.push(match[1]);
    }
  }

  return uniqueStrings(ids);
}

export function collectGmailAttachmentMetadata(payload = {}) {
  const attachments = [];
  const stack = [payload];

  while (stack.length) {
    const part = stack.pop();

    if (!part) {
      continue;
    }

    if (part.parts?.length) {
      stack.push(...part.parts);
    }

    const filename = compactWhitespace(part.filename ?? "");
    const attachmentId = compactWhitespace(part.body?.attachmentId ?? "");

    if (!filename && !attachmentId) {
      continue;
    }

    attachments.push({
      filename,
      mimeType: compactWhitespace(part.mimeType ?? ""),
      attachmentId,
      size: Number(part.body?.size ?? 0)
    });
  }

  return dedupeBy(attachments, (item) => item.attachmentId || item.filename);
}

async function googleJsonRequest(url, { config } = {}) {
  const { accessToken } = await getAccessToken(config);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Google API request failed (${response.status}): ${errorText}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

export async function fetchDriveFilesMetadata(fileIds = [], { config, maxFiles = 6 } = {}) {
  const ids = uniqueStrings(fileIds).slice(0, maxFiles);

  if (!ids.length) {
    return {
      files: [],
      driveScopeAvailable: true
    };
  }

  const files = [];

  for (const fileId of ids) {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
    url.searchParams.set(
      "fields",
      "id,name,mimeType,webViewLink,webContentLink,modifiedTime,owners(displayName,emailAddress)"
    );

    try {
      const payload = await googleJsonRequest(url, { config });
      files.push({
        id: payload.id,
        name: compactWhitespace(payload.name ?? ""),
        mimeType: compactWhitespace(payload.mimeType ?? ""),
        webViewLink: compactWhitespace(payload.webViewLink ?? ""),
        webContentLink: compactWhitespace(payload.webContentLink ?? ""),
        modifiedTime: compactWhitespace(payload.modifiedTime ?? ""),
        ownerName: compactWhitespace(payload.owners?.[0]?.displayName ?? ""),
        ownerEmail: compactWhitespace(payload.owners?.[0]?.emailAddress ?? "")
      });
    } catch (error) {
      if (error?.status === 403) {
        return {
          files,
          driveScopeAvailable: false,
          error: "insufficient_drive_scope"
        };
      }

      if (error?.status === 404) {
        continue;
      }

      throw error;
    }
  }

  return {
    files: dedupeBy(files, (item) => item.id),
    driveScopeAvailable: true
  };
}

function collectThreadText(thread = {}) {
  return (thread.messages ?? [])
    .map((message) => [message.snippet ?? "", getBodyText(message.payload)].filter(Boolean).join("\n"))
    .join("\n");
}

export async function enrichThreadsWithWorkspaceArtifacts(
  threads = [],
  {
    config,
    enableDriveEnrichment = true,
    maxDriveFilesPerThread = 6
  } = {}
) {
  const enrichedThreads = [];

  for (const thread of threads) {
    const attachments = dedupeBy(
      (thread.messages ?? []).flatMap((message) => collectGmailAttachmentMetadata(message.payload)),
      (item) => item.attachmentId || item.filename
    );
    const driveFileIds = extractGoogleDriveFileIds(collectThreadText(thread));
    let driveFiles = [];
    let driveScopeAvailable = true;
    let driveError = "";

    if (enableDriveEnrichment && driveFileIds.length) {
      const driveResult = await fetchDriveFilesMetadata(driveFileIds, {
        config,
        maxFiles: maxDriveFilesPerThread
      });
      driveFiles = driveResult.files;
      driveScopeAvailable = driveResult.driveScopeAvailable;
      driveError = driveResult.error ?? "";
    }

    enrichedThreads.push({
      ...thread,
      workspaceArtifacts: {
        attachments,
        driveFileIds,
        driveFiles,
        driveScopeAvailable,
        driveError
      }
    });
  }

  return enrichedThreads;
}
