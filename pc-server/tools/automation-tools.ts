import {
  deleteScheduledJob,
  deleteWorkflow,
  getScheduledJob,
  insertWorkflow,
  listScheduledJobs,
  listWorkflows,
} from "../automation/db";
import { automationScheduler } from "../automation/scheduler";
import { workflowEngine } from "../automation/workflow-engine";
import { id as newId } from "../foundation/utils";
import type { AutomationMode, ScheduleType, Workflow } from "../automation/types";

export const SCHEDULE_JOB_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "schedule_job",
    description:
      "Schedule a recurring cron job or one-shot timer. Two modes: 'llm' (runs prompt with reasoning model) or 'direct' (executes fixed tool calls sequentially). Supported schedule types: 'cron' (5-field cron or @daily, @hourly, @every 30m) or 'once' (absolute at_unix_ms timestamp).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Job title / identifier" },
        description: { type: "string", description: "Optional description of what the job does" },
        mode: { type: "string", enum: ["llm", "direct"], description: "'llm' sends prompt to model; 'direct' runs fixed tool actions" },
        schedule_type: { type: "string", enum: ["cron", "once"], description: "'cron' for recurring schedule; 'once' for single timestamp" },
        prompt: { type: "string", description: "Prompt for mode='llm'" },
        actions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tool: { type: "string" },
              args: { type: "object" },
            },
            required: ["tool", "args"],
          },
          description: "Tool calls for mode='direct'",
        },
        cron_expression: { type: "string", description: "5-field cron expression, or @daily, @hourly, @every 15m" },
        at_unix_ms: { type: "number", description: "Unix epoch ms for schedule_type='once'" },
        assistant_id: { type: "string", description: "Optional assistant id to execute prompt" },
        max_runs: { type: "number", description: "Optional max number of fires before auto-disabling" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["name", "mode", "schedule_type"],
    },
  },
};

export const LIST_JOBS_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "list_jobs",
    description: "List all scheduled jobs, including their status, schedule type, and next scheduled run.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export const DELETE_JOB_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "delete_job",
    description: "Delete a scheduled job by its ID.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The scheduled job ID to delete" },
      },
      required: ["id"],
    },
  },
};

export const PAUSE_JOB_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "pause_job",
    description: "Pause an active scheduled job.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The scheduled job ID to pause" },
      },
      required: ["id"],
    },
  },
};

export const RESUME_JOB_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "resume_job",
    description: "Resume a paused scheduled job and recompute its next scheduled run.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The scheduled job ID to resume" },
      },
      required: ["id"],
    },
  },
};

export const WORKFLOW_CREATE_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "workflow_create",
    description: "Create an event-driven or manual workflow with trigger, conditions, and sequential actions.",
    parameters: {
      type: "object",
      properties: {
        definition: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            trigger: {
              type: "object",
              properties: {
                type: { type: "string" },
                params: { type: "object" },
              },
              required: ["type"],
            },
            conditions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  params: { type: "object" },
                  invert: { type: "boolean" },
                },
                required: ["type"],
              },
            },
            actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  tool: { type: "string" },
                  args: { type: "object" },
                },
                required: ["tool", "args"],
              },
            },
            cooldown_seconds: { type: "number" },
          },
          required: ["name", "trigger", "actions"],
        },
      },
      required: ["definition"],
    },
  },
};

export const WORKFLOW_LIST_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "workflow_list",
    description: "List all defined workflows and their status.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export const WORKFLOW_RUN_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "workflow_run",
    description: "Trigger a workflow immediately by its ID.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Workflow ID" },
      },
      required: ["id"],
    },
  },
};

export const WORKFLOW_DELETE_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "workflow_delete",
    description: "Delete a workflow by its ID.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Workflow ID to delete" },
      },
      required: ["id"],
    },
  },
};

export const AUTOMATION_TOOL_SCHEMAS = [
  SCHEDULE_JOB_TOOL_SCHEMA,
  LIST_JOBS_TOOL_SCHEMA,
  DELETE_JOB_TOOL_SCHEMA,
  PAUSE_JOB_TOOL_SCHEMA,
  RESUME_JOB_TOOL_SCHEMA,
  WORKFLOW_CREATE_TOOL_SCHEMA,
  WORKFLOW_LIST_TOOL_SCHEMA,
  WORKFLOW_RUN_TOOL_SCHEMA,
  WORKFLOW_DELETE_TOOL_SCHEMA,
];

// Tool Handlers
export async function handleScheduleJob(args: Record<string, unknown>, assistantId?: string): Promise<string> {
  const name = String(args.name || "").trim();
  if (!name) throw new Error("Missing required field: name");

  const mode = String(args.mode || "llm") as AutomationMode;
  const scheduleType = String(args.schedule_type || "cron") as ScheduleType;

  const job = automationScheduler.schedule({
    name,
    description: args.description ? String(args.description) : undefined,
    assistantId: String(args.assistant_id || assistantId || "default"),
    mode,
    scheduleType,
    prompt: args.prompt ? String(args.prompt) : undefined,
    actions: Array.isArray(args.actions) ? (args.actions as any) : undefined,
    cronExpression: args.cron_expression ? String(args.cron_expression) : undefined,
    atUnixMs: typeof args.at_unix_ms === "number" ? args.at_unix_ms : undefined,
    maxRuns: typeof args.max_runs === "number" ? args.max_runs : undefined,
    tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
  });

  return JSON.stringify({
    ok: true,
    job: {
      id: job.id,
      name: job.name,
      mode: job.mode,
      scheduleType: job.scheduleType,
      nextRunAt: job.nextRunAt ? new Date(job.nextRunAt).toISOString() : null,
    },
  });
}

