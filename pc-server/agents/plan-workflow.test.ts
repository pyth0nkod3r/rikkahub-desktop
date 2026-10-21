import { describe, expect, it } from "bun:test";
import { parseProposePlanInput, formatProposePlanResult } from "../tools/propose-plan";
import { isToolAllowedInPlanMode, PLAN_MODE_SYSTEM_PROMPT } from "./agent-mode";

describe("Plan Mode Workflow", () => {
  it("parses propose_plan input arguments properly", () => {
    const input = parseProposePlanInput({
      title: "Migrate database",
      overview: "Migrate schema to v2",
      steps: ["Step 1", "Step 2"],
      plan_markdown: "# Plan details\n- Migrate column",
    });
    expect(input.title).toBe("Migrate database");
    expect(input.overview).toBe("Migrate schema to v2");
    expect(input.steps).toEqual(["Step 1", "Step 2"]);
    expect(input.plan_markdown).toContain("# Plan details");
  });

  it("formats approved and declined outcomes", () => {
    const approved = formatProposePlanResult(true);
    expect(approved[0]?.type).toBe("text");
    if (approved[0]?.type === "text") {
      expect(approved[0].text).toContain("plan_approved");
      expect(approved[0].text).toContain("BUILD");
    }

    const declined = formatProposePlanResult(false, "Needs more detail");
    expect(declined[0]?.type).toBe("text");
    if (declined[0]?.type === "text") {
      expect(declined[0].text).toContain("plan_declined");
      expect(declined[0].text).toContain("Needs more detail");
    }
  });

  it("strictly enforces read-only tool confinement in plan mode", () => {
    expect(isToolAllowedInPlanMode("read")).toBe(true);
    expect(isToolAllowedInPlanMode("grep")).toBe(true);
    expect(isToolAllowedInPlanMode("find")).toBe(true);
    expect(isToolAllowedInPlanMode("ls")).toBe(true);
    expect(isToolAllowedInPlanMode("propose_plan")).toBe(true);
    expect(isToolAllowedInPlanMode("ask_user")).toBe(true);

    expect(isToolAllowedInPlanMode("write")).toBe(false);
    expect(isToolAllowedInPlanMode("edit")).toBe(false);
    expect(isToolAllowedInPlanMode("bash")).toBe(false);

    expect(PLAN_MODE_SYSTEM_PROMPT).toContain("[AGENT MODE: PLAN]");
  });
});
