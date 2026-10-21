import { json, error, readJson } from "../request";
import {
  deleteScheduledJob,
  deleteWorkflow,
  getScheduledJob,
  insertWorkflow,
  listScheduledJobRuns,
  listScheduledJobs,
  listWorkflows,
} from "../../automation/db";
import { automationScheduler } from "../../automation/scheduler";
import { workflowEngine } from "../../automation/workflow-engine";
import { id as newId } from "../../foundation/utils";
import type { Workflow } from "../../automation/types";

export async function handleAutomationRoutes(
  request: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  const method = request.method;

  // GET /api/automation/jobs
  if (method === "GET" && path === "automation/jobs") {
    const jobs = listScheduledJobs();
    return json({ jobs });
  }

  // POST /api/automation/jobs
  if (method === "POST" && path === "automation/jobs") {
    const body = (await readJson<Record<string, any>>(request)) ?? {};
    try {
      const job = automationScheduler.schedule({
        name: String(body.name || "").trim(),
        description: body.description ? String(body.description) : undefined,
        assistantId: String(body.assistantId || "default"),
        mode: body.mode || "llm",
        scheduleType: body.scheduleType || "cron",
        prompt: body.prompt ? String(body.prompt) : undefined,
        actions: Array.isArray(body.actions) ? body.actions : undefined,
        cronExpression: body.cronExpression ? String(body.cronExpression) : undefined,
        atUnixMs: typeof body.atUnixMs === "number" ? body.atUnixMs : undefined,
        intervalMs: typeof body.intervalMs === "number" ? body.intervalMs : undefined,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
      });
      return json({ job });
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // POST /api/automation/jobs/:id/run
  const runMatch = path.match(/^automation\/jobs\/([^/]+)\/run$/);
  if (method === "POST" && runMatch) {
    const jobId = runMatch[1];
    const run = await automationScheduler.runJobNow(jobId);
    if (!run) return error("Job not found", 404);
    return json({ run });
  }

  // POST /api/automation/jobs/:id/pause
  const pauseMatch = path.match(/^automation\/jobs\/([^/]+)\/pause$/);
  if (method === "POST" && pauseMatch) {
    const jobId = pauseMatch[1];
    const ok = automationScheduler.pauseJob(jobId);
    return json({ ok, id: jobId });
  }

  // POST /api/automation/jobs/:id/resume
  const resumeMatch = path.match(/^automation\/jobs\/([^/]+)\/resume$/);
  if (method === "POST" && resumeMatch) {
    const jobId = resumeMatch[1];
    const ok = automationScheduler.resumeJob(jobId);
    const job = getScheduledJob(jobId);
    return json({ ok, job });
  }

  // DELETE /api/automation/jobs/:id
  const deleteMatch = path.match(/^automation\/jobs\/([^/]+)$/);
  if (method === "DELETE" && deleteMatch) {
    const jobId = deleteMatch[1];
    const ok = deleteScheduledJob(jobId);
    return json({ ok, id: jobId });
  }

  // GET /api/automation/runs
  if (method === "GET" && path === "automation/runs") {
    const jobId = url.searchParams.get("jobId") || undefined;
    const runs = listScheduledJobRuns(jobId, 100);
    return json({ runs });
  }

  // GET /api/automation/workflows
  if (method === "GET" && path === "automation/workflows") {
    const workflows = listWorkflows();
    return json({ workflows });
  }

  // POST /api/automation/workflows
  if (method === "POST" && path === "automation/workflows") {
    const body = (await readJson<Record<string, any>>(request)) ?? {};
    const name = String(body.name || "").trim();
    if (!name) return error("name is required", 400);
    if (!body.trigger) return error("trigger is required", 400);
    if (!Array.isArray(body.actions)) return error("actions must be an array", 400);

    const wf: Workflow = {
      id: newId(),
      name,
      description: body.description ? String(body.description) : undefined,
      authoringAssistantId: body.authoringAssistantId ? String(body.authoringAssistantId) : undefined,
      enabled: body.enabled !== false,
      trigger: body.trigger,
      conditions: Array.isArray(body.conditions) ? body.conditions : undefined,
      actions: body.actions,
      cooldownSeconds: typeof body.cooldownSeconds === "number" ? body.cooldownSeconds : 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    insertWorkflow(wf);
    return json({ workflow: wf });
  }

  // POST /api/automation/workflows/:id/run
  const wfRunMatch = path.match(/^automation\/workflows\/([^/]+)\/run$/);
  if (method === "POST" && wfRunMatch) {
    const wfId = wfRunMatch[1];
    try {
      const run = await workflowEngine.runWorkflow(wfId);
      return json({ run });
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err), 400);
    }
  }

  // DELETE /api/automation/workflows/:id
  const wfDelMatch = path.match(/^automation\/workflows\/([^/]+)$/);
  if (method === "DELETE" && wfDelMatch) {
    const wfId = wfDelMatch[1];
    const ok = deleteWorkflow(wfId);
    return json({ ok, id: wfId });
  }

  return null;
}
