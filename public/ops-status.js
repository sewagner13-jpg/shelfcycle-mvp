const LOCAL_BACKEND_ORIGIN = "http://localhost:4318";

function escapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function apiUrl(path = "") {
  const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  return isLocal ? path : `${LOCAL_BACKEND_ORIGIN}${path}`;
}

async function fetchOpsStatus() {
  const response = await fetch(apiUrl("/api/ops/status"), {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok || !contentType.includes("application/json")) {
    throw new Error("Local ClearEdge backend is not reachable.");
  }

  return response.json();
}

function formatDate(value = "") {
  if (!value) {
    return "Not recorded";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function ageLabel(hours) {
  if (typeof hours !== "number") {
    return "Unknown age";
  }

  if (hours < 1) {
    return "Updated within the last hour";
  }

  if (hours < 48) {
    return `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"} old`;
  }

  return `${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? "" : "s"} old`;
}

function cardHtml({ label, value, detail, tone = "review" } = {}) {
  return `
    <article class="ops-status-card ops-status-${escapeHtml(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function renderStatus(container, payload) {
  const reference = payload.referenceSnapshot ?? {};
  const lastWrite = payload.lastShelfCycleWrite ?? {};
  const hostedSync = payload.hostedReviewSync ?? {};
  const lastWriteValue = lastWrite.lastSuccessfulAt ? formatDate(lastWrite.lastSuccessfulAt) : "No write logged";
  const referenceDetail = reference.available
    ? `${ageLabel(reference.ageHours)}. ${reference.counts?.customers ?? 0} customers, ${reference.counts?.suppliers ?? 0} suppliers, ${reference.counts?.contacts ?? 0} contacts, ${reference.counts?.products ?? 0} products.`
    : reference.warning || "Reference data is unavailable.";

  container.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="section-kicker">ShelfCycle Write Status</p>
        <h2>Approval-first automation state</h2>
      </div>
      <span class="status-pill ${payload.localRunner?.connected ? "status-live" : "status-review"}">
        ${payload.localRunner?.connected ? "Local runner connected" : "Preview only"}
      </span>
    </div>
    <div class="ops-status-grid">
      ${cardHtml({
        label: "ShelfCycle API",
        value: payload.shelfCycleApi?.label || "Not available",
        detail: payload.shelfCycleApi?.detail || "Writes require approved local browser automation.",
        tone: "review"
      })}
      ${cardHtml({
        label: "Local Runner",
        value: payload.localRunner?.label || "Connected",
        detail: payload.localRunner?.detail || "Local backend is serving this page.",
        tone: "live"
      })}
      ${cardHtml({
        label: "Browser Automation",
        value: payload.browserAutomation?.label || "Unknown",
        detail: payload.browserAutomation?.detail || "Approve actions before automation starts.",
        tone: payload.browserAutomation?.available ? "ready" : "review"
      })}
      ${cardHtml({
        label: "Hosted Review Links",
        value: hostedSync.status === "ok" ? "Synced" : hostedSync.status === "warning" ? "Check sync" : "Unknown",
        detail: hostedSync.detail || "Hosted packets let review links open away from this Mac.",
        tone: hostedSync.status === "ok" ? "ready" : "review"
      })}
      ${cardHtml({
        label: "Last ShelfCycle Write",
        value: lastWriteValue,
        detail: lastWrite.verification || "Verify in ShelfCycle after every automation run.",
        tone: lastWrite.lastSuccessfulAt ? "ready" : "review"
      })}
      ${cardHtml({
        label: "Reference Snapshot",
        value: reference.available ? formatDate(reference.updatedAt) : "Unavailable",
        detail: referenceDetail,
        tone: reference.available ? "ready" : "review"
      })}
    </div>
  `;
}

function renderOffline(container) {
  container.innerHTML = `
    <div class="panel-header">
      <div>
        <p class="section-kicker">ShelfCycle Write Status</p>
        <h2>Preview-only mode</h2>
      </div>
      <span class="status-pill status-review">Local runner offline</span>
    </div>
    <p class="empty-state">
      This hosted page can show packets and links, but approved ShelfCycle entries require the local ClearEdge backend running at localhost:4318.
    </p>
  `;
}

async function initOpsStatus() {
  const containers = [...document.querySelectorAll("[data-ops-status]")];

  if (!containers.length) {
    return;
  }

  for (const container of containers) {
    container.innerHTML = `
      <div class="panel-header">
        <div>
          <p class="section-kicker">ShelfCycle Write Status</p>
          <h2>Checking local runner...</h2>
        </div>
        <span class="status-pill status-ready">Checking</span>
      </div>
    `;
  }

  try {
    const payload = await fetchOpsStatus();
    for (const container of containers) {
      renderStatus(container, payload);
    }
  } catch {
    for (const container of containers) {
      renderOffline(container);
    }
  }
}

initOpsStatus();
