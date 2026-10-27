import { openAiSubAgentTools } from "../tools/subagent-tools";
import { SubAgentEngine } from "./engine";
// subagents/subagents.test.ts — Unit tests for Sub-Agents Harness
import { describe, expect, it } from "bun:test";
import {
  SubAgentDefaults,
  SubAgentRequestValidator,
  type SubAgentProfile,
  type SubAgentRun,
} from "./types";
import {
  buildSubAgentToolPolicy,
  SubAgentToolPolicies,
  SubAgentToolPolicy,
} from "./policy";
import {
  resolveSubAgentModel,
  SubAgentModelResolver,
  SubAgentProfileResolver,
} from "./engine";
import { SubAgentRegistry } from "./registry";
import type { Provider } from "../foundation/types";

describe("SubAgentRequestValidator", () => {
  it("accepts a valid request and applies defaults", () => {
    const res = SubAgentRequestValidator.validate({
      task: "Analyze repository layout",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.request.task).toBe("Analyze repository layout");
    expect(res.request.label).toBe("Analyze repository layout");
    expect(res.request.timeoutSeconds).toBe(SubAgentDefaults.DEFAULT_TIMEOUT_SECONDS);
    expect(res.request.maxTrips).toBe(SubAgentDefaults.DEFAULT_MAX_TRIPS);
    expect(res.request.runInBackground).toBe(false);
  });

  it("rejects blank task", () => {
    const res = SubAgentRequestValidator.validate({ task: "   " });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("invalid_task");
  });

  it("rejects timeout out of range", () => {
    const low = SubAgentRequestValidator.validate({ task: "do work", timeoutSeconds: 0 });
    expect(low.ok).toBe(false);

    const high = SubAgentRequestValidator.validate({ task: "do work", timeoutSeconds: 2000 });
    expect(high.ok).toBe(false);
  });

  it("rejects max_trips out of range", () => {
    const low = SubAgentRequestValidator.validate({ task: "do work", maxTrips: 0 });
    expect(low.ok).toBe(false);

    const high = SubAgentRequestValidator.validate({ task: "do work", maxTrips: 50 });
    expect(high.ok).toBe(false);
  });

  it("rejects overly long label", () => {
    const res = SubAgentRequestValidator.validate({
      task: "do work",
      label: "a".repeat(SubAgentDefaults.MAX_LABEL_LENGTH + 1),
    });
    expect(res.ok).toBe(false);
  });
});

describe("SubAgentModelResolver", () => {
  const dummyProviders: Provider[] = ([
    {
      id: "p1",
      name: "OpenAI",
      type: "openai",
      enabled: true,
      apiKey: "test",
      baseUrl: "https://api.openai.com",
      models: [
        { id: "m-gpt4o", modelId: "gpt-4o", displayName: "GPT-4o", type: "CHAT", inputModalities: [], outputModalities: [], abilities: [], tools: [] },
        { id: "m-o3mini", modelId: "o3-mini", displayName: "o3-mini", type: "CHAT", inputModalities: [], outputModalities: [], abilities: [], tools: [] },
      ],
    },
    {
      id: "p2",
      name: "DisabledProvider",
      type: "openai",
      enabled: false,
      apiKey: "test",
      baseUrl: "https://example.com",
      models: [
        { id: "m-disabled", modelId: "disabled-model", displayName: "Disabled", type: "CHAT", inputModalities: [], outputModalities: [], abilities: [], tools: [] },
      ],
    },
  ] as unknown as Provider[]);

  it("returns inherit when modelId is blank or null", () => {
    expect(SubAgentModelResolver.resolve(null, dummyProviders)).toEqual({ type: "inherit" });
    expect(SubAgentModelResolver.resolve("", dummyProviders)).toEqual({ type: "inherit" });
  });

  it("resolves model by exact ID", () => {
    const res = SubAgentModelResolver.resolve("m-gpt4o", dummyProviders);
    expect(res).toEqual({ type: "resolved", modelId: "m-gpt4o" });
  });

  it("resolves model by case-insensitive modelId", () => {
    const res = SubAgentModelResolver.resolve("GPT-4O", dummyProviders);
    expect(res).toEqual({ type: "resolved", modelId: "m-gpt4o" });
  });

  it("ignores disabled providers", () => {
    const res = SubAgentModelResolver.resolve("disabled-model", dummyProviders);
    expect(res.type).toBe("failed");
  });

  it("fails when model is unknown and provides candidate list", () => {
    const res = SubAgentModelResolver.resolve("non-existent", dummyProviders);
    expect(res.type).toBe("failed");
    if (res.type === "failed") {
      expect(res.message).toContain("GPT-4o (OpenAI)");
    }
  });
});

describe("SubAgentProfileResolver", () => {
  const dummyProfiles: SubAgentProfile[] = [
    {
      id: "prof-1",
      name: "Researcher",
      description: "Research assistant",
      systemPrompt: "You are a researcher",
      modelId: "m-gpt4o",
      enabled: true,
      tools: ["search_web"],
      capabilities: ["memory"],
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: "prof-2",
      name: "Coder",
      description: "Coding assistant",
      systemPrompt: "You write code",
      modelId: null,
      enabled: false,
      tools: [],
      capabilities: [],
      createdAt: 1000,
      updatedAt: 1000,
    },
  ];

  it("returns not_requested when agentName is omitted", () => {
    expect(SubAgentProfileResolver.resolve(undefined, dummyProfiles)).toEqual({
      type: "not_requested",
    });
  });

  it("resolves enabled profile case-insensitively", () => {
    const res = SubAgentProfileResolver.resolve("RESEARCHER", dummyProfiles);
    expect(res.type).toBe("resolved");
    if (res.type === "resolved") {
      expect(res.profile.id).toBe("prof-1");
    }
  });

  it("fails to resolve disabled profile and lists enabled ones", () => {
    const res = SubAgentProfileResolver.resolve("Coder", dummyProfiles);
    expect(res.type).toBe("failed");
    if (res.type === "failed") {
      expect(res.message).toContain("Researcher");
    }
  });

  it("prefers explicit model over profile model", () => {
    const profile = dummyProfiles[0];
    const inheritRes = resolveSubAgentModel({ type: "inherit" }, profile);
    expect(inheritRes).toEqual({ type: "resolved", modelId: "m-gpt4o" });

    const explicitRes = resolveSubAgentModel(
      { type: "resolved", modelId: "m-explicit" },
      profile,
    );
    expect(explicitRes).toEqual({ type: "resolved", modelId: "m-explicit" });
  });

  it("resolves profile model by modelSlug case-insensitively", () => {
    const dummyProviders: any = [
      {
        id: "p-google",
        name: "Google AI",
        enabled: true,
        models: [{ id: "uuid-gemini", modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" }],
      },
    ];
    const profile = { ...dummyProfiles[0], modelId: null, modelSlug: "Gemini-2.5-Flash" };
    const res = resolveSubAgentModel({ type: "inherit" }, profile, dummyProviders);
    expect(res).toEqual({ type: "resolved", modelId: "uuid-gemini" });
  });

  it("fails loudly when profile model provider is disabled (refuses silent fallback)", () => {
    const dummyProviders: any = [
      {
        id: "p-google",
        name: "Google AI",
        enabled: false,
        models: [{ id: "uuid-gemini", modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash" }],
      },
    ];
    const profile = { ...dummyProfiles[0], modelId: "uuid-gemini", modelSlug: "gemini-2.5-flash" };
    const res = resolveSubAgentModel({ type: "inherit" }, profile, dummyProviders);
    expect(res.type).toBe("failed");
    if (res.type === "failed") {
      expect(res.message).toContain("Refusing silent fallback");
      expect(res.message).toContain("disabled");
    }
  });
});

describe("SubAgentToolPolicy", () => {
  it("always permits workspace tools", () => {
    const policy = new SubAgentToolPolicy([]);
    expect(policy.allows("read")).toBe(true);
    expect(policy.allows("write")).toBe(true);
    expect(policy.allows("edit")).toBe(true);
    expect(policy.allows("bash")).toBe(true);
    expect(policy.allows("ls")).toBe(true);
    expect(policy.allows("grep")).toBe(true);
    expect(policy.allows("find")).toBe(true);
    expect(policy.allows("save_memory")).toBe(false);
  });

  it("permits role tools and capabilities", () => {
    const built = buildSubAgentToolPolicy(["custom_tool"], ["memory", "ssh"]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.policy.allows("custom_tool")).toBe(true);
    expect(built.policy.allows("save_memory")).toBe(true);
    expect(built.policy.allows("ssh_exec")).toBe(true);
    expect(built.policy.allows("browser_open")).toBe(false);
  });

  it("fails on unknown capability", () => {
    const built = buildSubAgentToolPolicy([], ["non_existent_cap"]);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.unknownCapabilities).toContain("non_existent_cap");
    }
  });

  it("registers and verifies conversation policy", () => {
    const convId = "conv-subagent-1";
    const built = buildSubAgentToolPolicy([], ["web"]);
    if (!built.ok) return;

    SubAgentToolPolicies.register(convId, built.policy);
    expect(SubAgentToolPolicies.isSubAgent(convId)).toBe(true);
    expect(SubAgentToolPolicies.permits(convId, "search_web")).toBe(true);
    expect(SubAgentToolPolicies.permits(convId, "subagent_dispatch")).toBe(false);

    SubAgentToolPolicies.unregister(convId);
    expect(SubAgentToolPolicies.isSubAgent(convId)).toBe(false);
  });
});

describe("SubAgentRegistry", () => {
  it("tracks pending and active counts", () => {
    const registry = new SubAgentRegistry();
    const run1: SubAgentRun = {
      id: "run-test-1",
      parentChatId: "parent-1",
      parentAssistantId: "asst-1",
      subConversationId: null,
      label: "Test 1",
      task: "Task 1",
      modelId: null,
      agentName: null,
      tools: null,
      capabilities: null,
      runInBackground: false,
      noResult: false,
      timeoutSeconds: 300,
      maxTrips: 12,
      status: "running",
      result: null,
      error: null,
      startedAtMs: Date.now(),
      finishedAtMs: null,
      tokensIn: 0,
      tokensOut: 0,
      tripCount: 0,
    };

    registry.addPending(run1);
    expect(registry.get("run-test-1")).toBeDefined();
    expect(registry.activeCountForAssistant("asst-1")).toBe(1);
    expect(registry.globalActiveCount()).toBe(1);

    registry.update("run-test-1", (r) => ({ ...r, status: "succeeded" }));
    expect(registry.activeCountForAssistant("asst-1")).toBe(0);
    expect(registry.globalActiveCount()).toBe(0);
  });
});

describe("SubAgent Reinjection & Extended Tools", () => {
  it("openAiSubAgentTools includes subagent_reinject", () => {
    const tools = openAiSubAgentTools([]);
    const names = tools.map((t) => t.function.name);
    expect(names).toContain("subagent_dispatch");
    expect(names).toContain("subagent_list");
    expect(names).toContain("subagent_get");
    expect(names).toContain("subagent_cancel");
    expect(names).toContain("subagent_reinject");
  });

  it("subagent capability definition includes subagent_reinject", () => {
    const policyResult = buildSubAgentToolPolicy([], ["subagent"]);
    expect(policyResult.ok).toBe(true);
    if (!policyResult.ok) return;
    expect(policyResult.policy.allows("subagent_reinject")).toBe(true);
  });

  it("SubAgentEngine.reinject validates input and returns error for non-existent run", async () => {
    const registry = new SubAgentRegistry();
    const engine = new SubAgentEngine(registry);

    const blankRes = await engine.reinject("fake-id", "   ");
    expect(blankRes.ok).toBe(false);
    if (!blankRes.ok) {
      expect(blankRes.error).toBe("invalid_request");
    }

    const notFoundRes = await engine.reinject("non-existent-run-id", "Please continue");
    expect(notFoundRes.ok).toBe(false);
    if (!notFoundRes.ok) {
      expect(notFoundRes.error).toBe("not_found");
    }
  });
});
