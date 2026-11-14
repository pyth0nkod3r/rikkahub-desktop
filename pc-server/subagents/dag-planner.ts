// subagents/dag-planner.ts — Dynamic Goal-to-DAG Workflow Planner
// Adopted from Agent-2 architecture (agent2/core/workflow/dynamic.py)
// Synthesizes cycle-checked, dependency-aware task DAGs from natural language goals.

import type { DagTaskSpec, DagRunResult } from "./dag";
import { validateDagTasks, executeSubAgentDag } from "./dag";

export interface DagPlanOptions {
  workspacePath?: string;
  defaultModelId?: string;
  availableProfiles?: string[];
  mode?: "plan" | "auto";
  maxParallel?: number;
  dispatchFn?: (task: DagTaskSpec) => Promise<{ success: boolean; output: string }>;
}

export interface DagPlanResult {
  ok: boolean;
  status: "planned" | "executed" | "error";
  goal: string;
  tasks: DagTaskSpec[];
  execution?: DagRunResult;
  error?: string;
}

/**
 * Heuristic goal analyzer that extracts sequential and parallel stages from goal text
 * when not invoking full LLM planner.
 */
export function synthesizeDagFromGoal(goal: string, options?: { defaultModelId?: string }): DagTaskSpec[] {
  const trimmed = goal.trim();
  const tasks: DagTaskSpec[] = [];

  // Match common multi-stage patterns: lines starting with numbers, bullet points, or step keywords
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && /^(?:\d+[\.\)]|[-*•]|step\s*\d+[:\-]|phase\s*\d+[:\-])/i.test(l));

  if (lines.length >= 2) {
    let prevTaskId: string | null = null;
    lines.forEach((line, idx) => {
      const taskId = `step-${idx + 1}`;
      const cleanTask = line.replace(/^(?:\d+[\.\)]|[-*•]|step\s*\d+[:\-]|phase\s*\d+[:\-])\s*/i, "").trim();

      // Guess role based on keywords
      let role = "builder";
      const lower = cleanTask.toLowerCase();
      if (lower.includes("research") || lower.includes("investigate") || lower.includes("explore") || lower.includes("find")) {
        role = "researcher";
      } else if (lower.includes("critic") || lower.includes("verify") || lower.includes("review") || lower.includes("audit") || lower.includes("test")) {
        role = "critic";
      } else if (lower.includes("plan") || lower.includes("design") || lower.includes("spec") || lower.includes("architecture")) {
        role = "planner";
      } else if (lower.includes("merge") || lower.includes("integrate") || lower.includes("rebase")) {
        role = "merger";
      }

      const taskSpec: DagTaskSpec = {
        id: taskId,
        agent: role,
        task: cleanTask,
        modelId: options?.defaultModelId,
        dependsOn: prevTaskId ? [prevTaskId] : undefined,
        depends_on: prevTaskId ? [prevTaskId] : undefined,
      };

      tasks.push(taskSpec);
      prevTaskId = taskId;
    });
  } else {
    // Single-goal decomposition into standard RikkaHub pipeline: Plan -> Build -> Verify
    const planTask: DagTaskSpec = {
      id: "plan-spec",
      agent: "planner",
      task: `Analyze requirements and create task plan for: ${trimmed}`,
      modelId: options?.defaultModelId,
    };
    const buildTask: DagTaskSpec = {
      id: "build-impl",
      agent: "builder",
      task: `Implement code changes according to plan for: ${trimmed}`,
      dependsOn: ["plan-spec"],
      depends_on: ["plan-spec"],
      modelId: options?.defaultModelId,
    };
    const verifyTask: DagTaskSpec = {
      id: "verify-critic",
      agent: "critic",
      task: `Run tests, lint, and verify implementation for: ${trimmed}`,
      dependsOn: ["build-impl"],
      depends_on: ["build-impl"],
      modelId: options?.defaultModelId,
    };
    tasks.push(planTask, buildTask, verifyTask);
  }

  return tasks;
}

export async function planGoalToDag(
  goal: string,
  options: DagPlanOptions = {},
): Promise<DagPlanResult> {
  if (!goal || !goal.trim()) {
    return {
      ok: false,
      status: "error",
      goal: "",
      tasks: [],
      error: "Goal cannot be empty",
    };
  }

  const tasks = synthesizeDagFromGoal(goal, { defaultModelId: options.defaultModelId });
  const validation = validateDagTasks(tasks);
  if (!validation.ok) {
    return {
      ok: false,
      status: "error",
      goal,
      tasks,
      error: `Generated DAG failed validation: ${validation.error}`,
    };
  }

  if (options.mode === "auto") {
    const execution = await executeSubAgentDag({
      tasks,
      maxParallel: options.maxParallel,
    });
    return {
      ok: execution.ok,
      status: "executed",
      goal,
      tasks,
      execution,
    };
  }

  return {
    ok: true,
    status: "planned",
    goal,
    tasks,
  };
}
