// tools/subagent-tools.ts — Sub-Agent Tool Definitions and Invocation Handlers
// Ported from rikkahub-agent (Pyth0nkod3r fork) SubAgentTools.kt

import type { JsonValue } from "../foundation/types";
import {
  SubAgentDefaults,
  type SubAgentProfile,
  type SubAgentRun,
} from "../subagents/types";
import { SUBAGENT_CAPABILITIES } from "../subagents/policy";
import { listSubAgentProfiles } from "../subagents/db";
import { subAgentEngine, SubAgentEngine, SubAgentProfileResolver } from "../subagents/engine";
import { subAgentRegistry, SubAgentRegistry } from "../subagents/registry";
import { executeSubAgentDag, type DagTaskSpec } from "../subagents/dag";

const AGENT_NAME_ARG_ALIASES = [
  "agent",
  "role",
  "subagent_type",
  "subagentType",
  "agent_name",
  "agentName",
  "profile",
  "profile_name",
  "profileName",
  "type",
] as const;

/**
 * Extracts a sub-agent profile name from common LLM argument aliases,
 * label prefixes (e.g. "Researcher: inspect X"), or explicit task delegation phrases.
 */
export function extractAgentName(rawArgs: Record<string, JsonValue> | undefined): string | undefined {
  if (!rawArgs) return undefined;
  for (const key of AGENT_NAME_ARG_ALIASES) {
    const val = rawArgs[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  const label = typeof rawArgs.label === "string" ? rawArgs.label.trim() : "";
  if (label) {
    const colonMatch = /^([A-Za-z0-9_-]{2,32})\s*[:\-]\s+/.exec(label);
    if (colonMatch) return colonMatch[1].trim();
  }
  const task = typeof rawArgs.task === "string" ? rawArgs.task.trim() : "";
  if (task) {
    const actMatch = /^\s*(?:act\s+as|as\s+(?:a|an|the)|role\s*[:=])\s+([A-Za-z0-9_-]{2,32})\b/i.exec(task);
    if (actMatch) return actMatch[1].trim();
  }
  return undefined;
}

export function encodeRun(run: SubAgentRun): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {
    id: run.id,
    status: run.status,
    label: run.label,
    run_in_background: run.runInBackground,
    timeout_seconds: run.timeoutSeconds,
    max_trips: run.maxTrips,
    started_at_ms: run.startedAtMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    trip_count: run.tripCount,
  };
  if (run.modelId) result.model_id = run.modelId;
  if (run.resolvedModelSlug) result.resolved_model = run.resolvedModelSlug;
  if (run.resolvedModelId) result.resolved_model_uuid = run.resolvedModelId;
  if (run.providerName) result.provider = run.providerName;
  if (run.providerType) result.provider_type = run.providerType;
  if (run.endpoint) result.endpoint = run.endpoint;
  if (run.httpStatus != null) result.http_status = run.httpStatus;
  if (run.resumedAfterMs != null) result.resumed_after_ms = run.resumedAfterMs;
  if (run.attemptedModel) result.attempted_model = run.attemptedModel;
  if (run.fallbackReason) result.fallback_reason = run.fallbackReason;
  if (run.attemptedModel) result.attempted_model = run.attemptedModel;
  if (run.fallbackReason) result.fallback_reason = run.fallbackReason;
  if (run.agentName) {
    result.agent = run.agentName;
    result.role = run.agentName;
    result.subagent_name = run.agentName;
  }
  if (run.verificationVerdict) result.verification_verdict = run.verificationVerdict;
  if (run.verificationSummary != null) result.verification_summary = run.verificationSummary;
  if (run.subConversationId) result.sub_conversation_id = run.subConversationId;
  if (run.finishedAtMs != null) result.finished_at_ms = run.finishedAtMs;
  if (run.result != null && !run.noResult) {
    result.result = run.result;
  } else if (run.noResult) {
    result.result_suppressed = true;
  }
  if (run.isolateWorktree) result.isolate_worktree = run.isolateWorktree;
  if (run.worktreeDiff != null) result.worktree_diff = run.worktreeDiff;
  if (run.error != null) result.error = run.error;
  return result;
}

export function openAiSubAgentTools(profiles: SubAgentProfile[] = listSubAgentProfiles()) {
  const enabled = SubAgentProfileResolver.enabledProfiles(profiles);

  let dispatchDesc = `Dispatch a focused sub-agent — a clean-context LLM run that returns a concise summary.
Use when the task is an independent, multi-step workload (e.g. deep research or parallel feature building) that would otherwise pollute your context with intermediate noise, OR when the user explicitly asks for parallel delegation.\nDo NOT use for casual conversation, direct questions, or simple single-file edits — answer those directly inline.
Pass a clear, self-contained task. For long-running work, set run_in_background=true and poll with subagent_get; otherwise foreground (default) blocks until terminal.`;

  if (enabled.length > 0) {
    dispatchDesc += `\n\nConfigured specialist profiles (pass name as agent):\n` +
      enabled.map((p) => `- ${p.name}: ${p.description || "Specialist agent"}`).join("\n");
  }

  const validCaps = Object.keys(SUBAGENT_CAPABILITIES).join(", ");

  return [
    {
      type: "function" as const,
      function: {
        name: "subagent_dispatch",
        description: dispatchDesc,
        parameters: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description: "The clear, self-contained task description for the sub-agent.",
            },
            label: {
              type: "string",
              description: "Short human-readable label identifying this sub-agent (max 60 chars).",
            },
            agent: {
              type: "string",
              description:
                "Name of a configured sub-agent profile (case-insensitive). Inherits profile system prompt, tools, and model.",
            },
            model_id: {
              type: "string",
              description:
                "Explicit model ID or display name. Takes precedence over agent profile model. Omit to inherit profile/parent model.",
            },
            system_prompt: {
              type: "string",
              description: "Custom system prompt for this sub-agent run.",
            },
            tools: {
              type: "array",
              items: { type: "string" },
              description: "Additional specific tool names to grant to this sub-agent.",
            },
            capabilities: {
              type: "array",
              items: { type: "string" },
              description: `Opt-in capability categories. Sub-agents get workspace tools by default. Grant more with: ${validCaps}.`,
            },
            isolate_worktree: {
              type: "boolean",
              description: "If true, isolates the sub-agent into an independent git worktree branch to avoid file collisions with concurrent tasks.",
            },
            run_in_background: {
              type: "boolean",
              description: "If true, returns immediately while sub-agent runs in background.",
            },
            no_result: {
              type: "boolean",
              description: "If true, suppresses returning the final output to keep parent context minimal.",
            },
            timeout_seconds: {
              type: "integer",
              description: `Execution timeout in seconds (1 to ${SubAgentDefaults.MAX_TIMEOUT_SECONDS}, default ${SubAgentDefaults.DEFAULT_TIMEOUT_SECONDS}).`,
            },
            max_trips: {
              type: "integer",
              description: `Maximum tool roundtrips allowed (1 to ${SubAgentDefaults.MAX_MAX_TRIPS}, default ${SubAgentDefaults.DEFAULT_MAX_TRIPS}).`,
            },
          },
          required: ["task"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "subagent_list",
        description: "List sub-agent runs visible to this conversation. Set active_only=true to omit terminal runs.",
        parameters: {
          type: "object",
          properties: {
            active_only: {
              type: "boolean",
              description: "Filter only pending or running sub-agents.",
            },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "subagent_get",
        description: "Fetch the status, result, and metadata of a sub-agent run by its run ID.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The unique sub-agent run ID.",
            },
          },
          required: ["id"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "subagent_cancel",
        description: "Cancel an active sub-agent run by its run ID.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The unique sub-agent run ID to cancel.",
            },
          },
          required: ["id"],
        },
      },
    },
      {
      type: "function" as const,
      function: {
        name: "subagent_reinject",
        description:
          "Reinject a prompt to continue an existing sub-agent run (e.g. if it failed, timed out, or stopped before completing its task). All previous context and findings are preserved.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The unique run ID of the sub-agent to continue.",
            },
            prompt: {
              type: "string",
              description: "The prompt or continuation instruction to reinject into the sub-agent.",
            },
            run_in_background: {
              type: "boolean",
              description: "If true, returns immediately while sub-agent continues in background.",
            },
            timeout_seconds: {
              type: "number",
              description: "Optional timeout in seconds for this continuation run.",
            },
          },
          required: ["id", "prompt"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "subagent_dag_run",
        description:
          "Execute a declarative DAG of dependent sub-agent tasks with bounded parallelism, topological wave scheduling, and upstream failure skip propagation.",
        parameters: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              description: "Ordered or dependency-linked list of sub-agent tasks (max 20).",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Unique short identifier for this DAG node." },
                  task: { type: "string", description: "Self-contained prompt for this sub-agent task." },
                  label: { type: "string", description: "Optional short display label." },
                  depends_on: {
                    type: "array",
                    items: { type: "string" },
                    description: "IDs of upstream tasks that must finish before this task runs.",
                  },
                  agent: { type: "string", description: "Optional sub-agent profile name/role." },
                  model_id: { type: "string", description: "Optional model override." },
                  tools: { type: "array", items: { type: "string" } },
                  capabilities: { type: "array", items: { type: "string" } },
                  run_condition: {
                    type: "string",
                    enum: ["on_success", "always"],
                    description: "Whether to skip on upstream failure (default on_success).",
                  },
                  isolate_worktree: { type: "boolean" },
                  timeout_seconds: { type: "integer" },
                  max_trips: { type: "integer" },
                },
                required: ["id", "task"],
              },
            },
            max_parallel: {
              type: "integer",
              description: "Maximum concurrent tasks per DAG wave (1 to 6, default 3).",
            },
          },
          required: ["tasks"],
        },
      },
    },
  ];
}

