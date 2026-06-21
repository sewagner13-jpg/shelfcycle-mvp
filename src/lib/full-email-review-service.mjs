import {
  buildFullEmailReview,
  fetchGmailThreadReadOnly,
  normalizeEmailDecision,
  stageEmailDecision
} from "./gmail-full-email-review.mjs";

function compactWhitespace(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function reviewError(message, statusCode = 400, code = "FULL_EMAIL_REVIEW_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function emailDomain(value = "") {
  const email = compactWhitespace(value).toLowerCase();
  return email.includes("@") ? email.split("@").pop() : "";
}

function internalDomainsForConfig(gmailConfig = {}) {
  const configured = Array.isArray(gmailConfig.internalDomains) ? gmailConfig.internalDomains : [];
  return [
    ...configured,
    emailDomain(gmailConfig.user),
    emailDomain(gmailConfig.delegatedUser)
  ].map((value) => compactWhitespace(value).toLowerCase()).filter(Boolean);
}

export async function authorizeFullEmailReview({
  actionId = "",
  token = "",
  loadAction
} = {}) {
  const id = compactWhitespace(actionId);
  const viewToken = compactWhitespace(token);

  if (!id || !viewToken) {
    throw reviewError("Missing review action id or token.", 400, "MISSING_REVIEW_TOKEN");
  }
  if (typeof loadAction !== "function") {
    throw reviewError("Review action storage is not configured.", 500, "REVIEW_STORAGE_UNAVAILABLE");
  }

  const action = await loadAction(id);

  if (!action) {
    throw reviewError("Review action not found.", 404, "REVIEW_ACTION_NOT_FOUND");
  }
  if (action.viewToken !== viewToken) {
    throw reviewError("Invalid review token.", 403, "INVALID_REVIEW_TOKEN");
  }

  return action;
}

function usableCachedReview(state = {}, action = {}) {
  const cached = state.review;
  return Boolean(
    cached?.sanitized === true &&
    cached?.gmailMutationAllowed === false &&
    cached?.threadId &&
    cached.threadId === action.threadId &&
    Array.isArray(cached.messages)
  );
}

export async function readFullEmailReview({
  action = {},
  state = {},
  gmailConfig = {},
  refresh = false,
  fetchThread = fetchGmailThreadReadOnly,
  now = () => new Date().toISOString()
} = {}) {
  const threadId = compactWhitespace(action.threadId);

  if (!threadId) {
    throw reviewError(
      "This review packet is not linked to a Gmail thread.",
      422,
      "GMAIL_THREAD_NOT_AVAILABLE"
    );
  }

  const reviewedAt = now();
  let review = usableCachedReview(state, action) ? state.review : null;
  let cached = Boolean(review);

  if (!review || refresh) {
    const thread = await fetchThread({ threadId, config: gmailConfig });
    review = buildFullEmailReview(thread, {
      externalParticipants: action.externalParticipants ?? [],
      internalDomains: internalDomainsForConfig(gmailConfig),
      checkedAt: reviewedAt
    });
    cached = false;
  }

  const sourceReviewState = {
    firstCheckedAt: state.sourceReviewState?.firstCheckedAt || review.sourceCheckedAt || reviewedAt,
    lastCheckedAt: reviewedAt,
    lastRefreshedAt: cached
      ? state.sourceReviewState?.lastRefreshedAt || review.sourceCheckedAt || reviewedAt
      : reviewedAt,
    reviewCount: Number(state.sourceReviewState?.reviewCount || 0) + 1,
    refreshCount: Number(state.sourceReviewState?.refreshCount || 0) + (cached ? 0 : 1),
    gmailMutationPerformed: false
  };
  const updatedState = {
    review,
    decisions: state.decisions ?? [],
    sourceReviewState,
    sanitized: true,
    gmailMutationPerformed: false
  };

  return {
    state: updatedState,
    review: {
      ...review,
      sourceReviewedAt: reviewedAt
    },
    decisions: updatedState.decisions,
    cached,
    gmailMutationPerformed: false
  };
}

export function applyFullEmailDecision({
  action = {},
  state = {},
  messageId = "",
  decision = "",
  now = () => new Date().toISOString()
} = {}) {
  if (!usableCachedReview(state, action)) {
    throw reviewError(
      "Read the full email before staging a decision.",
      409,
      "SOURCE_REVIEW_REQUIRED"
    );
  }

  const normalizedMessageId = compactWhitespace(messageId);
  const normalizedDecision = normalizeEmailDecision(decision);
  const sourceMessage = state.review.messages.find((message) => message.id === normalizedMessageId);

  if (!sourceMessage) {
    throw reviewError(
      "The selected message is not part of this sanitized review packet.",
      400,
      "MESSAGE_NOT_IN_REVIEW"
    );
  }
  if (!normalizedDecision) {
    throw reviewError("Unsupported email triage decision.", 400, "INVALID_TRIAGE_DECISION");
  }

  const selectedAt = now();
  const decisions = stageEmailDecision(state.decisions ?? [], {
    messageId: normalizedMessageId,
    decision: normalizedDecision,
    selectedAt
  });
  const stagedDecision = decisions.find((item) => item.messageId === normalizedMessageId);
  const updatedState = {
    ...state,
    decisions,
    sourceReviewState: {
      ...(state.sourceReviewState ?? {}),
      lastDecisionAt: selectedAt,
      gmailMutationPerformed: false
    },
    sanitized: true,
    gmailMutationPerformed: false
  };

  return {
    state: updatedState,
    decision: stagedDecision,
    decisions,
    gmailMutationPerformed: false
  };
}
