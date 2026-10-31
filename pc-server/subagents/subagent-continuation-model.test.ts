import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { ensureConversationTables, ensureConversationChatModelColumn, upsertConversationRowInto } from "../conversations/index";
import { getConversationMeta } from "../conversations/read-queries";
import { resolveSubAgentModel } from "./engine";
import type { SubAgentProfile } from "./types";
import type { Provider, Conversation } from "../foundation/types";

describe("SubAgent Continuation & Model Persistence", () => {
  it("persists and reads chat_model_id in pc_conversation", () => {
    const db = new Database(":memory:");
    ensureConversationTables(db);
    ensureConversationChatModelColumn(db);

    const conv: Conversation = {
      id: "sub-conv-123",
      assistantId: "parent-asst-456",
      chatModelId: "builder-model-789",
      title: "[Sub-agent] builder task",
      systemPrompt: "You are a builder",
      messages: [],
      chatSuggestions: [],
      isPinned: false,
      createAt: Date.now(),
      updateAt: Date.now(),
      agentMode: "build",
    };

    upsertConversationRowInto(db, conv);

    const meta = getConversationMeta(db, "sub-conv-123");
    expect(meta).not.toBeNull();
    expect(meta!.chatModelId).toBe("builder-model-789");
    expect(meta!.assistantId).toBe("parent-asst-456");
  });

  it("resolveSubAgentModel resolves profile model via Tier 1 exact UUID match", () => {
    const profile: SubAgentProfile = {
      id: "builder",
      name: "builder",
      description: "builder",
      systemPrompt: "builder",
      modelId: "uuid-123",
      modelSlug: "minimax-m3",
      providerId: "kios-free",
      enabled: true,
      tools: [],
      capabilities: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const providers: Provider[] = [
      {
        id: "kios-free",
        name: "Kiosapi-Free",
        enabled: true,
        models: [
          { id: "uuid-123", modelId: "minimax-m3", displayName: "MiniMax M3", type: "CHAT" },
        ],
      } as Provider,
    ];

    const res = resolveSubAgentModel({ type: "inherit" }, profile, providers);
    expect(res.type).toBe("resolved");
    if (res.type === "resolved") {
      expect(res.modelId).toBe("uuid-123");
    }
  });

  it("resolveSubAgentModel resolves via Tier 2 provider affinity when UUID is stale after catalog refresh", () => {
    const profile: SubAgentProfile = {
      id: "builder",
      name: "builder",
      description: "builder",
      systemPrompt: "builder",
      modelId: "old-stale-uuid",
      modelSlug: "glm-5.3-flash-free",
      providerId: "provider-kios",
      enabled: true,
      tools: [],
      capabilities: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const providers: Provider[] = [
      {
        id: "provider-zen",
        name: "Zen",
        enabled: true,
        models: [
          { id: "zen-model-id", modelId: "glm-5.3-flash-free", displayName: "GLM Zen", type: "CHAT" },
        ],
      } as Provider,
      {
        id: "provider-kios",
        name: "Kios",
        enabled: true,
        models: [
          { id: "refreshed-kios-id", modelId: "glm-5.3-flash-free", displayName: "GLM Kios", type: "CHAT" },
        ],
      } as Provider,
    ];

    const res = resolveSubAgentModel({ type: "inherit" }, profile, providers);
    expect(res.type).toBe("resolved");
    if (res.type === "resolved") {
      expect(res.modelId).toBe("refreshed-kios-id");
    }
  });

  it("resolveSubAgentModel fails loudly when modelSlug is ambiguous across multiple providers and no providerId or modelId matches", () => {
    const profile: SubAgentProfile = {
      id: "builder",
      name: "builder",
      description: "builder",
      systemPrompt: "builder",
      modelId: null,
      modelSlug: "shared-model-slug",
      providerId: null,
      enabled: true,
      tools: [],
      capabilities: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const providers: Provider[] = [
      {
        id: "provider-1",
        name: "Provider 1",
        enabled: true,
        models: [
          { id: "p1-id", modelId: "shared-model-slug", displayName: "Shared Model 1", type: "CHAT" },
        ],
      } as Provider,
      {
        id: "provider-2",
        name: "Provider 2",
        enabled: true,
        models: [
          { id: "p2-id", modelId: "shared-model-slug", displayName: "Shared Model 2", type: "CHAT" },
        ],
      } as Provider,
    ];

    const res = resolveSubAgentModel({ type: "inherit" }, profile, providers);
    expect(res.type).toBe("failed");
    if (res.type === "failed") {
      expect(res.message).toContain("is ambiguous across multiple providers (2 matches)");
    }
  });
});
