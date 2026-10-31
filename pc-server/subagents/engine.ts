// subagents/engine.ts — Sub-Agent Execution Engine
// Ported from rikkahub-agent (Pyth0nkod3r fork) SubAgentEngine.kt

import { id as newId, message as createMessage, textFromParts } from "../foundation/utils";
import type { Conversation, MessageNode, Provider, Model } from "../foundation/types";
import { state } from "../persistence/json-store";
import {
  getConversation,
  persistConversation,
} from "../conversations";
import { checkoutConversation, registerConversation, releaseConversation } from "../conversations/working-set";
import { generateAnswer } from "../conversations/orchestrator";
import { abortGeneration, generating } from "../conversations/generation-state";
import { broadcastConversation, broadcastList, broadcastNodeUpdate } from "../api/sse";
import { findAssistant } from "../conversations/helpers";
import {
  SubAgentDefaults,
  SubAgentRequestValidator,
  type SubAgentProfile,
  type SubAgentRequest,
  type SubAgentRun,
  type SubAgentStatus,
} from "./types";
import {
  buildSubAgentToolPolicy,
  SubAgentToolPolicies,
} from "./policy";
import { getSubAgentRun, listSubAgentProfiles } from "./db";
import { subAgentRegistry, SubAgentRegistry } from "./registry";

export type ModelResolutionResult =
  | { type: "inherit" }
  | { type: "resolved"; modelId: string }
  | { type: "failed"; message: string };

export class SubAgentModelResolver {
  static resolve(
    modelIdInput: string | null | undefined,
    providers: Provider[],
  ): ModelResolutionResult {
    const input = (modelIdInput ?? "").trim();
    if (!input) return { type: "inherit" };

    const enabledProviders = providers.filter((p) => p.enabled !== false);
    const candidates: Array<{ provider: Provider; model: Model }> = [];
    for (const p of enabledProviders) {
      for (const m of p.models) {
        candidates.push({ provider: p, model: m });
      }
    }

    const candidateLine = (c: { provider: Provider; model: Model }) =>
      `${c.model.displayName || c.model.modelId} (${c.provider.name}) -> ${c.model.id}`;

    // 1. Exact ID match
    const byId = candidates.find((c) => c.model.id === input);
    if (byId) return { type: "resolved", modelId: byId.model.id };

    // 2. Case-insensitive exact match on modelId
    const byModelId = candidates.filter(
      (c) => c.model.modelId.toLowerCase() === input.toLowerCase(),
    );
    if (byModelId.length === 1) return { type: "resolved", modelId: byModelId[0].model.id };
    if (byModelId.length > 1) {
      return {
        type: "failed",
        message:
          `model_id "${input}" matches multiple models - retry with one of these IDs:\n` +
          byModelId.map(candidateLine).join("\n"),
      };
    }

    // 3. Case-insensitive exact match on displayName
    const byName = candidates.filter(
      (c) => (c.model.displayName ?? "").toLowerCase() === input.toLowerCase(),
    );
    if (byName.length === 1) return { type: "resolved", modelId: byName[0].model.id };
    if (byName.length > 1) {
      return {
        type: "failed",
        message:
          `model_id "${input}" matches multiple models - retry with one of these IDs:\n` +
          byName.map(candidateLine).join("\n"),
      };
    }

    return {
      type: "failed",
      message:
        candidates.length === 0
          ? `model_id "${input}" did not match any model, and no models are available from enabled providers`
          : `model_id "${input}" did not match any model. Available models:\n` +
            candidates.map(candidateLine).join("\n"),
    };
  }
}

export type ProfileResolutionResult =
  | { type: "not_requested" }
  | { type: "resolved"; profile: SubAgentProfile }
  | { type: "failed"; message: string };

export class SubAgentProfileResolver {
  static enabledProfiles(profiles: SubAgentProfile[]): SubAgentProfile[] {
    return profiles.filter((p) => p.enabled);
  }

