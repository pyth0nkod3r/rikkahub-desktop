import { describe, expect, test } from "bun:test";
import { extractDsmlToolCalls, hasDsmlToolDelimiters, sanitizeMessageDsmlParts } from "./dsml";
import type { Message } from "../foundation/types";

describe("DeepSeek DSML Tool Interception", () => {
  test("detects DSML tool delimiters", () => {
    expect(hasDsmlToolDelimiters("Hello world")).toBe(false);
    expect(hasDsmlToolDelimiters("Here is a tool: <｜tool call begin｜>get_weather<｜tool sep｜>{}<｜tool call end｜>")).toBe(true);
    expect(hasDsmlToolDelimiters("<｜tool calls begin｜>...<｜tool calls end｜>")).toBe(true);
  });

  test("extracts single tool call and strips delimiters", () => {
    const input = 'I will search for the weather.<｜tool calls begin｜><｜tool call begin｜>get_weather<｜tool sep｜>{"city": "Tokyo"}<｜tool call end｜><｜tool calls end｜>';
    const { sanitizedText, extractedCalls } = extractDsmlToolCalls(input);

    expect(sanitizedText).toBe("I will search for the weather.");
    expect(extractedCalls.length).toBe(1);
    expect(extractedCalls[0].name).toBe("get_weather");
    expect(extractedCalls[0].arguments).toEqual({ city: "Tokyo" });
  });

  test("extracts tool call wrapped in markdown code fence", () => {
    const input = 'Let me run a command.<｜tool call begin｜>workspace_run_command<｜tool sep｜>```json\n{"command": "git status"}\n```<｜tool call end｜>';
    const { sanitizedText, extractedCalls } = extractDsmlToolCalls(input);

    expect(sanitizedText).toBe("Let me run a command.");
    expect(extractedCalls.length).toBe(1);
    expect(extractedCalls[0].name).toBe("workspace_run_command");
    expect(extractedCalls[0].arguments).toEqual({ command: "git status" });
  });

  test("extracts multiple tool calls", () => {
    const input = '<｜tool calls begin｜><｜tool call begin｜>step_one<｜tool sep｜>{"a": 1}<｜tool call end｜><｜tool call begin｜>step_two<｜tool sep｜>{"b": 2}<｜tool call end｜><｜tool calls end｜>';
    const { sanitizedText, extractedCalls } = extractDsmlToolCalls(input);

    expect(sanitizedText).toBe("");
    expect(extractedCalls.length).toBe(2);
    expect(extractedCalls[0].name).toBe("step_one");
    expect(extractedCalls[0].arguments).toEqual({ a: 1 });
    expect(extractedCalls[1].name).toBe("step_two");
    expect(extractedCalls[1].arguments).toEqual({ b: 2 });
  });

  test("sanitizes message text parts in place", () => {
    const msg: Message = {
      id: "msg-1",
      role: "ASSISTANT",
      parts: [
        { type: "text", text: 'Checking status... <｜tool call begin｜>check_sys<｜tool sep｜>{}<｜tool call end｜>' },
      ],
      createdAt: new Date().toISOString(),
    };

    sanitizeMessageDsmlParts(msg);
    expect((msg.parts[0] as any).text).toBe("Checking status...");
  });
});
