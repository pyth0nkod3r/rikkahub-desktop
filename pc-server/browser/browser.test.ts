import { describe, expect, it } from "bun:test";
import { findBrowserExecutable } from "./driver";
import {
  isBrowserTool,
  openAiBrowserTools,
} from "../tools/browser-tools";

describe("Browser Automation Driver & Tools", () => {
  it("detects system browser executable on Windows", () => {
    const exe = findBrowserExecutable();
    // On Windows development system, Microsoft Edge is installed
    expect(exe).not.toBeNull();
    expect(typeof exe).toBe("string");
    expect(exe!.toLowerCase()).toMatch(/(edge|chrome)/);
  });

  it("identifies browser tools correctly", () => {
    expect(isBrowserTool("browser_open")).toBe(true);
    expect(isBrowserTool("browser_click")).toBe(true);
    expect(isBrowserTool("browser_type")).toBe(true);
    expect(isBrowserTool("browser_screenshot")).toBe(true);
    expect(isBrowserTool("browser_get_dom")).toBe(true);
    expect(isBrowserTool("browser_get_text")).toBe(true);
    expect(isBrowserTool("browser_eval_js")).toBe(true);
    expect(isBrowserTool("browser_close")).toBe(true);
    expect(isBrowserTool("subagent_dispatch")).toBe(false);
    expect(isBrowserTool("bash")).toBe(false);
  });

  it("exposes valid OpenAI tool schemas", () => {
    const tools = openAiBrowserTools();
    expect(tools.length).toBe(9);
    for (const tool of tools) {
      expect(tool.type).toBe("function");
      expect(tool.function.name).toMatch(/^browser_/);
      expect(tool.function.description.length).toBeGreaterThan(10);
      expect(tool.function.parameters).toBeDefined();
    }
  });
});