  static resolve(
    agentName: string | null | undefined,
    profiles: SubAgentProfile[],
  ): ProfileResolutionResult {
    const input = (agentName ?? "").trim();
    if (!input) return { type: "not_requested" };

    const enabled = this.enabledProfiles(profiles);
    const matches = enabled.filter((p) => p.name.toLowerCase() === input.toLowerCase());

    if (matches.length > 1) {
      return {
        type: "failed",
        message:
          `agent "${input}" matches multiple sub-agent profiles - rename duplicates: ` +
          matches.map((p) => p.name).join(", "),
      };
    }

    if (matches.length === 1) {
      return { type: "resolved", profile: matches[0] };
    }

    return {
      type: "failed",
      message:
        enabled.length === 0
          ? `agent "${input}" did not match any sub-agent profile, and no profiles are configured`
          : `agent "${input}" did not match any enabled sub-agent profile. Available: ` +
            enabled.map((p) => p.name).join(", "),
    };
  }
}

export function resolveSubAgentModel(
  modelResolution: ModelResolutionResult,
  profile: SubAgentProfile | null,
  providers?: Provider[],
): ModelResolutionResult {
  if (modelResolution.type === "inherit" && profile) {
    if (!providers || providers.length === 0) {
      if (profile.modelId) return { type: "resolved", modelId: profile.modelId };
      return modelResolution;
    }

    const enabledProviders = providers.filter((p) => p.enabled !== false);
    const chatCandidates: Array<{ provider: Provider; model: Model }> = [];
    for (const p of enabledProviders) {
      for (const m of p.models) {
        if (m.type === "CHAT" || !m.type) {
          chatCandidates.push({ provider: p, model: m });
        }
      }
    }

    const candidateLine = (c: { provider: Provider; model: Model }) =>
      `${c.model.displayName || c.model.modelId} (${c.provider.name}) -> ${c.model.id}`;

    // Tier 1: Exact UUID match in enabled providers
    if (profile.modelId) {
      const byUuid = chatCandidates.find((c) => c.model.id === profile.modelId);
      if (byUuid) return { type: "resolved", modelId: byUuid.model.id };
    }

    // Tier 2: Provider affinity match (resilience against catalog refresh where model UUID changed)
    const targetSlug = (profile.modelSlug || "").trim().toLowerCase();
    if (profile.providerId && targetSlug) {
      const provider = enabledProviders.find((p) => p.id === profile.providerId);
      const model = provider?.models.find(
        (m) => (m.type === "CHAT" || !m.type) && m.modelId.toLowerCase() === targetSlug,
      );
      if (model) return { type: "resolved", modelId: model.id };
    }

    // Tier 3 & 4: Model slug matching across enabled providers
    if (targetSlug) {
      const bySlug = chatCandidates.filter((c) => c.model.modelId.toLowerCase() === targetSlug);
      if (bySlug.length === 1) {
        return { type: "resolved", modelId: bySlug[0].model.id };
      }
      if (bySlug.length > 1) {
        return {
          type: "failed",
          message:
            `Sub-agent profile '${profile.name}' configured model '${profile.modelSlug}' is ambiguous ` +
            `across multiple providers (${bySlug.length} matches):\n` +
            bySlug.map(candidateLine).join("\n") +
            `\nSelect a specific provider in Settings → Sub-agents.`,
        };
      }
    }

    // Explicitly configured model not available or provider disabled
    const anyCandidates: Array<{ provider: Provider; model: Model }> = [];
    for (const p of providers) {
      for (const m of p.models) {
        anyCandidates.push({ provider: p, model: m });
      }
    }
    const anyMatch = anyCandidates.find(
      (c) =>
        (profile.modelId && c.model.id === profile.modelId) ||
        (targetSlug && c.model.modelId.toLowerCase() === targetSlug),
    );
    if (anyMatch && anyMatch.provider.enabled === false) {
      return {
        type: "failed",
        message: `Refusing silent fallback: profile "${profile.name}" specifies model "${profile.modelSlug || profile.modelId}" but provider "${anyMatch.provider.name}" is disabled`,
      };
    }

    return {
      type: "failed",
      message: `Sub-agent profile '${profile.name}' configured model (${profile.modelSlug || profile.modelId}) is not available or its provider is disabled. Refusing silent fallback.`,
    };
  }
  return modelResolution;
}

