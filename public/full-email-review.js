const panelEl = document.querySelector("#full-email-review-panel");
const readButtonEl = document.querySelector("#read-full-email");
const statusEl = document.querySelector("#full-email-review-status");
const sourceCheckedEl = document.querySelector("#email-source-checked");
const contentEl = document.querySelector("#full-email-review-content");

const LOCAL_MVP_API_BASE = "http://localhost:4318";
const DECISION_LABELS = {
  create_note: "Create note",
  opportunity: "Opportunity",
  follow_up: "Follow-up",
  fyi: "FYI",
  ignore: "Ignore"
};

let currentReview = null;
let currentDecisions = [];
let earlierUnreadOpen = false;

function isLocalMvpHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value = "") {
  if (!value) {
    return "Unknown date";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function reviewParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    id: params.get("id") || "",
    token: params.get("token") || ""
  };
}

async function requestFullEmail({ method = "GET", body = null, refresh = false } = {}) {
  const { id, token } = reviewParams();

  if (!id || !token) {
    throw new Error("This review URL is missing its packet id or token.");
  }

  const query = new URLSearchParams({ id, token });
  if (refresh) {
    query.set("refresh", "1");
  }
  const path = `/api/review-action/full-email?${query.toString()}`;
  const attempts = [path];

  if (!isLocalMvpHost()) {
    attempts.push(`${LOCAL_MVP_API_BASE}${path}`);
  }

  let lastError = null;

  for (const url of attempts) {
    try {
      const response = await fetch(url, {
        method,
        cache: "no-store",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify({ ...body, id, token }) : undefined
      });
      const payload = await response.json().catch(() => ({}));

      if (response.ok && payload.ok !== false) {
        return payload;
      }

      lastError = new Error(payload.error?.message || payload.message || `Full email review failed (${response.status}).`);

      if (![404, 405, 500, 502, 503].includes(response.status)) {
        break;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Could not reach the full email review service.");
    }
  }

  throw lastError || new Error("Could not load the full email review.");
}

function decisionForMessage(messageId = "") {
  return currentDecisions.find((item) => item.messageId === messageId) ?? null;
}

function decisionButtonsHtml(messageId = "") {
  const selected = decisionForMessage(messageId)?.decision || "";

  return `
    <div class="email-decision-actions" role="group" aria-label="Triage this message">
      ${Object.entries(DECISION_LABELS).map(([value, label]) => `
        <button
          type="button"
          class="email-decision-button ${selected === value ? "selected" : ""}"
          data-email-decision="${escapeHtml(value)}"
          data-message-id="${escapeHtml(messageId)}"
          aria-pressed="${selected === value ? "true" : "false"}"
        >${escapeHtml(label)}</button>
      `).join("")}
    </div>
  `;
}

function senderSubline(message = {}) {
  const parts = [message.from?.company, message.from?.email].filter(Boolean);
  return parts.join(" · ") || "Sender details unavailable";
}

function messageCardHtml(message = {}, { featured = false, actionable = true } = {}) {
  const cleanBody = message.cleanBody || "No readable body text was found after sanitization.";
  const stagedDecision = decisionForMessage(message.id);

  return `
    <article class="email-message-card ${featured ? "featured" : ""}" data-email-message-id="${escapeHtml(message.id)}">
      <header class="email-message-header">
        <div>
          <strong>${escapeHtml(message.from?.name || message.from?.email || "Unknown sender")}</strong>
          <span>${escapeHtml(senderSubline(message))}</span>
        </div>
        <div class="email-message-meta">
          <span>${escapeHtml(formatDate(message.receivedAt || message.dateHeader))}</span>
          <span class="status-pill ${message.unread ? "status-review" : "status-ready"}">${message.unread ? "Unread" : "Read"}</span>
        </div>
      </header>
      <div class="email-clean-body">${escapeHtml(cleanBody).replace(/\n/g, "<br />")}</div>
      <div class="email-suggested-action">
        <span>Suggested action</span>
        <p>${escapeHtml(message.suggestedAction || "Review the source and choose a triage action.")}</p>
      </div>
      ${actionable ? decisionButtonsHtml(message.id) : ""}
      ${actionable ? `<p class="email-decision-state" data-decision-state="${escapeHtml(message.id)}">${stagedDecision ? `${escapeHtml(stagedDecision.label)} staged. Gmail unchanged.` : "No decision staged yet."}</p>` : ""}
    </article>
  `;
}

function messagesByIds(ids = []) {
  const byId = new Map((currentReview?.messages ?? []).map((message) => [message.id, message]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function renderReview() {
  if (!currentReview || !contentEl) {
    return;
  }

  const latest = (currentReview.messages ?? []).find((message) => message.id === currentReview.latestRelevantMessageId);
  const earlierUnread = messagesByIds(currentReview.earlierUnreadMessageIds);
  const readHistory = messagesByIds(currentReview.readHistoryMessageIds);

  contentEl.hidden = false;
  contentEl.innerHTML = `
    <div class="email-review-readonly-note">
      <strong>Read-only source review</strong>
      <span>Sanitized body text only. Gmail labels, read state, and messages are unchanged.</span>
    </div>

    <section class="email-review-section">
      <div class="email-review-section-title">
        <div>
          <p class="section-kicker">Latest relevant message</p>
          <h3>${escapeHtml(latest?.subject || currentReview.subject || "Email source")}</h3>
        </div>
      </div>
      ${latest ? messageCardHtml(latest, { featured: true }) : '<div class="empty-state">No readable Gmail message was found.</div>'}
    </section>

    ${earlierUnread.length ? `
      <section class="email-review-section earlier-unread-section">
        <div class="earlier-unread-banner">
          <div>
            <strong>${earlierUnread.length} earlier unread message${earlierUnread.length === 1 ? "" : "s"} in this thread</strong>
            <span>Review these before closing the thread.</span>
          </div>
          <button type="button" class="ghost mini" data-toggle-earlier-unread aria-expanded="${earlierUnreadOpen ? "true" : "false"}">
            ${earlierUnreadOpen ? "Hide earlier messages" : "Review earlier messages"}
          </button>
        </div>
        <div class="email-message-stack" data-earlier-unread-stack ${earlierUnreadOpen ? "" : "hidden"}>
          ${earlierUnread.map((message) => messageCardHtml(message)).join("")}
        </div>
      </section>
    ` : ""}

    ${readHistory.length ? `
      <details class="email-read-history">
        <summary>Show read thread history (${readHistory.length})</summary>
        <div class="email-message-stack">
          ${readHistory.map((message) => messageCardHtml(message, { actionable: false })).join("")}
        </div>
      </details>
    ` : ""}
  `;

  contentEl.querySelector("[data-toggle-earlier-unread]")?.addEventListener("click", () => {
    earlierUnreadOpen = !earlierUnreadOpen;
    renderReview();
  });

  for (const button of contentEl.querySelectorAll("[data-email-decision]")) {
    button.addEventListener("click", () => stageDecision(button));
  }
}

async function stageDecision(button) {
  const messageId = button.dataset.messageId || "";
  const decision = button.dataset.emailDecision || "";
  const stateEl = contentEl?.querySelector(`[data-decision-state="${CSS.escape(messageId)}"]`);

  for (const candidate of contentEl?.querySelectorAll(`[data-email-decision][data-message-id="${CSS.escape(messageId)}"]`) ?? []) {
    candidate.disabled = true;
  }
  if (stateEl) {
    stateEl.textContent = "Staging decision...";
  }

  try {
    const payload = await requestFullEmail({
      method: "POST",
      body: { messageId, decision }
    });
    currentDecisions = payload.decisions ?? [];
    renderReview();
  } catch (error) {
    if (stateEl) {
      stateEl.textContent = error instanceof Error ? error.message : "Could not stage this decision.";
    }
    for (const candidate of contentEl?.querySelectorAll(`[data-email-decision][data-message-id="${CSS.escape(messageId)}"]`) ?? []) {
      candidate.disabled = false;
    }
  }
}

async function loadFullEmail({ refresh = false } = {}) {
  if (!readButtonEl || !statusEl) {
    return;
  }

  readButtonEl.disabled = true;
  statusEl.textContent = refresh
    ? "Refreshing and sanitizing the Gmail source..."
    : "Reading and sanitizing the Gmail source...";

  try {
    const payload = await requestFullEmail({ refresh });
    currentReview = payload.review ?? null;
    currentDecisions = payload.decisions ?? [];
    earlierUnreadOpen = false;
    renderReview();

    const checkedAt = currentReview?.sourceReviewedAt || currentReview?.sourceCheckedAt || "";
    sourceCheckedEl.hidden = false;
    sourceCheckedEl.textContent = checkedAt ? `Source checked ${formatDate(checkedAt)}` : "Source checked";
    statusEl.textContent = payload.cached
      ? "Sanitized source loaded from the server cache. Gmail unchanged."
      : "Full email source checked and sanitized. Gmail unchanged.";
    readButtonEl.textContent = "Refresh source";
    readButtonEl.dataset.loaded = "true";
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : "Could not load the full email source.";
  } finally {
    readButtonEl.disabled = false;
  }
}

if (panelEl && readButtonEl) {
  readButtonEl.addEventListener("click", () => {
    loadFullEmail({ refresh: readButtonEl.dataset.loaded === "true" });
  });
}
