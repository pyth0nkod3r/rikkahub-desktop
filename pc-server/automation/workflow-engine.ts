import { id as newId } from "../foundation/utils";
import {
  getWorkflow,
  updateWorkflowLastFired,
} from "./db";
import type {
  WorkflowCondition,
  WorkflowRun,
} from "./types";
import { executeRegisteredTool } from "../tools/execution";

export class WorkflowEngine {
  async runWorkflow(workflowId: string): Promise<WorkflowRun> {
    const wf = getWorkflow(workflowId);
    if (!wf) {
      throw new Error(`Workflow with ID '${workflowId}' not found`);
    }

    const now = Date.now();
    // Check cooldown
    if (wf.cooldownSeconds && wf.lastFiredAt) {
      const elapsed = (now - wf.lastFiredAt) / 1000;
      if (elapsed < wf.cooldownSeconds) {
        return {
          id: newId(),
          workflowId: wf.id,
          status: "skipped",
          startedAt: now,
          finishedAt: now,
          results: [],
        };
      }
    }

    // Check conditions
    if (wf.conditions && !this.evaluateConditions(wf.conditions)) {
      return {
        id: newId(),
        workflowId: wf.id,
        status: "skipped",
        startedAt: now,
        finishedAt: now,
        results: [],
      };
    }

    const runId = newId();
    const startedAt = Date.now();
    const results: Array<{ tool: string; success: boolean; output?: string; error?: string }> = [];

    let overallSuccess = true;

    for (const action of wf.actions) {
      try {
        const out = await executeRegisteredTool(action.tool, action.args);
        results.push({
          tool: action.tool,
          success: true,
          output: typeof out === "string" ? out : JSON.stringify(out),
        });
      } catch (err) {
        overallSuccess = false;
        results.push({
          tool: action.tool,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
        break; // Stop sequential chain on first failure
      }
    }

    const finishedAt = Date.now();
    updateWorkflowLastFired(wf.id, finishedAt);

    return {
      id: runId,
      workflowId: wf.id,
      status: overallSuccess ? "success" : "failed",
      startedAt,
      finishedAt,
      results,
    };
  }

  private evaluateConditions(conditions: WorkflowCondition[]): boolean {
    const now = new Date();
    for (const cond of conditions) {
      let passed = true;

      switch (cond.type) {
        case "day_of_week_in": {
          const days = (cond.params?.days as number[]) || [];
          const currentDay = now.getDay() === 0 ? 7 : now.getDay(); // 1=Mon..7=Sun
          passed = days.includes(currentDay);
          break;
        }

        case "time_between": {
          const start = String(cond.params?.start || "00:00");
          const end = String(cond.params?.end || "23:59");
          const [sh, sm] = start.split(":").map(Number);
          const [eh, em] = end.split(":").map(Number);
          const curMinutes = now.getHours() * 60 + now.getMinutes();
          const startMinutes = sh * 60 + sm;
          const endMinutes = eh * 60 + em;

          if (startMinutes <= endMinutes) {
            passed = curMinutes >= startMinutes && curMinutes <= endMinutes;
          } else {
            // Wraps midnight
            passed = curMinutes >= startMinutes || curMinutes <= endMinutes;
          }
          break;
        }

        default:
          // Ambient conditions default to true
          passed = true;
          break;
      }

      if (cond.invert) {
        passed = !passed;
      }

      if (!passed) {
        return false;
      }
    }

    return true;
  }
}

export const workflowEngine = new WorkflowEngine();
