// subagents/verify.ts — Ledger-based verification for completed Sub-Agent runs (adopted from Agent-2)

import type { Conversation, Message } from "../foundation/types";
import type { SubAgentRun, SubAgentStatus } from "./types";

export type SubAgentVerificationVerdict =
  | "confirmed"
  | "contradicted"
  | "unconfirmed"
  | "unsuccessful"
  | "open";

export interface SubAgentVerificationCheck {
  command: string;
  exitCode: number | null;
  passed: boolean;
}

export interface SubAgentVerificationResult {
  verdict: SubAgentVerificationVerdict;
  summary: string;
  checksPassed: number;
  checksFailed: number;
  fileMutations: string[];
  toolCallCount: number;
  testCommands: SubAgentVerificationCheck[];
}

const VERIFICATION_COMMAND_RE =
  /\b(bun\s+test|bun\s+run\s+build|npm\s+test|npm\s+run\s+(test|build|lint|typecheck)|pnpm\s+test|yarn\s+test|pytest|cargo\s+test|cargo\s+check|go\s+test|vitest|jest|tsc|ruff|eslint)\b/i;

const EXIT_CODE_RE = /(?:exit(?:ed)?(?:\s+with)?\s+code|exit_code|exitCode)\s*[:=\s]\s*(-?\d+)/i;

function isTerminalFailureStatus(status: SubAgentStatus): boolean {
  return status === "failed" || status === "timed_out" || status === "cancelled";
}

function activeMessagesOf(conversation: Conversation | null | undefined): Message[] {
  if (!conversation?.messages) return [];
  const out: Message[] = [];
  for (const node of conversation.messages) {
    const active = node.messages?.[node.selectIndex] ?? node.messages?.[0];
    if (active) out.push(active);
  }
  return out;
}

function outputTextOf(output: unknown): string {
  if (!Array.isArray(output)) return typeof output === "string" ? output : JSON.stringify(output ?? "");
  return output
    .map((item) => {
      if (item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string") {
        return (item as { text: string }).text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function looksLikeToolError(outputText: string, part: Record<string, unknown>): boolean {
  if (part.isError === true) return true;
  const trimmed = outputText.trimStart();
  if (/^(?:error|tool error|failed):/i.test(trimmed)) return true;
  const exitMatch = EXIT_CODE_RE.exec(outputText);
  if (exitMatch && Number(exitMatch[1]) !== 0) return true;
  return false;
}

function extractExitCode(outputText: string, failed: boolean): number | null {
  const match = EXIT_CODE_RE.exec(outputText);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return failed ? null : 0;
}

/**
 * Inspects a SubAgentRun and its sub-conversation tool ledger to compute an objective verification verdict.
 * Never throws; always returns a deterministic SubAgentVerificationResult.
 */
export function verifySubAgentRun(
  run: Pick<SubAgentRun, "status" | "error" | "result" | "worktreeDiff">,
  conversation?: Conversation | null,
): SubAgentVerificationResult {
  if (run.status === "pending" || run.status === "running") {
    return {
      verdict: "open",
      summary: "Sub-agent run is still active.",
      checksPassed: 0,
      checksFailed: 0,
      fileMutations: [],
      toolCallCount: 0,
      testCommands: [],
    };
  }

  if (isTerminalFailureStatus(run.status)) {
    return {
      verdict: "unsuccessful",
      summary: `Run ended as ${run.status}${run.error ? `: ${run.error.slice(0, 180)}` : "."}`,
      checksPassed: 0,
      checksFailed: 0,
      fileMutations: [],
      toolCallCount: 0,
      testCommands: [],
    };
  }

  const messages = activeMessagesOf(conversation);
  const fileMutations = new Set<string>();
  const testCommands: SubAgentVerificationCheck[] = [];
  let toolCallCount = 0;
  let toolErrors = 0;
  let checksPassed = 0;
  let checksFailed = 0;
  let readOnlySuccessCount = 0;

  for (const msg of messages) {
    for (const rawPart of msg.parts ?? []) {
      const part = rawPart as unknown as Record<string, unknown>;
      if (!part || part.type !== "tool") continue;
      toolCallCount += 1;

      const toolName = String(part.toolName ?? "").toLowerCase();
      const inputObj =
        part.input && typeof part.input === "object"
          ? (part.input as Record<string, unknown>)
          : {};
      const outText = outputTextOf(part.output);
      const isErr = looksLikeToolError(outText, part);

      if (isErr) toolErrors += 1;

      if ((toolName === "write" || toolName === "edit") && typeof inputObj.path === "string" && !isErr) {
        fileMutations.add(inputObj.path);
        continue;
      }

      if (toolName === "bash" && typeof inputObj.command === "string") {
        const cmd = inputObj.command.trim();
        if (VERIFICATION_COMMAND_RE.test(cmd)) {
          const exitCode = extractExitCode(outText, isErr);
          const passed = !isErr && (exitCode === null || exitCode === 0);
          testCommands.push({ command: cmd.slice(0, 120), exitCode, passed });
          if (passed) checksPassed += 1;
          else checksFailed += 1;
        }
        continue;
      }

      if (!isErr && (toolName === "read" || toolName === "grep" || toolName === "find" || toolName === "ls" || toolName === "web_search" || toolName === "web_fetch")) {
        readOnlySuccessCount += 1;
      }
    }
  }

  const mutations = Array.from(fileMutations);

  if (checksFailed > 0) {
    return {
      verdict: "contradicted",
      summary: `${checksFailed} verification check(s) failed (${checksPassed} passed, ${mutations.length} file(s) modified).`,
      checksPassed,
      checksFailed,
      fileMutations: mutations,
      toolCallCount,
      testCommands,
    };
  }

  if (checksPassed > 0) {
    return {
      verdict: "confirmed",
      summary: `${checksPassed} test/build check(s) passed${mutations.length > 0 ? ` after modifying ${mutations.length} file(s)` : ""}.`,
      checksPassed,
      checksFailed,
      fileMutations: mutations,
      toolCallCount,
      testCommands,
    };
  }

  if (toolErrors > 0 && toolErrors >= Math.max(1, Math.ceil(toolCallCount / 2))) {
    return {
      verdict: "contradicted",
      summary: `High tool error rate observed (${toolErrors}/${toolCallCount} tool calls failed).`,
      checksPassed,
      checksFailed,
      fileMutations: mutations,
      toolCallCount,
      testCommands,
    };
  }

  if (mutations.length > 0 || (run.worktreeDiff && run.worktreeDiff.trim().length > 0)) {
    return {
      verdict: "unconfirmed",
      summary: `Modified ${mutations.length || "workspace"} file(s) without running a test or build check.`,
      checksPassed,
      checksFailed,
      fileMutations: mutations,
      toolCallCount,
      testCommands,
    };
  }

  if (readOnlySuccessCount > 0 || (toolCallCount > 0 && toolErrors === 0)) {
    return {
      verdict: "confirmed",
      summary: `Verified with ${toolCallCount} successful tool call(s) and 0 errors.`,
      checksPassed,
      checksFailed,
      fileMutations: mutations,
      toolCallCount,
      testCommands,
    };
  }

  return {
    verdict: "unconfirmed",
    summary: "Completed with narrative output only (no tool execution evidence in ledger).",
    checksPassed,
    checksFailed,
    fileMutations: mutations,
    toolCallCount,
    testCommands,
  };
}
