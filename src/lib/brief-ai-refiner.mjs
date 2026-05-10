const DEFAULT_MODEL = "gpt-5-mini";
const MAX_THREADS = 24;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_ACTIONABLE_STATES = Object.freeze(["needs_attention", "waiting_on_other_side"]);

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function truncate(value = "", maxLength = 900) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function firstExternalParticipant(item = {}) {
  return item.externalParticipants?.[0] ?? null;
}

function meaningfulAttachments(item = {}) {
  return (item.workspaceArtifacts?.attachments ?? [])
    .map((attachment) => attachment.filename)
    .filter(Boolean)
    .slice(0, 5);
}

function compactMatches(matches = {}) {
  const compact = {};

  for (const key of ["customers", "contacts", "products", "locations"]) {
    const values = (matches[key] ?? [])
      .map((entry) => entry.candidate?.name || entry.candidate?.code || entry.candidate?.email || entry.candidate?.website)
      .filter(Boolean)
      .slice(0, 5);

    if (values.length) {
      compact[key] = values;
    }
  }

  return compact;
}

function compactIntelligence(context = null) {
  if (!context) {
    return null;
  }

  const entry = context.matchedEntry ?? {};

  return {
    status: context.status || "",
    primaryChemicalEntity: context.primaryChemicalEntity?.name || context.primaryChemicalEntity || "",
    brief: truncate(context.brief || "", 420),
    lastKnownGoodPrice: entry.lastKnownGoodPrice || "",
    commercialBenchmarks: (entry.commercialBenchmarks ?? []).slice(0, 3),
    logisticsNuances: (entry.logisticsNuances ?? []).slice(0, 3),
    complianceNotes: (entry.complianceNotes ?? []).slice(0, 3),
    contradictions: (context.contradictions ?? []).slice(0, 3)
  };
}

function latestThreadExcerpts(item = {}) {
  const events = item.events ?? [];

  return events.slice(-4).map((event) => ({
    from: event.from?.name || event.from?.email || "",
    isInbound: Boolean(event.from?.email && !/@clear-edge\.net$/i.test(event.from.email)),
    timestamp: event.timestamp || 0,
    snippet: truncate(event.snippet || event.bodyText || event.joinedText || "", 500)
  }));
}

function shouldRefineThreadWithAi(item = {}, targetStates = DEFAULT_ACTIONABLE_STATES) {
  if (item.relationship?.relationship === "solicitation") {
    return false;
  }

  return targetStates.includes(item.state?.state);
}

function normalizeTargetStates(value = DEFAULT_ACTIONABLE_STATES) {
  const states = Array.isArray(value) ? value : String(value || "").split(",");
  const normalized = states
    .map((state) => String(state).trim())
    .filter(Boolean);

  return normalized.length ? normalized : [...DEFAULT_ACTIONABLE_STATES];
}