export type DispatchResult =
  | { ok: true; run: SubAgentRun }
  | { ok: false; error: string; detail: string };

export class SubAgentEngine {
  constructor(private registry: SubAgentRegistry = subAgentRegistry) {}

  async dispatch(
    parentAssistantId: string,
    parentChatId: string | null,
    request: SubAgentRequest,
  ): Promise<DispatchResult> {
    // 1. Recursion guard: reject if parent is already a subagent conversation
    if (parentChatId && SubAgentToolPolicies.isSubAgent(parentChatId)) {
      return {
        ok: false,
        error: "no_recursion",
        detail: "sub-agent dispatch is not allowed from inside another sub-agent run",
      };
    }

    // 2. Request validation
    const validation = SubAgentRequestValidator.validate(request);
    if (!validation.ok) {
      return { ok: false, error: validation.error, detail: validation.detail };
    }
    const cleaned = validation.request;

    // 3. Concurrency caps
    if (this.registry.globalActiveCount() >= SubAgentDefaults.GLOBAL_CONCURRENCY_CAP) {
      return {
        ok: false,
        error: "global_cap_reached",
        detail: `max ${SubAgentDefaults.GLOBAL_CONCURRENCY_CAP} concurrent sub-agents across all assistants`,
      };
    }

    const assistantCap = this.getAssistantCap(parentAssistantId);
    if (this.registry.activeCountForAssistant(parentAssistantId) >= assistantCap) {
      return {
        ok: false,
        error: "assistant_cap_reached",
        detail: `this assistant's concurrent sub-agents cap of ${assistantCap} is reached`,
      };
    }

    const runId = newId();
    const now = Date.now();
    const initialRun: SubAgentRun = {
      id: runId,
      parentChatId,
      parentAssistantId,
      subConversationId: null,
      label: cleaned.label ?? cleaned.task.slice(0, SubAgentDefaults.MAX_LABEL_LENGTH),
      task: cleaned.task,
      modelId: cleaned.modelId ?? null,
      agentName: cleaned.agentName ?? null,
      tools: cleaned.tools ? Array.from(cleaned.tools) : null,
      capabilities: cleaned.capabilities ? Array.from(cleaned.capabilities) : null,
      runInBackground: cleaned.runInBackground,
      noResult: cleaned.noResult,
      timeoutSeconds: cleaned.timeoutSeconds,
      maxTrips: cleaned.maxTrips,
      status: "pending",
      result: null,
      error: null,
      startedAtMs: now,
      finishedAtMs: null,
      tokensIn: 0,
      tokensOut: 0,
      tripCount: 0,
    };

    const controller = new AbortController();
    this.registry.addPending(initialRun, controller);

    const executionPromise = this.executeRun(runId, parentAssistantId, parentChatId, cleaned, controller);

    if (cleaned.runInBackground) {
      // In background mode, launch asynchronously and return initial run
      void executionPromise.catch((err) => {
        console.error(`[subagent] background execution failed for ${runId}:`, err);
      });
      return { ok: true, run: this.registry.get(runId) ?? initialRun };
    } else {
      // In foreground mode, wait for completion
      await executionPromise;
      return { ok: true, run: this.registry.get(runId) ?? initialRun };
    }
  }

  private getAssistantCap(assistantId: string): number {
    try {
      const assistant = findAssistant(assistantId);
      const cap = Number((assistant as unknown as Record<string, unknown>).maxConcurrentSubAgents);
      if (Number.isFinite(cap)) {
        return Math.max(
          SubAgentDefaults.MIN_PER_ASSISTANT_CAP,
          Math.min(SubAgentDefaults.MAX_PER_ASSISTANT_CAP, cap),
        );
      }
    } catch {
      // Fallback
    }
    return SubAgentDefaults.DEFAULT_PER_ASSISTANT_CAP;
  }

