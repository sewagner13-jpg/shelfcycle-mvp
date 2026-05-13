import { inflateSync } from "node:zlib";

function decodePdfString(value = "") {
  return String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
    .replace(/\s+/g, " ")
    .trim();
}

function extractLiteralStrings(text = "") {
  const strings = [];
  const pattern = /\((?:\\.|[^\\()])*\)\s*(?:Tj|'|"|\])/g;

  for (const match of text.matchAll(pattern)) {
    const raw = match[0].replace(/\s*(?:Tj|'|"|\])\s*$/, "");
    const value = decodePdfString(raw.slice(1, -1));

    if (value && /[A-Za-z0-9]/.test(value)) {
      strings.push(value);
    }
  }

  return strings;
}

function inflatePdfStream(stream = Buffer.alloc(0)) {
  try {
    return inflateSync(stream).toString("latin1");
  } catch {
    return stream.toString("latin1");
  }
}

export function extractPdfText(buffer = Buffer.alloc(0), { maxChars = 120000 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return "";
  }

  const raw = buffer.toString("latin1");
  const chunks = [];
  const streamPattern = /<<(?:.|\n|\r)*?>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;

  for (const match of raw.matchAll(streamPattern)) {
    const stream = Buffer.from(match[1] ?? "", "latin1");
    const inflated = inflatePdfStream(stream);
    const strings = extractLiteralStrings(inflated);

    if (strings.length) {
      chunks.push(strings.join(" "));
    }
  }

  if (!chunks.length) {
    chunks.push(...extractLiteralStrings(raw));
  }

  return chunks
    .join("\n")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}