export async function handleListJobs(): Promise<string> {
  const jobs = listScheduledJobs();
  return JSON.stringify({
    ok: true,
    count: jobs.length,
    jobs: jobs.map((j) => ({
      id: j.id,
      name: j.name,
      enabled: j.enabled,
      mode: j.mode,
      scheduleType: j.scheduleType,
      cronExpression: j.cronExpression,
      nextRunAt: j.nextRunAt ? new Date(j.nextRunAt).toISOString() : null,
      lastRunAt: j.lastRunAt ? new Date(j.lastRunAt).toISOString() : null,
      runCount: j.runCount,
    })),
  });
}

export async function handleDeleteJob(args: Record<string, unknown>): Promise<string> {
  const id = String(args.id || "").trim();
  if (!id) throw new Error("Missing required field: id");
  const success = deleteScheduledJob(id);
  return JSON.stringify({ ok: success, id });
}

export async function handlePauseJob(args: Record<string, unknown>): Promise<string> {
  const id = String(args.id || "").trim();
  if (!id) throw new Error("Missing required field: id");
  const success = automationScheduler.pauseJob(id);
  return JSON.stringify({ ok: success, id, paused: true });
}

export async function handleResumeJob(args: Record<string, unknown>): Promise<string> {
  const id = String(args.id || "").trim();
  if (!id) throw new Error("Missing required field: id");
  const success = automationScheduler.resumeJob(id);
  const updated = getScheduledJob(id);
  return JSON.stringify({
    ok: success,
    id,
    resumed: true,
    nextRunAt: updated?.nextRunAt ? new Date(updated.nextRunAt).toISOString() : null,
  });
}

export async function handleWorkflowCreate(args: Record<string, unknown>, assistantId?: string): Promise<string> {
  const def = (args.definition as Record<string, unknown>) || {};
  const name = String(def.name || "").trim();
  if (!name) throw new Error("Missing definition.name");
  if (!def.trigger) throw new Error("Missing definition.trigger");
  if (!Array.isArray(def.actions)) throw new Error("Missing definition.actions array");

  const wf: Workflow = {
    id: newId(),
    name,
    description: def.description ? String(def.description) : undefined,
    authoringAssistantId: assistantId,
    enabled: true,
    trigger: def.trigger as any,
    conditions: Array.isArray(def.conditions) ? (def.conditions as any) : undefined,
    actions: def.actions as any,
    cooldownSeconds: typeof def.cooldown_seconds === "number" ? def.cooldown_seconds : 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  insertWorkflow(wf);
  return JSON.stringify({ ok: true, workflow: { id: wf.id, name: wf.name } });
}

export async function handleWorkflowList(): Promise<string> {
  const list = listWorkflows();
  return JSON.stringify({
    ok: true,
    count: list.length,
    workflows: list.map((w) => ({
      id: w.id,
      name: w.name,
      enabled: w.enabled,
      triggerType: w.trigger.type,
      actionCount: w.actions.length,
      lastFiredAt: w.lastFiredAt ? new Date(w.lastFiredAt).toISOString() : null,
    })),
  });
}

export async function handleWorkflowRun(args: Record<string, unknown>): Promise<string> {
  const id = String(args.id || "").trim();
  if (!id) throw new Error("Missing required field: id");
  const run = await workflowEngine.runWorkflow(id);
  return JSON.stringify({ ok: run.status === "success", run });
}

export async function handleWorkflowDelete(args: Record<string, unknown>): Promise<string> {
  const id = String(args.id || "").trim();
  if (!id) throw new Error("Missing required field: id");
  const success = deleteWorkflow(id);
  return JSON.stringify({ ok: success, id });
}

export function openAiAutomationTools() {
  return AUTOMATION_TOOL_SCHEMAS;
}

export function isAutomationTool(name: string): boolean {
  return (
    name === "schedule_job" ||
    name === "list_jobs" ||
    name === "delete_job" ||
    name === "pause_job" ||
    name === "resume_job" ||
    name.startsWith("workflow_")
  );
}

export async function executeAutomationTool(
  name: string,
  args: Record<string, unknown>,
  assistantId?: string,
): Promise<string> {
  switch (name) {
    case "schedule_job":
      return handleScheduleJob(args, assistantId);
    case "list_jobs":
      return handleListJobs();
    case "delete_job":
      return handleDeleteJob(args);
    case "pause_job":
      return handlePauseJob(args);
    case "resume_job":
      return handleResumeJob(args);
    case "workflow_create":
      return handleWorkflowCreate(args, assistantId);
    case "workflow_list":
      return handleWorkflowList();
    case "workflow_run":
      return handleWorkflowRun(args);
    case "workflow_delete":
      return handleWorkflowDelete(args);
    default:
      throw new Error(`Unknown automation tool: ${name}`);
  }
}