  private async executeRun(
    runId: string,
    parentAssistantId: string,
    parentChatId: string | null,
    request: Required<Pick<SubAgentRequest, "task" | "runInBackground" | "noResult" | "timeoutSeconds" | "maxTrips">> & SubAgentRequest,
    controller: AbortController,
  ): Promise<void> {
    this.registry.update(runId, (r) => ({ ...r, status: "running" }));

    const profiles = listSubAgentProfiles();
    const profileRes = SubAgentProfileResolver.resolve(request.agentName, profiles);
    if (profileRes.type === "failed") {
      this.markTerminal(runId, "failed", profileRes.message);
      return;
    }
    const profile = profileRes.type === "resolved" ? profileRes.profile : null;

    const providers = state?.settings?.providers ?? [];
    const modelRes = resolveSubAgentModel(
      SubAgentModelResolver.resolve(request.modelId, providers),
      profile,
      providers,
    );
    if (modelRes.type === "failed") {
      this.markTerminal(runId, "failed", modelRes.message);
      return;
    }
    const resolvedChatModelId = modelRes.type === "resolved" ? modelRes.modelId : null;

    const subAgentSystemPrompt =
      request.systemPrompt?.trim() ||
      profile?.systemPrompt?.trim() ||
      SubAgentDefaults.DEFAULT_SYSTEM_PROMPT;

    // Tool policy resolution
    const roleTools = [
      ...(request.tools ?? []),
      ...(profile?.tools ?? []),
    ];
    const capabilities = [
      ...(request.capabilities ?? []),
      ...(profile?.capabilities ?? []),
    ];

    const policyBuilt = buildSubAgentToolPolicy(roleTools, capabilities);
    if (!policyBuilt.ok) {
      this.markTerminal(runId, "failed", `Unknown capabilities: ${policyBuilt.unknownCapabilities.join(", ")}`);
      return;
    }
    const toolPolicy = policyBuilt.policy;

    // Check parent conversation's workspace binding & assistant
    let workspaceId: string | null = null;
    let workspaceCwd: string | null = null;
    let effectiveAssistantId = parentAssistantId?.trim();
    let inheritedModelId: string | null = null;
    if (parentChatId) {
      const parentConv = getConversation(parentChatId);
      if (parentConv) {
        if (!effectiveAssistantId) effectiveAssistantId = parentConv.assistantId;
        inheritedModelId = parentConv.chatModelId ?? null;
        if (parentConv.workspaceId) {
          workspaceId = parentConv.workspaceId;
          workspaceCwd = parentConv.workspaceCwd ?? null;
        }
      }
    }
    if (!effectiveAssistantId) {
      effectiveAssistantId = state?.settings?.assistantId ?? "";
    }
    if (!inheritedModelId) {
      try {
        const parentAssistant = findAssistant(effectiveAssistantId);
        inheritedModelId = parentAssistant.chatModelId ?? state?.settings?.chatModelId ?? null;
      } catch {
        inheritedModelId = state?.settings?.chatModelId ?? null;
      }
    }
    const finalSubModelId = resolvedChatModelId ?? inheritedModelId;

    // Create isolated conversation
    const subConvId = newId();
    const now = Date.now();
    const subConversation: Conversation = {
      id: subConvId,
      assistantId: effectiveAssistantId,
      chatModelId: finalSubModelId,
      systemPrompt: subAgentSystemPrompt,
      title: `[Sub-agent] ${request.label ?? request.task.slice(0, 40)}`,
      messages: [],
      chatSuggestions: [],
      isPinned: false,
      createAt: now,
      updateAt: now,
      workspaceId,
      workspaceCwd,
      agentMode: "build",
    };

    // Prepare task prompt with wrap-up instruction
    const taskWithWrapup = `${request.task.trim()}

When you have finished, end with one short paragraph in plain text that summarises what you did and what you found. Do NOT stop on a tool call — finish with assistant text. The dispatcher harvests only your final text reply, so this paragraph is the entire response the parent sees.`;

    const userMsg = createMessage("USER", [{ type: "text", text: taskWithWrapup }]);
    const userNode: MessageNode = { id: newId(), messages: [userMsg], selectIndex: 0 };
    subConversation.messages.push(userNode);

    registerConversation(subConversation);
    persistConversation(subConversation);
    broadcastList();

    let resolvedModelSlug: string | null = null;
    let providerName: string | null = null;
    let providerType: string | null = null;
    let endpoint: string | null = null;
    if (resolvedChatModelId) {
      for (const p of providers) {
        const m = p.models.find((model) => model.id === resolvedChatModelId);
        if (m) {
          resolvedModelSlug = m.modelId;
          providerName = p.name;
          providerType = (p as any).type ?? null;
          endpoint = (p as any).baseUrl ?? null;
          break;
        }
      }
    }

    this.registry.update(runId, (r) => ({
      ...r,
      subConversationId: subConvId,
      modelId: finalSubModelId,
      resolvedModelId: finalSubModelId,
      resolvedModelSlug,
      providerName,
      providerType,
      endpoint,
    }));

    // Register tool policy for this sub-agent conversation
    SubAgentToolPolicies.register(subConvId, toolPolicy);

    // Timeout timer
    let timer: NodeJS.Timeout | null = null;
    const timeoutMs = request.timeoutSeconds * 1000;

    try {
      const timeoutPromise = new Promise<"timed_out">((resolve) => {
        timer = setTimeout(() => {
          resolve("timed_out");
        }, timeoutMs);
      });

      // Generation execution
      const generationPromise = (async () => {
        checkoutConversation(subConvId);
        try {
          await generateAnswer(subConversation);
          return "completed" as const;
        } finally {
          releaseConversation(subConvId);
        }
      })();

      const outcome = await Promise.race([generationPromise, timeoutPromise]);

      if (timer) clearTimeout(timer);

      if (outcome === "timed_out") {
        abortGeneration(subConvId, "interrupted");
        this.markTerminal(runId, "timed_out", `Exceeded ${request.timeoutSeconds}-second cap`);
        const convToSave = getConversation(subConvId) ?? subConversation;
        persistConversation(convToSave);
        broadcastList();
        this.notifyParentIfBackground(parentChatId, this.registry.get(runId));
        return;
      }

      // Generation completed. Harvest final text from sub-conversation.
      const updatedConv = getConversation(subConvId) ?? subConversation;
      const finalText = this.harvestFinalText(updatedConv);

      this.registry.update(runId, (r) => ({
        ...r,
        status: "succeeded",
        result: finalText,
        finishedAtMs: Date.now(),
      }));

      persistConversation(updatedConv);
      broadcastList();
      this.notifyParentIfBackground(parentChatId, this.registry.get(runId));
    } catch (err: unknown) {
      if (timer) clearTimeout(timer);
      const isAbort =
        controller.signal.aborted ||
        (err instanceof DOMException && err.name === "AbortError");
      const status: SubAgentStatus = isAbort ? "cancelled" : "failed";
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.markTerminal(runId, status, errorMsg);
      const convToSave = getConversation(subConvId) ?? subConversation;
      persistConversation(convToSave);
      broadcastList();
      this.notifyParentIfBackground(parentChatId, this.registry.get(runId));
    } finally {
      SubAgentToolPolicies.unregister(subConvId);
      this.registry.clearJob(runId);
    }
  }