export function buildBriefAiPayload({
  analyzedThreads = [],
  messageMemory = null,
  maxThreads = MAX_THREADS,
  targetStates = DEFAULT_ACTIONABLE_STATES
} = {}) {
  const actionableStates = normalizeTargetStates(targetStates);
  const candidates = analyzedThreads
    .filter((item) => shouldRefineThreadWithAi(item, actionableStates))
    .slice(0, maxThreads)
    .map((item) => {
      const participant = firstExternalParticipant(item);

      return {
        threadId: item.threadId || "",
        source: item.source || "gmail",
        subject: item.subject || "",
        contact: {
          name: participant?.name || "",
          email: participant?.email || "",
          domain: participant?.domain || ""
        },
        relationship: item.relationship ?? {},
        state: item.state ?? {},
        silo: item.silo ?? {},
        priorityScore: item.priorityScore ?? 0,
        currentSummary: truncate(item.summary || item.analysis?.draftNote?.summary || "", 900),
        currentKeyPoints: (item.analysis?.rawExtracts?.keyPoints ?? []).slice(0, 5).map((point) => truncate(point, 220)),
        currentActionItems: (item.analysis?.rawExtracts?.actionItems ?? []).slice(0, 5).map((point) => truncate(point, 220)),
        roleWorklists: item.analysis?.roleWorklists ?? {},
        matchedEntities: compactMatches(item.analysis?.matches ?? {}),
        intelligence: compactIntelligence(item.analysis?.intelligenceContext ?? item.analysis?.notebookContext ?? null),
        suggestedCreates: (item.analysis?.suggestedCreates ?? []).slice(0, 5).map((entry) => ({
          type: entry.type || "",
          name: entry.name || entry.companyName || "",
          email: entry.email || "",
          companyName: entry.companyName || ""
        })),
        attachments: meaningfulAttachments(item),
        warnings: (item.analysis?.warnings ?? []).slice(0, 5),
        recentMessages: latestThreadExcerpts(item)
      };
    });

  return {
    company: "ClearEdge Solutions",
    operator: "Sean Wagner, president/owner responsible for sales, procurement, pricing, supplier/customer relationships, and ShelfCycle data quality",
    goal: "Rewrite the daily brief data as a concise owner/operator action dashboard. Focus on what Sean needs to decide, what matters commercially, and what could be worth entering into ShelfCycle after manual approval.",
    aiSummaryScope: "Only threads classified as needs_attention (Needs Sean) or waiting_on_other_side (Waiting on others) are sent for AI rewriting.",
    safetyRules: [
      "Never imply records should be created automatically.",
      "ShelfCycle suggestions are candidates for Sean to review, not instructions to save.",
      "Prioritize customers, suppliers, orders, pricing, SDS/TDS/COA, samples, freight, payment risk, and relationship intelligence.",
      "Ignore or downplay solicitations, newsletters, and low-signal internal noise."
    ],
    threads: candidates,
    messageMemory: messageMemory
      ? {
          businessThreads: (messageMemory.business_threads ?? []).slice(0, 8),
          urgentItems: (messageMemory.urgent_items ?? []).slice(0, 8),
          unansweredMessages: (messageMemory.unanswered_messages ?? []).slice(0, 8),
          memoryCandidates: (messageMemory.memory_candidates ?? []).slice(0, 8),
          suggestedFollowups: (messageMemory.suggested_followups ?? []).slice(0, 8)
        }
      : null
  };
}

function responseText(response = {}) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  for (const output of response.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return "";
}

function outputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      threads: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            threadId: { type: "string" },
            action: { type: "string" },
            why: { type: "string" },
            keyDetails: {
              type: "array",
              items: { type: "string" }
            },
            ownerLens: { type: "string" },
            shelfCycleCandidate: {
              type: "object",
              additionalProperties: false,
              properties: {
                shouldConsider: { type: "boolean" },
                recordType: { type: "string" },
                title: { type: "string" },
                summary: { type: "string" },
                fields: {
                  type: "array",
                  items: { type: "string" }
                }
              },
              required: ["shouldConsider", "recordType", "title", "summary", "fields"]
            },
            riskNote: { type: "string" },
            priorityReason: { type: "string" },
            confidence: { type: "number" }
          },
          required: [
            "threadId",
            "action",
            "why",
            "keyDetails",
            "ownerLens",
            "shelfCycleCandidate",
            "riskNote",
            "priorityReason",
            "confidence"
          ]
        }
      },
      messageMemory: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary: { type: "string" },
          action: { type: "string" },
          shelfCycleCandidate: { type: "string" }
        },
        required: ["summary", "action", "shelfCycleCandidate"]
      }
    },
    required: ["threads", "messageMemory"]
  };
}

