// subagents/recovery.ts — Interrupted Run Recovery & Safety Classification
// Adopted from Agent-2 architecture (agent2/core/recovery/recovery.py)

import type { Conversation, Message } from "../foundation/types";
import type { SubAgentRun } from "./types";

export type StepSafety = "safe_to_repeat" | "safe_to_continue";

export interface RecoveredStep {
  toolName: string;
  args: Record<string, unknown>;
  safety: StepSafety;
  completed: boolean;
}

const READ_ONLY_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "dir",
  "subagent_get",
  "subagent_list",
  "web_search",
  "web_fetch",
  "git_status",
  "git_diff",
  "git_log",
]);

export function classifyToolSafety(toolName: string): StepSafety {
  const normalized = toolName.toLowerCase().trim();
  if (READ_ONLY_TOOLS.has(normalized)) {
    return "safe_to_repeat";
  }
  return "safe_to_continue";
}

export function extractInterruptedSteps(conversation: Conversation): RecoveredStep[] {
  const steps: RecoveredStep[] = [];
  if (!conversation.messages) return steps;

  for (const node of conversation.messages) {
    const active = node.messages?.[node.selectIndex] ?? node.messages?.[0];
    if (!active?.parts) continue;

    for (const part of active.parts as unknown as Array<Record<string, unknown>>) {
      if (part.type === "tool_call" || part.type === "call") {
        const toolName = String(part.toolName ?? part.name ?? "");
        const args = (part.args ?? part.input ?? {}) as Record<string, unknown>;
        const safety = classifyToolSafety(toolName);
        const completed = Boolean(part.result || part.output);
        steps.push({ toolName, args, safety, completed });
      }
    }
  }

  return steps;
}

export function synthesizeRecoveryBriefing(
  run: SubAgentRun,
  conversation?: Conversation | null,
): string {
  const steps = conversation ? extractInterruptedSteps(conversation) : [];
  const completedMutations = steps.filter((s) => s.safety === "safe_to_continue" && s.completed);
  const pendingOrInterrupted = steps.filter((s) => !s.completed);

  const lines: string[] = [
    `## Crash Recovery Briefing for Sub-Agent Run "${run.id}"`,
    `Agent: ${run.agentName} | Label: ${run.label ?? run.id}`,
    `Previous status: ${run.status} | Finished: ${run.finishedAtMs ? new Date(run.finishedAtMs).toISOString() : "Interrupted"}`,
    "",
    "### Executed Mutations (Do NOT repeat):",
  ];

  if (completedMutations.length === 0) {
    lines.push("- No file or system mutations were executed prior to interruption.");
  } else {
    for (const m of completedMutations) {
      lines.push(`- [MUTATED] ${m.toolName}: ${JSON.stringify(m.args)}`);
    }
  }

  lines.push("", "### Interrupted / Pending Operations:");
  if (pendingOrInterrupted.length === 0) {
    lines.push("- None recorded.");
  } else {
    for (const p of pendingOrInterrupted) {
      lines.push(`- [${p.safety.toUpperCase()}] ${p.toolName}`);
    }
  }

  lines.push(
    "",
    "### Recovery Directive:",
    "Review current workspace disk state against the executed mutations above before performing further edits. Do not blindly repeat executed writes.",
  );

  return lines.join("\n");
}
