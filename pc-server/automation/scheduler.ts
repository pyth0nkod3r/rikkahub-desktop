import { id as newId, message as createMessage, textFromParts } from "../foundation/utils";
import {
  getScheduledJob,
  insertScheduledJob,
  insertScheduledJobRun,
  listDueScheduledJobs,
  updateScheduledJob,
  updateScheduledJobRun,
} from "./db";
import { computeNextRunMs } from "./cron-parser";
import type {
  AutomationMode,
  CatchupPolicy,
  ScheduledJob,
  ScheduledJobAction,
  ScheduledJobRun,
  ScheduleType,
} from "./types";
import { executeRegisteredTool } from "../tools/execution";
import {
  persistConversation,
  getConversation,
} from "../conversations";
import { checkoutConversation, registerConversation, releaseConversation } from "../conversations/working-set";
import { generateAnswer } from "../conversations/orchestrator";
import { abortGeneration } from "../conversations/generation-state";
import type { Conversation, MessageNode } from "../foundation/types";

const CRON_DELIVERY_DIRECTIVE =
  "[Scheduled Automation Task] ALWAYS write your complete result as your reply here. Your final reply will be recorded into the execution ledger.";

export interface CreateJobInput {
  name: string;
  description?: string;
  tags?: string[];
  assistantId: string;
  mode: AutomationMode;
  scheduleType: ScheduleType;
  prompt?: string;
  actions?: ScheduledJobAction[];
  cronExpression?: string;
  atUnixMs?: number;
  intervalMs?: number;
  timezone?: string;
  startAtUnixMs?: number;
  endAtUnixMs?: number;
  maxRuns?: number;
  catchup?: CatchupPolicy;
}

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private runningJobs = new Set<string>();

  start(intervalMs = 15000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    setTimeout(() => {
      void this.tick();
    }, 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  schedule(input: CreateJobInput): ScheduledJob {
    const now = Date.now();
    const id = newId();

    let nextRunAt: number | undefined;
    if (input.scheduleType === "once") {
      if (!input.atUnixMs || input.atUnixMs <= now) {
        throw new Error("schedule_type='once' requires at_unix_ms in the future");
      }
      nextRunAt = input.atUnixMs;
    } else if (input.scheduleType === "cron") {
      if (!input.cronExpression) {
        throw new Error("schedule_type='cron' requires cron_expression");
      }
      nextRunAt = computeNextRunMs(input.cronExpression, now);
    } else if (input.scheduleType === "interval") {
      if (!input.intervalMs || input.intervalMs <= 0) {
        throw new Error("schedule_type='interval' requires positive interval_ms");
      }
      nextRunAt = now + input.intervalMs;
    }

    const job: ScheduledJob = {
      id,
      name: input.name,
      description: input.description,
      tags: input.tags,
      assistantId: input.assistantId,
      mode: input.mode,
      scheduleType: input.scheduleType,
      prompt: input.prompt,
      actions: input.actions,
      cronExpression: input.cronExpression,
      atUnixMs: input.atUnixMs,
      intervalMs: input.intervalMs,
      timezone: input.timezone,
      startAtUnixMs: input.startAtUnixMs,
      endAtUnixMs: input.endAtUnixMs,
      maxRuns: input.maxRuns,
      catchup: input.catchup || "fire_once",
      enabled: true,
      createdAt: now,
      updatedAt: now,
      nextRunAt,
      runCount: 0,
    };

    insertScheduledJob(job);
    return job;
  }

  async runJobNow(jobId: string): Promise<ScheduledJobRun | null> {
    const job = getScheduledJob(jobId);
    if (!job) return null;
    return this.executeJob(job, true);
  }

  pauseJob(jobId: string): boolean {
    const job = getScheduledJob(jobId);
    if (!job) return false;
    updateScheduledJob(jobId, { enabled: false });
    return true;
  }

  resumeJob(jobId: string): boolean {
    const job = getScheduledJob(jobId);
    if (!job) return false;

    const now = Date.now();
    let nextRunAt = job.nextRunAt;
    if (job.scheduleType === "cron" && job.cronExpression) {
      nextRunAt = computeNextRunMs(job.cronExpression, now);
    } else if (job.scheduleType === "interval" && job.intervalMs) {
      nextRunAt = now + job.intervalMs;
    }

    updateScheduledJob(jobId, { enabled: true, nextRunAt });
    return true;
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    let dueJobs: ScheduledJob[];
    try {
      dueJobs = listDueScheduledJobs(now);
    } catch {
      return;
    }

    for (const job of dueJobs) {
      if (this.runningJobs.has(job.id)) continue;
      void this.executeJob(job, false);
    }
  }

  private async executeJob(job: ScheduledJob, isManual: boolean): Promise<ScheduledJobRun> {
    this.runningJobs.add(job.id);
    const runId = newId();
    const startedAt = Date.now();

    const run: ScheduledJobRun = {
      id: runId,
      jobId: job.id,
      status: "running",
      startedAt,
    };

    insertScheduledJobRun(run);

    try {
      let output = "";
      let conversationId: string | undefined;

      if (job.mode === "direct") {
        output = await this.executeDirectMode(job.actions || []);
      } else {
        const res = await this.executeLlmMode(job);
        output = res.output;
        conversationId = res.conversationId;
      }

      run.status = "success";
      run.finishedAt = Date.now();
      run.output = output;
      run.conversationId = conversationId;

      updateScheduledJobRun(runId, {
        status: "success",
        finishedAt: run.finishedAt,
        output,
        conversationId,
      });
    } catch (err) {
      run.status = "failed";
      run.finishedAt = Date.now();
      run.error = err instanceof Error ? err.message : String(err);

      updateScheduledJobRun(runId, {
        status: "failed",
        finishedAt: run.finishedAt,
        error: run.error,
      });
    } finally {
      this.runningJobs.delete(job.id);
      this.advanceSchedule(job, isManual);
    }

    return run;
  }

  private async executeDirectMode(actions: ScheduledJobAction[]): Promise<string> {
    if (!actions.length) return "No actions to execute";
    const outputs: string[] = [];

    for (const [index, action] of actions.entries()) {
      try {
        const result = await executeRegisteredTool(action.tool, action.args);
        outputs.push(`[Action ${index + 1}: ${action.tool}] -> ${typeof result === "string" ? result : JSON.stringify(result)}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        outputs.push(`[Action ${index + 1}: ${action.tool}] FAILED -> ${errMsg}`);
        throw new Error(`Action ${index + 1} (${action.tool}) failed: ${errMsg}`);
      }
    }

    return outputs.join("\n\n");
  }

  private async executeLlmMode(job: ScheduledJob): Promise<{ output: string; conversationId: string }> {
    const convId = newId();
    const now = Date.now();

    const conv: Conversation = {
      id: convId,
      assistantId: job.assistantId,
      systemPrompt: "",
      title: `[Scheduled] ${job.name}`,
      messages: [],
      chatSuggestions: [],
      isPinned: false,
      createAt: now,
      updateAt: now,
      agentMode: "build",
    };

    const promptText = `${CRON_DELIVERY_DIRECTIVE}\n\nTask: ${job.prompt || job.name}`;
    const userMsg = createMessage("USER", [{ type: "text", text: promptText }]);
    const userNode: MessageNode = { id: newId(), messages: [userMsg], selectIndex: 0 };
    conv.messages.push(userNode);

    registerConversation(conv);
    persistConversation(conv);

    checkoutConversation(convId);
    let timer: NodeJS.Timeout | null = null;
    const timeoutMs = 10 * 60 * 1000;

    try {
      const timeoutPromise = new Promise<"timed_out">((resolve) => {
        timer = setTimeout(() => resolve("timed_out"), timeoutMs);
      });

      const genPromise = (async () => {
        await generateAnswer(conv);
        return "completed" as const;
      })();

      const outcome = await Promise.race([genPromise, timeoutPromise]);
      if (outcome === "timed_out") {
        abortGeneration(convId, "interrupted");
        throw new Error("Scheduled job LLM turn timed out after 10 minutes");
      }
    } finally {
      if (timer) clearTimeout(timer);
      releaseConversation(convId);
    }

    // Harvest final text
    const updated = getConversation(convId);
    let output = "";
    if (updated?.messages?.length) {
      const lastNode = updated.messages[updated.messages.length - 1];
      const assistantMsg = lastNode?.messages?.find((m) => m.role === "ASSISTANT");
      if (assistantMsg?.parts) {
        output = textFromParts(assistantMsg.parts);
      }
    }

    return { output: output || "Turn completed", conversationId: convId };
  }

  private advanceSchedule(job: ScheduledJob, isManual: boolean): void {
    const now = Date.now();
    const nextRunCount = (job.runCount || 0) + 1;

    if (job.scheduleType === "once") {
      updateScheduledJob(job.id, {
        enabled: false,
        nextRunAt: undefined,
        lastRunAt: now,
        runCount: nextRunCount,
      });
      return;
    }

    if (job.maxRuns && nextRunCount >= job.maxRuns) {
      updateScheduledJob(job.id, {
        enabled: false,
        nextRunAt: undefined,
        lastRunAt: now,
        runCount: nextRunCount,
      });
      return;
    }

    let nextRunAt: number | undefined;
    if (job.scheduleType === "cron" && job.cronExpression) {
      try {
        nextRunAt = computeNextRunMs(job.cronExpression, now);
      } catch {
        nextRunAt = undefined;
      }
    } else if (job.scheduleType === "interval" && job.intervalMs) {
      nextRunAt = now + job.intervalMs;
    }

    updateScheduledJob(job.id, {
      nextRunAt,
      lastRunAt: now,
      runCount: nextRunCount,
    });
  }
}

export const automationScheduler = new AutomationScheduler();
