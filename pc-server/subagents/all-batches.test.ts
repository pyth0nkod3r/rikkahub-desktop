// subagents/all-batches.test.ts — Comprehensive Test Suite for Adopted Agent-2 & Android Batches

import { describe, expect, test } from "bun:test";
import { ContextBroker, projectKeyFromPath, type ContextCategory } from "../inference-engine/context-broker";
import { looksTruncated } from "./truncation";
import { synthesizeDagFromGoal, planGoalToDag } from "./dag-planner";
import { CommandWatchdog } from "../workspace/command-watchdog";
import { classifyToolSafety, synthesizeRecoveryBriefing } from "./recovery";
import { isDecisionModel, synthesizeDecisionPredicate, parseDecisionEvaluationResult } from "../inference-engine/decisions-api";
import { SecretStore } from "../security/secret-store";
import { ComposerTrie } from "../pil/composer-trie";
import type { SubAgentRun } from "./types";

describe("Batch 1: ContextBroker & Token Budgeting", () => {
  test("isolated collectors never crash when one collector throws", async () => {
    const broker = new ContextBroker();
    broker.registerCollector("rules", () => "Always follow safety rules.");
    broker.registerCollector("git_state", () => {
      throw new Error("Git binary not found on PATH");
    });
    broker.registerCollector("memory", () => "User prefers TypeScript.");

    const blocks = await broker.collect({ workspacePath: "C:/repos/app" });
    expect(blocks.length).toBe(2);
    expect(blocks.map((b) => b.category)).toContain("rules");
    expect(blocks.map((b) => b.category)).toContain("memory");
    expect(blocks.map((b) => b.category)).not.toContain("git_state");
  });

  test("budgetTrim trims low-priority blocks first while protecting rules and memory", () => {
    const broker = new ContextBroker();
    const blocks = [
      { category: "rules" as ContextCategory, content: "Rule content", priority: 100, tokens: 50 },
      { category: "memory" as ContextCategory, content: "Memory content", priority: 90, tokens: 40 },
      { category: "skills" as ContextCategory, content: "Skills content", priority: 50, tokens: 60 },
      { category: "mcp_results" as ContextCategory, content: "MCP content", priority: 10, tokens: 80 },
    ];

    // Total tokens: 230. Budget: 160. Should trim mcp_results (80 tokens)
    const trimmed = broker.budgetTrim(blocks, 160);
    const categories = trimmed.map((b) => b.category);
    expect(categories).toContain("rules");
    expect(categories).toContain("memory");
    expect(categories).toContain("skills");
    expect(categories).not.toContain("mcp_results");
  });

  test("projectKeyFromPath generates deterministic project-key hash", () => {
    const key1 = projectKeyFromPath("C:\\repos\\MyProject");
    const key2 = projectKeyFromPath("c:/repos/myproject");
    expect(key1).toBe(key2);
    expect(key1.length).toBe(16);
    expect(projectKeyFromPath(null)).toBe("global");
  });
});

describe("Batch 2: Truncation Safety & Goal-to-DAG Planner", () => {
  test("looksTruncated detects unclosed code fences", () => {
    const normal = "Here is some code:\n```ts\nconst x = 1;\n```\nAll done.";
    expect(looksTruncated(normal).isTruncated).toBe(false);

    const cutOff = "Here is some code:\n```ts\nconst x = 1;\n// halfway through";
    const result = looksTruncated(cutOff);
    expect(result.isTruncated).toBe(true);
    expect(result.reason).toContain("Unclosed markdown code fence");
  });

  test("looksTruncated detects trailing dangling syntax and keywords", () => {
    expect(looksTruncated("function calculate(").isTruncated).toBe(true);
    expect(looksTruncated("const result = a +").isTruncated).toBe(true);
    expect(looksTruncated("I will now implement the").isTruncated).toBe(true);
    expect(looksTruncated("Task completed successfully.").isTruncated).toBe(false);
  });

  test("synthesizeDagFromGoal decomposes multi-step instructions into DAG with dependencies", () => {
    const multiStep = "1. Research the database schema\n2. Builder implement migrations\n3. Critic verify the changes";
    const tasks = synthesizeDagFromGoal(multiStep);
    expect(tasks.length).toBe(3);
    expect(tasks[0].agent).toBe("researcher");
    expect(tasks[1].agent).toBe("builder");
    expect(tasks[1].depends_on).toEqual(["step-1"]);
    expect(tasks[2].agent).toBe("critic");
    expect(tasks[2].depends_on).toEqual(["step-2"]);
  });

  test("planGoalToDag creates a validated DAG in plan mode", async () => {
    const res = await planGoalToDag("Refactor authentication module", { mode: "plan" });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("planned");
    expect(res.tasks.length).toBeGreaterThanOrEqual(3);
    expect(res.tasks.map((t) => t.id)).toContain("plan-spec");
    expect(res.tasks.map((t) => t.id)).toContain("build-impl");
    expect(res.tasks.map((t) => t.id)).toContain("verify-critic");
  });
});

