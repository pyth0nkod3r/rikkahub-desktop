import { describe, expect, test } from "bun:test";
import { extractCompletedToolRecords } from "./tool-ledger";
import type { Message } from "../foundation/types";

describe("tool-ledger: deterministic context retention", () => {
  test("extracts completed tool records with inputs and outputs", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        sender: "ASSISTANT",
        createAt: 1000,
        parts: [
          {
            type: "tool",
            toolName: "workspace_edit",
            input: { path: "src/config.ts", edit: "export const PORT = 8080;" },
            output: [{ type: "text", text: "Successfully edited src/config.ts" }],
          },
        ],
      },
      {
        id: "msg-2",
        sender: "ASSISTANT",
        createAt: 2000,
        parts: [
          {
            type: "tool",
            toolName: "workspace_bash",
            input: { command: "git status" },
            output: [{ type: "text", text: "On branch feature/agent-harness\nnothing to commit" }],
          },
        ],
      },
    ];

    const ledger = extractCompletedToolRecords(messages);
    expect(ledger).toContain("[Tool execution history — authoritative retained context]");
    expect(ledger).toContain("workspace_edit");
    expect(ledger).toContain("src/config.ts");
    expect(ledger).toContain("Successfully edited src/config.ts");
    expect(ledger).toContain("workspace_bash");
    expect(ledger).toContain("git status");
    expect(ledger).toContain("[End tool execution history]");
  });

  test("handles empty messages or messages without tool calls gracefully", () => {
    const messages: Message[] = [
      {
        id: "msg-1",
        sender: "USER",
        createAt: 1000,
        parts: [{ type: "text", text: "Hello" }],
      },
    ];
    const ledger = extractCompletedToolRecords(messages);
    expect(ledger).toBe("");
  });
});