export function resolveBriefAiConfig(config = {}) {
  const apiKey = firstDefined(config.apiKey, process.env.OPENAI_API_KEY);
  const enabled = config.enabled ?? Boolean(apiKey);
  const timeoutMs = Number.parseInt(
    String(firstDefined(config.timeoutMs, process.env.OPENAI_BRIEF_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
    10
  ) || DEFAULT_TIMEOUT_MS;

  return {
    enabled: Boolean(enabled && apiKey),
    apiKey,
    model: firstDefined(config.model, process.env.OPENAI_BRIEF_MODEL, process.env.OPENAI_MODEL, DEFAULT_MODEL),
    endpoint: firstDefined(config.endpoint, process.env.OPENAI_RESPONSES_ENDPOINT, "https://api.openai.com/v1/responses"),
    maxThreads: Number.parseInt(String(firstDefined(config.maxThreads, process.env.OPENAI_BRIEF_MAX_THREADS, MAX_THREADS)), 10) || MAX_THREADS,
    targetStates: normalizeTargetStates(firstDefined(config.targetStates, process.env.OPENAI_BRIEF_TARGET_STATES, DEFAULT_ACTIONABLE_STATES)),
    timeoutMs
  };
}

export async function requestBriefAiRefinement({ payload, config = {}, fetchImpl = fetch } = {}) {
  const resolved = resolveBriefAiConfig(config);

  if (!resolved.enabled) {
    return null;
  }

  const controller = typeof AbortController === "function" && resolved.timeoutMs > 0
    ? new AbortController()
    : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), resolved.timeoutMs)
    : null;

  let response;

  try {
    response = await fetchImpl(resolved.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${resolved.apiKey}`,
        "content-type": "application/json"
      },
      signal: controller?.signal,
      body: JSON.stringify({
        model: resolved.model,
        store: false,
        instructions: [
          "You are Sean Wagner's ClearEdge daily-brief analyst.",
          "Think like the president of a specialty chemicals distributor: concise, commercially aware, skeptical of noise, and careful with CRM/ERP data quality.",
          "Rewrite each thread into action-first language Sean can scan quickly.",
          "When ShelfCycle is relevant, describe what Sean may want to review or enter after approval. Do not say it was created or should be created automatically.",
          "Return only JSON matching the schema."
        ].join("\n"),
        input: JSON.stringify(payload),
        text: {
          format: {
            type: "json_schema",
            name: "clearedge_brief_refinement",
            strict: true,
            schema: outputSchema()
          }
        }
      })
    });
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(`OpenAI brief refinement timed out after ${resolved.timeoutMs}ms.`);
    }

    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI brief refinement failed (${response.status}): ${truncate(errorText, 500)}`);
  }

  const data = await response.json();
  const text = responseText(data);

  if (!text) {
    return null;
  }

  return JSON.parse(text);
}

export function applyBriefAiRefinement({ analyzedThreads = [], messageMemory = null, refinement = null } = {}) {
  if (!refinement) {
    return { analyzedThreads, messageMemory };
  }

  const byThreadId = new Map((refinement.threads ?? []).map((item) => [item.threadId, item]));
  const nextThreads = analyzedThreads.map((item) => {
    const briefAi = byThreadId.get(item.threadId);

    if (!briefAi) {
      return item;
    }

    return {
      ...item,
      briefAi,
      analysis: {
        ...item.analysis,
        briefAi
      }
    };
  });
  const nextMessageMemory = messageMemory && refinement.messageMemory
    ? {
        ...messageMemory,
        briefAi: refinement.messageMemory
      }
    : messageMemory;

  return {
    analyzedThreads: nextThreads,
    messageMemory: nextMessageMemory
  };
}

export async function refineBriefWithAi({ analyzedThreads = [], messageMemory = null, config = {}, fetchImpl = fetch } = {}) {
  const resolved = resolveBriefAiConfig(config);

  if (!resolved.enabled) {
    return {
      analyzedThreads,
      messageMemory,
      status: "disabled"
    };
  }

  const payload = buildBriefAiPayload({
    analyzedThreads,
    messageMemory,
    maxThreads: resolved.maxThreads,
    targetStates: resolved.targetStates
  });
  const refinement = await requestBriefAiRefinement({ payload, config: resolved, fetchImpl });
  const applied = applyBriefAiRefinement({ analyzedThreads, messageMemory, refinement });

  return {
    ...applied,
    status: refinement ? "refined" : "empty",
    refinement
  };
}