  async reinject(
    runOrConvId: string,
    continuationPrompt: string,
    options?: {
      timeoutSeconds?: number;
      runInBackground?: boolean;
    },
  ): Promise<DispatchResult> {
    const trimmedPrompt = continuationPrompt.trim();
    if (!trimmedPrompt) {
      return { ok: false, error: "invalid_request", detail: "continuation prompt cannot be blank" };
    }

    let run = this.registry.get(runOrConvId);
    if (!run) {
      const allRuns = this.registry.list();
      run = allRuns.find((r) => r.subConversationId === runOrConvId) ?? getSubAgentRun(runOrConvId) ?? null;
    }
    if (!run) {
      return { ok: false, error: "not_found", detail: `Sub-agent run '${runOrConvId}' not found` };
    }

    if (run.status === "running") {
      return {
        ok: false,
        error: "already_running",
        detail: `Sub-agent run '${run.id}' is currently running`,
      };
    }

    if (!run.subConversationId) {
      return {
        ok: false,
        error: "no_conversation",
        detail: `Sub-agent run '${run.id}' has no associated sub-conversation`,
      };
    }

    const subConversation = getConversation(run.subConversationId);
    if (!subConversation) {
      return {
        ok: false,
        error: "conversation_not_found",
        detail: `Conversation '${run.subConversationId}' not found`,
      };
    }
    if (run.agentName) {
      const profiles = listSubAgentProfiles();
      const profileRes = SubAgentProfileResolver.resolve(run.agentName, profiles);
      if (profileRes.type === "resolved") {
        const providers = state?.settings?.providers ?? [];
        const modelRes = resolveSubAgentModel({ type: "inherit" }, profileRes.profile, providers);
        if (modelRes.type === "resolved") {
          subConversation.chatModelId = modelRes.modelId;
        } else if (modelRes.type === "failed") {
          return { ok: false, error: "profile_model_unresolvable", detail: modelRes.message };
        }
      }
    }
    if (!subConversation.chatModelId) {
      subConversation.chatModelId = run.resolvedModelId ?? run.modelId ?? null;
    }

    const taskWithWrapup = `${trimmedPrompt}

When you have finished, end with one short paragraph in plain text that summarises what you did and what you found. Do NOT stop on a tool call — finish with assistant text. The dispatcher harvests only your final text reply, so this paragraph is the entire response the parent sees.`;

    const userMsg = createMessage("USER", [{ type: "text", text: taskWithWrapup }]);
    const userNode: MessageNode = { id: newId(), messages: [userMsg], selectIndex: 0 };
    subConversation.messages.push(userNode);
    subConversation.updateAt = Date.now();

    persistConversation(subConversation);
    broadcastList();

    const timeoutSeconds = options?.timeoutSeconds ?? run.timeoutSeconds ?? SubAgentDefaults.DEFAULT_TIMEOUT_SECONDS;
    const runInBackground = options?.runInBackground ?? false;

    const controller = new AbortController();
    this.registry.update(run.id, (r) => ({
      ...r,
      status: "running",
      error: null,
      timeoutSeconds,
      runInBackground,
      startedAtMs: Date.now(),
    }));
    this.registry.setJob(run.id, controller);

    const policyBuilt = buildSubAgentToolPolicy(run.tools ?? [], run.capabilities ?? []);
    const toolPolicy = policyBuilt.ok ? policyBuilt.policy : new SubAgentToolPolicy([]);

    const executionPromise = this.executeReinjection(
      run.id,
      run.parentAssistantId,
      run.parentChatId,
      run.subConversationId,
      subConversation,
      toolPolicy,
      timeoutSeconds,
      controller,
    );

    if (runInBackground) {
      void executionPromise.catch((err) => {
        console.error(`[subagent] background reinject execution failed for ${run.id}:`, err);
      });
      return { ok: true, run: this.registry.get(run.id) ?? run };
    } else {
      await executionPromise;
      return { ok: true, run: this.registry.get(run.id) ?? run };
    }
  }

