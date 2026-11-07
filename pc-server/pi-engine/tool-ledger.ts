// pi-engine/tool-ledger.ts — Deterministic tool execution ledger for context retention
// Ported from rikkahub-agent (Pyth0nkod3r fork) ContextCompactionPlanner.kt

import type { Message } from "../foundation/types";

export const TOOL_HISTORY_HEADER = "[Tool execution history — authoritative retained context]";
export const TOOL_HISTORY_FOOTER = "[End tool execution history]";
export const TOOL_RECORD_HEADER = "[Retained tool execution record]";
export const TOOL_RECORD_FOOTER = "[End retained tool execution record]";

const MAP_TOOL_OUTPUT_PREVIEW_CHARS = 1024;

/**
 * Extracts completed tool executions from message history to form a deterministic factual ledger.
 * This ensures that even after conversational compaction or message truncation, the model retains:
 * - Which tools ran
 * - File paths edited / created
 * - Commands executed and exit codes
 * - Key variables, IDs, and returned values
 */
export function extractCompletedToolRecords(messages: Message[], maxTokens = 4096): string {
  if (!messages || messages.length === 0) return "";
  const records: string[] = [];

  for (const message of messages) {
    if (!message.parts || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (part && part.type === "tool") {
        const toolName = String(part.toolName ?? "");
        const output = Array.isArray(part.output) ? part.output : [];
        if (output.length === 0) continue;

        let resultPreview = "";
        const textParts = output
          .filter((o) => o && o.type === "text" && typeof o.text === "string")
          .map((o) => o.text);
        if (textParts.length > 0) {
          resultPreview = textParts.join("\n");
        } else {
          resultPreview = JSON.stringify(output);
        }

        if (resultPreview.length > MAP_TOOL_OUTPUT_PREVIEW_CHARS) {
          resultPreview = resultPreview.slice(0, MAP_TOOL_OUTPUT_PREVIEW_CHARS) + " …[truncated]";
        }

        let inputStr = "";
        try {
          inputStr = typeof part.input === "string" ? part.input : JSON.stringify(part.input ?? {});
        } catch {
          inputStr = String(part.input ?? "");
        }
        if (inputStr.length > 400) {
          inputStr = inputStr.slice(0, 400) + " …[truncated]";
        }

        records.push(
          [
            `- Tool: ${toolName}`,
            part.toolCallId ? `  Call ID: ${part.toolCallId}` : "",
            `  Input: ${inputStr}`,
            `  Result: ${resultPreview}`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    }
  }

  if (records.length === 0) return "";

  const header = `${TOOL_HISTORY_HEADER}\n`;
  const footer = `\n${TOOL_HISTORY_FOOTER}`;
  let ledger = header;

  for (let i = 0; i < records.length; i++) {
    const block = `${TOOL_RECORD_HEADER}\n${records[i]}\n${TOOL_RECORD_FOOTER}\n`;
    if (ledger.length + block.length + footer.length > maxTokens * 4) {
      ledger += `... [${records.length - i} more tool records omitted to fit budget]\n`;
      break;
    }
    ledger += block;
  }
  ledger += footer;
  return ledger.trim();
}
