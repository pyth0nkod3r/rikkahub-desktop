// inference-engine/dsml.ts — DeepSeek DSML tool call parsing & sanitization
// Ported from rikkahub-agent GenerationLoop.kt (commit ec6d23dc)
//
// DeepSeek-V3 / DeepSeek-R1 (and models served via DeepSeek API, OpenRouter, SiliconFlow)
// sometimes stream raw DSML tool delimiters into text parts rather than native tool_call frames:
//   <｜tool calls begin｜><｜tool call begin｜>toolName<｜tool sep｜>args<｜tool call end｜><｜tool calls end｜>
// This module intercepts those leaked tokens, extracts executable ToolCalls, and strips the
// raw syntax from message text parts so user chats remain clean.

import type { ToolCall } from "./events";
import type { Message } from "../foundation/types";
import { id, isRecord } from "../foundation/utils";

const DSML_TOOL_PATTERN = /<｜tool calls begin｜>[\s\S]*?<｜tool call begin｜>(\w+)<｜tool sep｜>([\s\S]*?)<｜tool call end｜>[\s\S]*?<｜tool calls end｜>/g;
const DSML_SINGLE_TOOL_PATTERN = /<｜tool call begin｜>(\w+)<｜tool sep｜>([\s\S]*?)<｜tool call end｜>/g;
const DSML_DELIMITER_STRIP = /<｜tool [^>]+｜>|｜DSML｜|<｜tool calls begin｜>|<｜tool calls end｜>/g;

export function hasDsmlToolDelimiters(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.includes("<｜tool call") || text.includes("<｜tool calls begin｜>");
}

export function extractDsmlToolCalls(rawText: string): { sanitizedText: string; extractedCalls: ToolCall[] } {
  const extractedCalls: ToolCall[] = [];
  const matches = [...rawText.matchAll(DSML_SINGLE_TOOL_PATTERN)];

  for (const match of matches) {
    const toolName = match[1];
    let argsRaw = (match[2] ?? "").trim();
    if (argsRaw.startsWith("```json")) {
      argsRaw = argsRaw.slice(7);
    } else if (argsRaw.startsWith("```")) {
      argsRaw = argsRaw.slice(3);
    }
    if (argsRaw.endsWith("```")) {
      argsRaw = argsRaw.slice(0, -3);
    }
    argsRaw = argsRaw.trim();

    let parsedArgs: Record<string, unknown> = {};
    if (argsRaw) {
      try {
        const parsed = JSON.parse(argsRaw);
        if (isRecord(parsed)) {
          parsedArgs = parsed as Record<string, unknown>;
        } else {
          parsedArgs = { value: parsed };
        }
      } catch {
        parsedArgs = { raw: argsRaw };
      }
    }

    extractedCalls.push({
      id: `call_${id()}`,
      name: toolName,
      arguments: parsedArgs,
    });
  }

  const sanitizedText = rawText
    .replace(DSML_TOOL_PATTERN, "")
    .replace(DSML_SINGLE_TOOL_PATTERN, "")
    .replace(DSML_DELIMITER_STRIP, "")
    .trim();

  return { sanitizedText, extractedCalls };
}

export function sanitizeMessageDsmlParts(message: Message): void {
  message.parts = message.parts.map((part) => {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      const sanitized = part.text
        .replace(DSML_TOOL_PATTERN, "")
        .replace(DSML_SINGLE_TOOL_PATTERN, "")
        .replace(DSML_DELIMITER_STRIP, "")
        .trim();
      return { ...part, text: sanitized };
    }
    return part;
  });
}