  private async executeReinjection(
    runId: string,
    parentAssistantId: string,
    parentChatId: string | null,
    subConvId: string,
    subConversation: Conversation,
    toolPolicy: SubAgentToolPolicy,
    timeoutSeconds: number,
    controller: AbortController,
  ): Promise<void> {
    SubAgentToolPolicies.register(subConvId, toolPolicy);
    let timer: NodeJS.Timeout | null = null;
    const timeoutMs = timeoutSeconds * 1000;

    try {
      const timeoutPromise = new Promise<"timed_out">((resolve) => {
        timer = setTimeout(() => {
          resolve("timed_out");
        }, timeoutMs);
      });

      const generationPromise = (async () => {
        checkoutConversation(subConvId);
        try {
          await generateAnswer(subConversation);
          return "completed" as const;
        } finally {
          releaseConversation(subConvId);
        }
      })();

      const outcome = await Promise.race([generationPromise, timeoutPromise]);
      if (timer) clearTimeout(timer);

      if (outcome === "timed_out") {
        abortGeneration(subConvId, "interrupted");
        this.markTerminal(runId, "timed_out", `Exceeded ${timeoutSeconds}-second cap on continuation`);
        const convToSave = getConversation(subConvId) ?? subConversation;
        persistConversation(convToSave);
        broadcastList();
        this.notifyParentIfBackground(parentChatId, this.registry.get(runId));
        return;
      }

      const updatedConv = getConversation(subConvId) ?? subConversation;
      const finalText = this.harvestFinalText(updatedConv);

      this.registry.update(runId, (r) => ({
        ...r,
        status: "succeeded",
        result: finalText,
        error: null,
        finishedAtMs: Date.now(),
      }));

      persistConversation(updatedConv);
      broadcastList();
      this.notifyParentIfBackground(parentChatId, this.registry.get(runId));
    } catch (err: unknown) {
      if (timer) clearTimeout(timer);
      const isAbort =
        controller.signal.aborted ||
        (err instanceof DOMException && err.name === "AbortError");
      const status: SubAgentStatus = isAbort ? "cancelled" : "failed";
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.markTerminal(runId, status, errorMsg);
      const convToSave = getConversation(subConvId) ?? subConversation;
      persistConversation(convToSave);
      broadcastList();
      this.notifyParentIfBackground(parentChatId, this.registry.get(runId));
    } finally {
      SubAgentToolPolicies.unregister(subConvId);
      this.registry.clearJob(runId);
    }
  }

