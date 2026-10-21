// subagents/types.ts — Sub-Agents Harness Data Types & Defaults
// Ported from rikkahub-agent (Pyth0nkod3r fork) SubAgentRun / SubAgentProfile / SubAgentToolPolicy

export type SubAgentStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";

export const SubAgentDefaults = {
  DEFAULT_TIMEOUT_SECONDS: 300,
  MAX_TIMEOUT_SECONDS: 1800,
  DEFAULT_MAX_TRIPS: 12,
  MAX_MAX_TRIPS: 30,
  MAX_LABEL_LENGTH: 60,
  GLOBAL_CONCURRENCY_CAP: 30,
  MIN_PER_ASSISTANT_CAP: 1,
  DEFAULT_PER_ASSISTANT_CAP: 3,
  MAX_PER_ASSISTANT_CAP: 8,
  REGISTRY_LRU_CAP: 50,

  DEFAULT_SYSTEM_PROMPT: `You are a focused sub-agent executing a delegated task.
You operate in an isolated environment with a restricted tool catalog (workspace tools and explicitly granted capabilities only).
Rules:
- Stay tightly scoped to the task you were given. Do not expand scope.
- Use tools to gather facts before answering when accuracy matters.
- Return a clear, structured final summary as your last message — that summary is what the parent will see. Aim for 100-500 words unless the task asks otherwise.
- If the task is impossible, return a single short paragraph explaining why.
- Do not ask the parent for clarification — make the best judgment call you can and proceed.`,
} as const;

export interface SubAgentProfile {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string | null;
  enabled: boolean;
  tools: string[];
  capabilities: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SubAgentRun {
  id: string;
  parentChatId: string | null;
  parentAssistantId: string;
  subConversationId: string | null;
  label: string;
  task: string;
  modelId: string | null;
  agentName: string | null;
  tools: string[] | null;
  capabilities: string[] | null;
  runInBackground: boolean;
  noResult: boolean;
  timeoutSeconds: number;
  maxTrips: number;
  status: SubAgentStatus;
  result: string | null;
  error: string | null;
  startedAtMs: number;
  finishedAtMs: number | null;
  tokensIn: number;
  tokensOut: number;
  tripCount: number;
}

export interface SubAgentRequest {
  task: string;
  modelId?: string | null;
  agentName?: string | null;
  systemPrompt?: string | null;
  tools?: string[] | null;
  runInBackground?: boolean;
  noResult?: boolean;
  timeoutSeconds?: number;
  maxTrips?: number;
  capabilities?: string[] | null;
  label?: string | null;
}

export type SubAgentRequestValidationResult =
  | { ok: true; request: Required<Pick<SubAgentRequest, "task" | "runInBackground" | "noResult" | "timeoutSeconds" | "maxTrips">> & SubAgentRequest }
  | { ok: false; error: string; detail: string };

export class SubAgentRequestValidator {
  static validate(request: SubAgentRequest): SubAgentRequestValidationResult {
    const task = String(request.task ?? "").trim();
    if (!task) {
      return { ok: false, error: "invalid_task", detail: "task is required and may not be blank" };
    }
    const timeoutSeconds = request.timeoutSeconds ?? SubAgentDefaults.DEFAULT_TIMEOUT_SECONDS;
    if (timeoutSeconds < 1) {
      return {
        ok: false,
        error: "invalid_timeout",
        detail: `timeout_seconds must be at least 1; got ${timeoutSeconds}`,
      };
    }
    if (timeoutSeconds > SubAgentDefaults.MAX_TIMEOUT_SECONDS) {
      return {
        ok: false,
        error: "invalid_timeout",
        detail: `timeout_seconds exceeds max ${SubAgentDefaults.MAX_TIMEOUT_SECONDS}; got ${timeoutSeconds}`,
      };
    }
    const maxTrips = request.maxTrips ?? SubAgentDefaults.DEFAULT_MAX_TRIPS;
    if (maxTrips < 1) {
      return {
        ok: false,
        error: "invalid_max_trips",
        detail: `max_trips must be at least 1; got ${maxTrips}`,
      };
    }
    if (maxTrips > SubAgentDefaults.MAX_MAX_TRIPS) {
      return {
        ok: false,
        error: "invalid_max_trips",
        detail: `max_trips exceeds max ${SubAgentDefaults.MAX_MAX_TRIPS}; got ${maxTrips}`,
      };
    }
    const label = request.label ? String(request.label).trim() : null;
    if (label && label.length > SubAgentDefaults.MAX_LABEL_LENGTH) {
      return {
        ok: false,
        error: "invalid_label",
        detail: `label exceeds ${SubAgentDefaults.MAX_LABEL_LENGTH} chars; got ${label.length}`,
      };
    }
    return {
      ok: true,
      request: {
        ...request,
        task,
        label: label || task.slice(0, SubAgentDefaults.MAX_LABEL_LENGTH),
        runInBackground: Boolean(request.runInBackground),
        noResult: Boolean(request.noResult),
        timeoutSeconds,
        maxTrips,
      },
    };
  }
}
