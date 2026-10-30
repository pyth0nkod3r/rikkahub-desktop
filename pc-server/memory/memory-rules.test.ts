// memory/memory-rules.test.ts — Unit tests for Global vs Assistant memory precedence and toggles
import { describe, expect, test, beforeEach } from "bun:test";
import { memoryStore, memoriesForAssistant, buildMemoryPrompt } from "./index";
import { setState, state } from "../persistence/json-store";
import { runSaveMemoryTool } from "../tools/execution";
import type { Assistant, State } from "../foundation/types";

function mockAssistant(overrides: Partial<Assistant> = {}): Assistant {
  return {
    id: "asst-test-1",
    chatModelId: null,
    name: "Test Assistant",
    avatar: { type: "dummy" },
    useAssistantAvatar: false,
    tags: [],
    systemPrompt: "You are a test assistant.",
    temperature: null,
    topP: null,
    contextMessageLimit: 0,
    streamOutput: true,
    enableMemory: false,
    useGlobalMemory: false,
    enableRecentChatsReference: false,
    messageTemplate: "{{ message }}",
    presetMessages: [],
    quickMessageIds: [],
    regexes: [],
    reasoningLevel: "AUTO",
    maxTokens: null,
    customHeaders: [],
    customBodies: [],
    mcpServers: [],
    mcpToolOverrides: {},
    localTools: [],
    background: null,
    backgroundOpacity: 1,
    modeInjectionIds: [],
    lorebookIds: [],
    enabledSkills: [],
    enableTimeReminder: false,
    allowConversationSystemPrompt: false,
    allowConversationPromptInjection: false,
    ...overrides,
  };
}

describe("Memory Rules & Precedence", () => {
  beforeEach(() => {
    memoryStore.clearAll();
    setState({
      settings: {
        assistants: [mockAssistant()],
        memorySettings: {
          globalEnabled: false,
          writeStrategy: "ask",
        },
      },
    } as unknown as State);

    // Seed test memories
    memoryStore.addMemory({ scope: "global", content: "Global Directive: Always follow safety guidelines" }, false);
    memoryStore.addMemory({ scope: "assistant", assistantId: "asst-test-1", content: "Assistant Directive: Speak concisely" }, false);
  });

  test("Rule 1: Global OFF, Assistant OFF -> memory is completely disabled", async () => {
    state.settings.memorySettings.globalEnabled = false;
    const asst = mockAssistant({ enableMemory: false });

    const mems = memoriesForAssistant(asst);
    expect(mems).toHaveLength(0);

    const prompt = buildMemoryPrompt(asst);
    expect(prompt).toBe("");

    // Attempting to save throws error
    expect(runSaveMemoryTool(asst, { content: "New test" })).rejects.toThrow("Memory is disabled");
  });

  test("Rule 2: Global OFF, Assistant ON -> strictly restricted to Assistant memory", async () => {
    state.settings.memorySettings.globalEnabled = false;
    const asst = mockAssistant({ enableMemory: true });

    const mems = memoriesForAssistant(asst);
    expect(mems).toHaveLength(1);
    expect(mems[0].content).toContain("Assistant Directive");
    expect(mems.some((m) => m.content.includes("Global Directive"))).toBe(false);

    const prompt = buildMemoryPrompt(asst);
    expect(prompt).toContain("Assistant Directive: Speak concisely");
    expect(prompt).not.toContain("Global Directive");

    // Saving via always_assistant saves to assistant memory
    state.settings.memorySettings.writeStrategy = "always_assistant";
    const res = await runSaveMemoryTool(asst, { content: "Assistant only note" });
    expect(res.status).toBe("saved");
    expect(res.scope).toBe("assistant");

    // Saving via always_global falls back to assistant memory because global is off
    state.settings.memorySettings.writeStrategy = "always_global";
    const res2 = await runSaveMemoryTool(asst, { content: "Fallback to assistant note" });
    expect(res2.status).toBe("saved");
    expect(res2.scope).toBe("assistant");
  });

  test("Rule 3: Global ON, Assistant OFF -> access and save to Global memory", async () => {
    state.settings.memorySettings.globalEnabled = true;
    const asst = mockAssistant({ enableMemory: false });

    const mems = memoriesForAssistant(asst);
    expect(mems).toHaveLength(1);
    expect(mems[0].content).toContain("Global Directive");
    expect(mems.some((m) => m.content.includes("Assistant Directive"))).toBe(false);

    const prompt = buildMemoryPrompt(asst);
    expect(prompt).toContain("Global Directive");
    expect(prompt).not.toContain("Assistant Directive");

    // Saving via always_global saves to global
    state.settings.memorySettings.writeStrategy = "always_global";
    const res = await runSaveMemoryTool(asst, { content: "Global note" });
    expect(res.status).toBe("saved");
    expect(res.scope).toBe("global");

    // Saving via always_assistant also allows saving to global when assistant memory is off
    state.settings.memorySettings.writeStrategy = "always_assistant";
    const res2 = await runSaveMemoryTool(asst, { content: "Global note via assistant fallback" });
    expect(res2.status).toBe("saved");
    expect(res2.scope).toBe("global");
  });

  test("Rule 4: Global ON, Assistant ON -> Global memory prevails against Assistant memory", async () => {
    state.settings.memorySettings.globalEnabled = true;
    const asst = mockAssistant({ enableMemory: true });

    const mems = memoriesForAssistant(asst);
    expect(mems).toHaveLength(2);
    // Global memories prevail: placed first before assistant memories
    expect(mems[0].content).toContain("Global Directive");
    expect(mems[1].content).toContain("Assistant Directive");

    const prompt = buildMemoryPrompt(asst);
    expect(prompt).toContain("Global Directives (Prevailing Priority)");
    expect(prompt).toContain("(Prevailing / Preferred)");
    expect(prompt).toContain("Global Memory PREVAILS against assistant memory");
    expect(prompt).toContain("Assistant Directives");

    // If assistant has useGlobalMemory: true, always_assistant saves to global
    const asstGlobal = mockAssistant({ enableMemory: true, useGlobalMemory: true });
    state.settings.memorySettings.writeStrategy = "always_assistant";
    const res = await runSaveMemoryTool(asstGlobal, { content: "Preferred global note" });
    expect(res.status).toBe("saved");
    expect(res.scope).toBe("global");
  });

  test("Resolving pending to global is rejected when globalEnabled is false", async () => {
    state.settings.memorySettings.globalEnabled = false;
    const pending = await memoryStore.enqueuePending({
      conversationId: "c1",
      assistantId: "asst-test-1",
      assistantName: "Test Assistant",
      content: "Pending test memory",
    });
    expect(typeof pending).toBe("object");
    if (typeof pending === "object" && pending !== null) {
      const res = await memoryStore.resolvePending(pending.pendingId, "global");
      expect(res.resolved).toBe(false);

      // But resolving to assistant succeeds
      const resAsst = await memoryStore.resolvePending(pending.pendingId, "assistant");
      expect(resAsst.resolved).toBe(true);
      expect(resAsst.memory?.content).toBe("Pending test memory");
    }
  });
});