export async function executeSubAgentTool(
  toolName: string,
  args: Record<string, JsonValue>,
  context?: {
    conversationId?: string;
    assistantId?: string;
  },
  engine: SubAgentEngine = subAgentEngine,
  registry: SubAgentRegistry = subAgentRegistry,
): Promise<Record<string, JsonValue>> {
  if (toolName === "subagent_dispatch") {
    const parentChatId = context?.conversationId ?? null;
    const parentAssistantId = context?.assistantId ?? "";

    const task = String(args.task ?? "").trim();
    if (!task) throw new Error("task is required for subagent_dispatch");

    const tools = Array.isArray(args.tools)
      ? (args.tools as JsonValue[]).map(String)
      : undefined;

    const capabilities = Array.isArray(args.capabilities)
      ? (args.capabilities as JsonValue[]).map(String)
      : undefined;

    const res = await engine.dispatch(parentAssistantId, parentChatId, {
      task,
      label: args.label ? String(args.label) : undefined,
      agentName: extractAgentName(args),
      modelId: args.model_id ? String(args.model_id) : undefined,
      systemPrompt: args.system_prompt ? String(args.system_prompt) : undefined,
      tools,
      capabilities,
      runInBackground: Boolean(args.run_in_background),
      noResult: Boolean(args.no_result),
      timeoutSeconds: args.timeout_seconds ? Number(args.timeout_seconds) : undefined,
      maxTrips: args.max_trips ? Number(args.max_trips) : undefined,
      isolateWorktree: Boolean(args.isolate_worktree),
    });

    if (!res.ok) {
      throw new Error(`[subagent_dispatch error ${res.error}] ${res.detail}`);
    }

    return encodeRun(res.run);
  }

  if (toolName === "subagent_list") {
    const activeOnly = Boolean(args.active_only);
    const runs = registry.list(activeOnly);
    return {
      runs: runs.map((r) => ({
        id: r.id,
        label: r.label,
        status: r.status,
        model_id: r.modelId,
        started_at_ms: r.startedAtMs,
        finished_at_ms: r.finishedAtMs,
        trip_count: r.tripCount,
      })),
    };
  }

  if (toolName === "subagent_get") {
    const id = String(args.id ?? "").trim();
    if (!id) throw new Error("id is required for subagent_get");
    const run = registry.get(id);
    if (!run) throw new Error(`Sub-agent run not found: ${id}`);
    return encodeRun(run);
  }

  if (toolName === "subagent_cancel") {
    const id = String(args.id ?? "").trim();
    if (!id) throw new Error("id is required for subagent_cancel");
    const ok = registry.requestCancel(id);
    if (ok) {
      registry.update(id, (r) => ({ ...r, status: "cancelled", finishedAtMs: Date.now() }));
    }
    return { ok, id };
  }

  if (toolName === "subagent_reinject") {
    const id = String(args.id ?? "").trim();
    if (!id) throw new Error("id is required for subagent_reinject");
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) throw new Error("prompt is required for subagent_reinject");

    const res = await engine.reinject(id, prompt, {
      timeoutSeconds: args.timeout_seconds ? Number(args.timeout_seconds) : undefined,
      runInBackground: Boolean(args.run_in_background),
    });

    if (!res.ok) {
      throw new Error(`[subagent_reinject error ${res.error}] ${res.detail}`);
    }

    return encodeRun(res.run);
  }

  if (toolName === "subagent_dag_run") {
    const parentChatId = context?.conversationId ?? null;
    const parentAssistantId = context?.assistantId ?? "";
    const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
    const parsedTasks: DagTaskSpec[] = rawTasks.map((item) => {
      const obj = (item && typeof item === "object" ? item : {}) as Record<string, JsonValue>;
      return {
        id: String(obj.id ?? ""),
        task: String(obj.task ?? ""),
        label: obj.label ? String(obj.label) : undefined,
        dependsOn: Array.isArray(obj.depends_on) ? (obj.depends_on as JsonValue[]).map(String) : undefined,
        agent: extractAgentName(obj),
        modelId: obj.model_id ? String(obj.model_id) : undefined,
        tools: Array.isArray(obj.tools) ? (obj.tools as JsonValue[]).map(String) : undefined,
        capabilities: Array.isArray(obj.capabilities) ? (obj.capabilities as JsonValue[]).map(String) : undefined,
        runCondition: obj.run_condition === "always" ? "always" : "on_success",
        isolateWorktree: Boolean(obj.isolate_worktree),
        timeoutSeconds: obj.timeout_seconds ? Number(obj.timeout_seconds) : undefined,
        maxTrips: obj.max_trips ? Number(obj.max_trips) : undefined,
      };
    });

    const dagRes = await executeSubAgentDag({
      tasks: parsedTasks,
      parentAssistantId,
      parentChatId,
      maxParallel: args.max_parallel ? Number(args.max_parallel) : undefined,
      engine,
    });
    return dagRes as unknown as Record<string, JsonValue>;
  }

  throw new Error(`Unknown subagent tool: ${toolName}`);
}
