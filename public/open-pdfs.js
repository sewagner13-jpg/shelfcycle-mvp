const LOCAL_MVP_API_BASE = "http://localhost:4318";

const statusEl = document.querySelector("[data-open-pdfs-status]");
const resultsEl = document.querySelector("[data-open-pdfs-results]");
const retryButton = document.querySelector("[data-open-pdfs-retry]");
const reviewLink = document.querySelector("[data-open-pdfs-review]");

function params() {
  const search = new URLSearchParams(window.location.search);
  return {
    id: search.get("id") || search.get("reviewActionId") || "",
    token: search.get("token") || ""
  };
}

function isLocalHost() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function endpoint() {
  return isLocalHost()
    ? "/api/review-action/open-pdfs"
    : `${LOCAL_MVP_API_BASE}/api/review-action/open-pdfs`;
}

function reviewPacketUrl({ id, token }) {
  const url = new URL("/review-action.html", window.location.origin);
  url.searchParams.set("id", id);
  url.searchParams.set("token", token);
  return url.href;
}

function renderResults(payload = {}) {
  const copied = payload.copied ?? [];
  const opened = payload.opened ?? [];
  const unavailable = payload.unavailable ?? [];
  const openErrors = payload.openErrors ?? [];

  resultsEl.innerHTML = [
    payload.folderPath ? `<p><strong>Desktop folder:</strong> ${escapeHtml(payload.folderPath)}</p>` : "",
    copied.length
      ? `<h3>Copied PDFs</h3><ul>${copied.map((item) => `<li>${escapeHtml(item.filename || item.path || "PDF")}</li>`).join("")}</ul>`
      : "<p>No PDFs were copied.</p>",
    opened.length
      ? `<h3>Opened</h3><ul>${opened.map((item) => `<li>${escapeHtml(item.path || "PDF")} <span class="muted">(${escapeHtml(item.app || "PDF app")})</span></li>`).join("")}</ul>`
      : "",
    unavailable.length
      ? `<h3>Unavailable</h3><ul>${unavailable.map((item) => `<li>${escapeHtml(item.filename || "PDF")}: ${escapeHtml(item.reason || "Unavailable")}</li>`).join("")}</ul>`
      : "",
    openErrors.length
      ? `<h3>Open Errors</h3><ul>${openErrors.map((item) => `<li>${escapeHtml(item.filename || item.path || "PDF")}: ${escapeHtml(item.reason || "Could not open")}</li>`).join("")}</ul>`
      : ""
  ].filter(Boolean).join("");
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function openPdfs() {
  const { id, token } = params();

  if (!id || !token) {
    statusEl.textContent = "Missing review packet id or token.";
    retryButton.disabled = true;
    return;
  }

  reviewLink.href = reviewPacketUrl({ id, token });
  retryButton.disabled = true;
  statusEl.textContent = "Contacting local ClearEdge backend and opening PDFs...";
  resultsEl.innerHTML = "";

  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewActionId: id, token })
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message || payload.message || "The local backend could not open these PDFs.");
    }

    const openedCount = payload.opened?.length ?? 0;
    const unavailableCount = payload.unavailable?.length ?? 0;

    statusEl.textContent = openedCount
      ? `Opened ${openedCount} PDF reference${openedCount === 1 ? "" : "s"}.`
      : `No PDFs opened. ${unavailableCount ? `${unavailableCount} PDF reference${unavailableCount === 1 ? " was" : "s were"} unavailable.` : "No PDF references were found."}`;
    renderResults(payload);
  } catch (error) {
    statusEl.textContent = error instanceof Error
      ? `${error.message} Make sure the local app is running at ${LOCAL_MVP_API_BASE}.`
      : `Could not open PDFs. Make sure the local app is running at ${LOCAL_MVP_API_BASE}.`;
  } finally {
    retryButton.disabled = false;
  }
}

retryButton?.addEventListener("click", openPdfs);
openPdfs();