describe("Batch 3: Command Watchdog & Crash Recovery", () => {
  test("CommandWatchdog records heartbeats and pre-records verdict before kill", () => {
    const watchdog = new CommandWatchdog(100);
    const record = watchdog.registerCommand("cmd-1", "npm run build");
    expect(record.verdict).toBe("RUNNING");

    // Verdict-before-kill
    watchdog.recordVerdictBeforeKill("cmd-1", "TIMED_OUT");
    expect(record.verdict).toBe("TIMED_OUT");

    // Process completion does not overwrite TIMED_OUT with FAILED
    watchdog.completeCommand("cmd-1", 1);
    expect(record.verdict).toBe("TIMED_OUT");
    expect(record.exitCode).toBe(1);
  });

  test("classifyToolSafety distinguishes read-only from mutating tools", () => {
    expect(classifyToolSafety("read")).toBe("safe_to_repeat");
    expect(classifyToolSafety("grep")).toBe("safe_to_repeat");
    expect(classifyToolSafety("find")).toBe("safe_to_repeat");
    expect(classifyToolSafety("write")).toBe("safe_to_continue");
    expect(classifyToolSafety("edit")).toBe("safe_to_continue");
    expect(classifyToolSafety("bash")).toBe("safe_to_continue");
  });

  test("synthesizeRecoveryBriefing summarizes interrupted subagent state", () => {
    const run: SubAgentRun = {
      id: "run-99",
      conversationId: "conv-99",
      parentChatId: "chat-1",
      agentName: "builder",
      label: "Unit Test Task",
      task: "Write unit tests",
      status: "failed",
      error: "Server restarted",
      result: null,
      worktreeDiff: null,
      tokensIn: 100,
      tokensOut: 200,
      tripCount: 1,
      createdAtMs: Date.now() - 5000,
      finishedAtMs: Date.now(),
    };

    const briefing = synthesizeRecoveryBriefing(run);
    expect(briefing).toContain("Crash Recovery Briefing");
    expect(briefing).toContain("run-99");
    expect(briefing).toContain("Recovery Directive");
  });
});

describe("Batch 4 & 5: Decisions API, SecretStore & Personal Intelligence Trie", () => {
  test("isDecisionModel identifies evaluation models", () => {
    expect(isDecisionModel({ id: "gpt-4o-decision" })).toBe(true);
    expect(isDecisionModel({ modelId: "deepseek-evaluation" })).toBe(true);
    expect(isDecisionModel({ type: "evaluation" } as any)).toBe(true);
    expect(isDecisionModel({ id: "claude-3-5-sonnet" })).toBe(false);
  });

  test("synthesizeDecisionPredicate produces standard evaluation instructions", () => {
    const pred = synthesizeDecisionPredicate("Check for bugs");
    expect(pred.type).toBe("predicate");
    expect(pred.name).toBe("assessment");
    expect(pred.instructions).toBe("Check for bugs");
  });

  test("parseDecisionEvaluationResult parses pass/fail outcomes accurately", () => {
    expect(parseDecisionEvaluationResult({ verdict: "confirmed", score: 0.95 }).verdict).toBe("pass");
    expect(parseDecisionEvaluationResult({ verdict: "contradicted", score: 0.2 }).verdict).toBe("fail");
    expect(parseDecisionEvaluationResult({ foo: "bar" }).verdict).toBe("inconclusive");
  });

  test("SecretStore encrypts and resolves secrets with a2s: reference format", () => {
    const store = new SecretStore();
    const rawSecret = "sk-test-secret-key-123456789";

    const ref = store.storeSecret(rawSecret);
    expect(store.isSecretReference(ref)).toBe(true);
    expect(ref.startsWith("a2s:")).toBe(true);

    const decrypted = store.resolveSecret(ref);
    expect(decrypted).toBe(rawSecret);

    // Plaintext pass-through
    expect(store.resolveSecret("plain-value")).toBe("plain-value");
  });

  test("ComposerTrie indexes terms and returns top frequency prefix suggestions", () => {
    const trie = new ComposerTrie();
    trie.insert("subagent_dispatch", 1);
    trie.insert("subagent_dag_run", 5);
    trie.insert("subagent_dag_plan", 3);
    trie.insert("subagent_reinject", 2);

    const suggestions = trie.searchPrefix("subagent_dag", 5);
    expect(suggestions).toEqual(["subagent_dag_run", "subagent_dag_plan"]);

    // Boost subagent_dag_plan
    trie.boost("subagent_dag_plan", 5);
    const updated = trie.searchPrefix("subagent_dag", 5);
    expect(updated[0]).toBe("subagent_dag_plan");
  });
});
