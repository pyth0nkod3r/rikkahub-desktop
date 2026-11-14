// pc-server/subagents/features-adoption.test.ts
// Unit tests for adopted features from Pyth0nkod3r rikkahub-agent & Agent-2

import { describe, expect, test } from "bun:test";
import { SubAgentFallbackPolicies } from "./policy";
import { resolveSubAgentModel } from "./engine";
import { extractAgentName } from "../tools/subagent-tools";
import { verifySubAgentRun } from "./verify";
import { validateDagTasks } from "./dag";
import { sanitizeToolParametersSchema } from "../tools/schema-inline";
import { extractUpstreamContextLimit } from "../inference-engine/provider-errors";
import { mergeAgentsMarkdown, scanWorkspaceProject, formatGeneratedAgentsBlock } from "../workspace/project-scan";
import { selectSkillsForTurn } from "../tools/skill-selector";
import type { Model, Provider, SubAgentProfile, Conversation } from "../foundation/types";

describe("Adopted Sub-Agent Features (Pyth0nkod3r Fork)", () => {
  test("SubAgentFallbackPolicies registers and clamps maxFailsBeforeSwitch", () => {
    SubAgentFallbackPolicies.register("conv-1", {
      secondaryModelId: "sec-model-id",
      secondaryModelSlug: "sec-slug",
      secondaryProviderId: "prov-1",
      maxFailsBeforeSwitch: 15, // should clamp to 10
    });

    const policy = SubAgentFallbackPolicies.get("conv-1");
    expect(policy).toBeDefined();
    expect(policy?.secondaryModelId).toBe("sec-model-id");
    expect(policy?.maxFailsBeforeSwitch).toBe(10);

    SubAgentFallbackPolicies.clear("conv-1");
    expect(SubAgentFallbackPolicies.get("conv-1")).toBeUndefined();
  });

  test("resolveSubAgentModel falls back to secondary model when primary is missing", () => {
    const mockProviders: Provider[] = [
      {
        id: "prov-1",
        name: "Provider 1",
        enabled: true,
        models: [
          { id: "uuid-primary", modelId: "gpt-primary", displayName: "Primary Model", type: "CHAT" } as Model,
          { id: "uuid-secondary", modelId: "gpt-secondary", displayName: "Secondary Model", type: "CHAT" } as Model,
        ],
      } as Provider,
    ];

    const profile: SubAgentProfile = {
      id: "p1",
      name: "Researcher",
      description: "Researcher",
      systemPrompt: "",
      modelId: "missing-primary-uuid",
      modelSlug: "missing-primary-slug",
      providerId: "prov-1",
      secondaryModelId: "uuid-secondary",
      secondaryModelSlug: "gpt-secondary",
      secondaryProviderId: "prov-1",
      maxFailsBeforeSwitch: 2,
      enabled: true,
      tools: [],
      capabilities: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const res = resolveSubAgentModel({ type: "inherit" }, profile, mockProviders);
    expect(res.type).toBe("resolved");
    if (res.type === "resolved") {
      expect(res.modelId).toBe("uuid-secondary");
      expect(res.fallbackReason).toContain("fell back to secondary model");
    }
  });

  test("extractAgentName matches across 10 aliases and label/task fallbacks", () => {
    expect(extractAgentName({ agent: "builder" })).toBe("builder");
    expect(extractAgentName({ role: "critic" })).toBe("critic");
    expect(extractAgentName({ subagent_type: "planner" })).toBe("planner");
    expect(extractAgentName({ subagentType: "designer" })).toBe("designer");
    expect(extractAgentName({ agent_name: "merger" })).toBe("merger");
    expect(extractAgentName({ agentName: "researcher" })).toBe("researcher");
    expect(extractAgentName({ profile: "expert" })).toBe("expert");
    expect(extractAgentName({ profile_name: "analyst" })).toBe("analyst");
    expect(extractAgentName({ profileName: "auditor" })).toBe("auditor");
    expect(extractAgentName({ type: "coder" })).toBe("coder");

    // Label fallback
    expect(extractAgentName({ label: "Builder: implement feature A" })).toBe("Builder");
    // Task fallback
    expect(extractAgentName({ task: "Act as researcher and inspect api" })).toBe("researcher");
  });
});

describe("Adopted Agent-2 Features", () => {
  test("verifySubAgentRun computes ledger-based verdicts correctly", () => {
    // 1. Confirmed by passing tests
    const passedConv = {
      messages: [
        {
          selectIndex: 0,
          messages: [
            {
              role: "ASSISTANT",
              parts: [
                {
                  type: "tool",
                  toolName: "bash",
                  input: { command: "bun test" },
                  output: [{ type: "text", text: "15 pass, 0 fail" }],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Conversation;

    const v1 = verifySubAgentRun({ status: "succeeded", error: null, result: "Done", worktreeDiff: null }, passedConv);
    expect(v1.verdict).toBe("confirmed");
    expect(v1.checksPassed).toBe(1);

    // 2. Contradicted by failing tests
    const failedConv = {
      messages: [
        {
          selectIndex: 0,
          messages: [
            {
              role: "ASSISTANT",
              parts: [
                {
                  type: "tool",
                  toolName: "bash",
                  input: { command: "npm test" },
                  output: [{ type: "text", text: "Error: 2 tests failed (exit code 1)" }],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Conversation;

    const v2 = verifySubAgentRun({ status: "succeeded", error: null, result: "Done", worktreeDiff: null }, failedConv);
    expect(v2.verdict).toBe("contradicted");
    expect(v2.checksFailed).toBe(1);

    // 3. Unconfirmed when mutations made but no tests run
    const unconfirmedConv = {
      messages: [
        {
          selectIndex: 0,
          messages: [
            {
              role: "ASSISTANT",
              parts: [
                {
                  type: "tool",
                  toolName: "write",
                  input: { path: "src/index.ts", content: "export const a = 1;" },
                  output: [{ type: "text", text: "ok" }],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Conversation;

    const v3 = verifySubAgentRun({ status: "succeeded", error: null, result: "Done", worktreeDiff: null }, unconfirmedConv);
    expect(v3.verdict).toBe("unconfirmed");
    expect(v3.fileMutations).toContain("src/index.ts");
  });

  test("validateDagTasks enforces unique IDs and detects cycles", () => {
    // Valid DAG
    const valid = validateDagTasks([
      { id: "A", task: "Task A" },
      { id: "B", task: "Task B", dependsOn: ["A"] },
      { id: "C", task: "Task C", dependsOn: ["A", "B"] },
    ]);
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.order).toEqual(["A", "B", "C"]);
    }

    // Cycle detection
    const cyclic = validateDagTasks([
      { id: "A", task: "Task A", dependsOn: ["B"] },
      { id: "B", task: "Task B", dependsOn: ["A"] },
    ]);
    expect(cyclic.ok).toBe(false);
  });

  test("sanitizeToolParametersSchema strips empty required arrays recursively", () => {
    const raw = {
      type: "object",
      properties: {
        foo: { type: "string" },
        sub: {
          type: "object",
          properties: { bar: { type: "number" } },
          required: [],
        },
      },
      required: [],
    };

    const sanitized = sanitizeToolParametersSchema(raw as any);
    expect(sanitized.required).toBeUndefined();
    expect((sanitized as any).properties.sub.required).toBeUndefined();
  });

  test("extractUpstreamContextLimit captures upstream token limits from errors", () => {
    const err1 = new Error("This model's maximum context length is 65536 tokens. However, your messages resulted in 72000 tokens.");
    expect(extractUpstreamContextLimit(err1)).toBe(65536);

    const err2 = new Error("prompt is too long: 210145 tokens > 200000 maximum");
    expect(extractUpstreamContextLimit(err2)).toBe(200000);

    const err3 = new Error("exceeds the maximum number of tokens allowed (1048576)");
    expect(extractUpstreamContextLimit(err3)).toBe(1048576);

    const err4 = new Error("General network failure (no limits here)");
    expect(extractUpstreamContextLimit(err4)).toBeNull();
  });

  test("mergeAgentsMarkdown preserves custom user sections around generated markers", () => {
    const initial = `# Custom Header
This is written by the human engineer.

## Architecture Guidelines
- Rule 1
`;
    const generated = formatGeneratedAgentsBlock({
      stacks: ["TypeScript", "Bun"],
      commands: [{ label: "test", command: "bun test" }],
      directories: ["src/", "tests/"],
      manifestFiles: ["package.json"],
    });

    const merged = mergeAgentsMarkdown(initial, generated);
    expect(merged).toContain("<!-- rikkahub:generated:start -->");
    expect(merged).toContain("<!-- rikkahub:generated:end -->");
    expect(merged).toContain("This is written by the human engineer.");
    expect(merged).toContain("**Detected Stack**: TypeScript, Bun");

    // Re-running merge replaces the generated section cleanly
    const updatedGenerated = generated.replace("TypeScript, Bun", "TypeScript, Bun, Rust");
    const remerged = mergeAgentsMarkdown(merged, updatedGenerated);
    expect(remerged).toContain("**Detected Stack**: TypeScript, Bun, Rust");
    expect(remerged).toContain("This is written by the human engineer.");
  });

  test("selectSkillsForTurn ranks skills across 5 tiers correctly", () => {
    const skills = [
      { name: "git-commit", description: "Creates standard git commits", allowedTools: [] },
      { name: "postgres-tool", description: "Database querying and migration tool", allowedTools: [] },
      { name: "general-helper", description: "General multipurpose helper", allowedTools: [] },
    ];

    const selected = selectSkillsForTurn({
      skills,
      userPrompt: "Please use /postgres-tool to check users table",
      enabledNames: ["git-commit"],
      projectDocText: "",
      includeGeneral: true,
    });

    expect(selected.length).toBe(3);
    // Tier 1 (request) should be first
    expect(selected[0].tier).toBe("request");
    expect(selected[0].skill.name).toBe("postgres-tool");
    // Tier 3 (enabled) should be next
    expect(selected[1].tier).toBe("enabled");
    expect(selected[1].skill.name).toBe("git-commit");
  });
});
