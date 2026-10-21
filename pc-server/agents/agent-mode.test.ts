import { describe, expect, it } from "bun:test";
import { isToolAllowedInPlanMode, PLAN_MODE_SYSTEM_PROMPT } from "./agent-mode";

describe("AgentMode", () => {
  it("allows read-only and inspection tools in plan mode", () => {
    expect(isToolAllowedInPlanMode("propose_plan")).toBe(true);
    expect(isToolAllowedInPlanMode("ask_user")).toBe(true);
    expect(isToolAllowedInPlanMode("get_time_info")).toBe(true);
    expect(isToolAllowedInPlanMode("read")).toBe(true);
    expect(isToolAllowedInPlanMode("grep")).toBe(true);
    expect(isToolAllowedInPlanMode("find")).toBe(true);
    expect(isToolAllowedInPlanMode("ls")).toBe(true);
    expect(isToolAllowedInPlanMode("web_search")).toBe(true);
    expect(isToolAllowedInPlanMode("browser_open")).toBe(true);
  });

  it("blocks modifying and execution tools in plan mode", () => {
    expect(isToolAllowedInPlanMode("write")).toBe(false);
    expect(isToolAllowedInPlanMode("edit")).toBe(false);
    expect(isToolAllowedInPlanMode("bash")).toBe(false);
    expect(isToolAllowedInPlanMode("ssh_exec")).toBe(false);
    expect(isToolAllowedInPlanMode("termux_run_command")).toBe(false);
  });

  it("contains plan mode guidance in system prompt", () => {
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain("[AGENT MODE: PLAN]");
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain("propose_plan");
    expect(PLAN_MODE_SYSTEM_PROMPT).toContain("State-modifying and execution tools are locked");
  });
});
