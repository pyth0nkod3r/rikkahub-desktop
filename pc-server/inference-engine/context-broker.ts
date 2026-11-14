// inference-engine/context-broker.ts — Priority-Ordered Context Broker with Isolated Collectors
// Adopted from Agent-2 architecture (agent2/core/broker/)
// Features:
// 1. 10 isolated collectors with try/catch wrapping
// 2. Decoupled ORDER (layout presentation) vs PRIORITY (trimming rank under token budget)
// 3. Project-key path isolation for multi-workspace context
// 4. Anthropic prompt cache warmth preservation (cache_control: { type: "ephemeral" })

import { createHash } from "node:crypto";
import type { Assistant, Conversation, JsonValue, Model } from "../foundation/types";

export type ContextCategory =
  | "rules"
  | "memory"
  | "project"
  | "git_state"
  | "skills"
  | "task_results"
  | "workflow_state"
  | "mcp_results"
  | "files"
  | "conversation";

export interface ContextBlock {
  category: ContextCategory;
  content: string;
  priority: number;
  tokens: number;
  projectKey?: string;
  cacheControl?: boolean;
}

export interface ContextBrokerOptions {
  workspacePath?: string;
  conversation?: Conversation;
  assistant?: Assistant;
  model?: Model;
  maxTokenBudget?: number;
}

export type ContextCollector = (options: ContextBrokerOptions) => Promise<string | null> | string | null;

/** Canonical trimming priority: higher number = more protected from trimming */
export const DEFAULT_CONTEXT_PRIORITY: Record<ContextCategory, number> = {
  rules: 100, // Never dropped
  memory: 90, // Protected user facts/preferences
  conversation: 85, // Core turn history
  project: 65, // AGENTS.md / project doc
  skills: 50, // Active skill tools
  files: 45, // Attached files
  task_results: 40, // DAG / subagent output summaries
  workflow_state: 30, // Background workflow progress
  git_state: 20, // Branch / commit status
  mcp_results: 10, // MCP tool telemetry / cache
};

/** Presentation layout order (ORDER in prompt) */
export const DEFAULT_CONTEXT_ORDER: ContextCategory[] = [
  "rules",
  "project",
  "files",
  "git_state",
  "mcp_results",
  "workflow_state",
  "task_results",
  "skills",
  "memory",
  "conversation",
];

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}

export function projectKeyFromPath(workspacePath?: string | null): string {
  if (!workspacePath || !workspacePath.trim()) return "global";
  const normalized = workspacePath.replace(/[\\/]+/g, "/").toLowerCase().trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export class ContextBroker {
  private collectors: Map<ContextCategory, ContextCollector> = new Map();
  private priorities: Record<ContextCategory, number> = { ...DEFAULT_CONTEXT_PRIORITY };
  private order: ContextCategory[] = [...DEFAULT_CONTEXT_ORDER];

  registerCollector(category: ContextCategory, collector: ContextCollector): void {
    this.collectors.set(category, collector);
  }

  setPriority(category: ContextCategory, priority: number): void {
    this.priorities[category] = priority;
  }

  setLayoutOrder(order: ContextCategory[]): void {
    this.order = [...order];
  }

  async collect(options: ContextBrokerOptions): Promise<ContextBlock[]> {
    const blocks: ContextBlock[] = [];
    const projectKey = projectKeyFromPath(options.workspacePath);

    for (const [category, collector] of this.collectors.entries()) {
      try {
        const rawContent = await Promise.resolve(collector(options));
        if (rawContent && rawContent.trim()) {
          const content = rawContent.trim();
          blocks.push({
            category,
            content,
            priority: this.priorities[category] ?? 50,
            tokens: estimateTokenCount(content),
            projectKey,
          });
        }
      } catch (err) {
        // Isolated collector fault tolerance: one failure never crashes other collectors
        console.warn(`[ContextBroker] Collector '${category}' failed safely:`, err);
      }
    }

    return blocks;
  }

  budgetTrim(blocks: ContextBlock[], maxTokens: number): ContextBlock[] {
    const totalTokens = blocks.reduce((acc, b) => acc + b.tokens, 0);
    if (totalTokens <= maxTokens) return [...blocks];

    // Sort by priority ascending (lowest priority trimmed first)
    const sortedForTrimming = [...blocks].sort((a, b) => a.priority - b.priority);
    let remainingTokens = totalTokens;
    const dropped = new Set<ContextCategory>();

    for (const block of sortedForTrimming) {
      // Never drop rules or memory if priority >= 90
      if (block.priority >= 90) continue;
      if (remainingTokens <= maxTokens) break;

      dropped.add(block.category);
      remainingTokens -= block.tokens;
    }

    return blocks.filter((b) => !dropped.has(b.category));
  }

  assemble(blocks: ContextBlock[], maxTokens?: number): string {
    const activeBlocks = maxTokens ? this.budgetTrim(blocks, maxTokens) : blocks;
    const categoryMap = new Map<ContextCategory, ContextBlock>();
    for (const b of activeBlocks) {
      categoryMap.set(b.category, b);
    }

    const orderedTexts: string[] = [];
    for (const cat of this.order) {
      const block = categoryMap.get(cat);
      if (block && block.content) {
        orderedTexts.push(`<!-- context:${cat} -->\n${block.content}`);
      }
    }

    return orderedTexts.join("\n\n");
  }

  applyAnthropicCacheControl(blocks: ContextBlock[]): ContextBlock[] {
    // Preserve prompt cache warmth by marking the largest stable prefix boundary
    // Usually rules or project doc
    let targetIndex = -1;
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].category === "rules" || blocks[i].category === "project") {
        targetIndex = i;
        break;
      }
    }

    return blocks.map((b, idx) => ({
      ...b,
      cacheControl: idx === targetIndex,
    }));
  }
}