  private markTerminal(runId: string, status: SubAgentStatus, error?: string | null): void {
    this.registry.update(runId, (r) => ({
      ...r,
      status,
      error: error ?? null,
      finishedAtMs: Date.now(),
    }));
    broadcastList();
  }

  private harvestFinalText(conversation: Conversation): string {
    const nodes = conversation.messages;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      const activeMsg = node.messages[node.selectIndex];
      if (activeMsg && activeMsg.role === "ASSISTANT") {
        const text = textFromParts(activeMsg.parts).trim();
        if (text) return text;
      }
    }
    return "(No text output emitted)";
  }

  private notifyParentIfBackground(parentChatId: string | null, run: SubAgentRun | null): void {
    if (!parentChatId || !run || !run.runInBackground) return;
    try {
      const parentConv = getConversation(parentChatId);
      if (!parentConv) return;

      const lines: string[] = [
        `[Sub-agent ${run.label} — ${run.status.toUpperCase()}]`,
      ];
      if (run.error) {
        lines.push(`Error: ${run.error}`);
      }
      if (!run.noResult && run.result) {
        lines.push("", run.result);
      }
      const notifyText = lines.join("\n").trim();

      const notifyMsg = createMessage("USER", [{ type: "text", text: notifyText }]);
      const notifyNode: MessageNode = { id: newId(), messages: [notifyMsg], selectIndex: 0 };

      checkoutConversation(parentChatId);
      try {
        parentConv.messages.push(notifyNode);
        parentConv.updateAt = Date.now();
        persistConversation(parentConv);
        broadcastNodeUpdate(parentConv, notifyNode);
        broadcastConversation(parentConv);

        // If parent conversation is currently idle, trigger generation so parent LLM synthesizes
        if (!generating.has(parentChatId)) {
          void generateAnswer(parentConv);
        }
      } finally {
        releaseConversation(parentChatId);
      }
    } catch (err) {
      console.warn("[subagent] failed to notify parent conversation:", err);
    }
  }
}

export const subAgentEngine = new SubAgentEngine();
