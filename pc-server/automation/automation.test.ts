import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { computeNextRunMs, parseCronExpression } from "./cron-parser";
import {
  deleteScheduledJob,
  deleteWorkflow,
  ensureAutomationTables,
  getScheduledJob,
  getWorkflow,
  insertScheduledJob,
  insertScheduledJobRun,
  insertWorkflow,
  listDueScheduledJobs,
  listScheduledJobRuns,
  listWorkflows,
  updateScheduledJob,
  updateScheduledJobRun,
} from "./db";
import type { ScheduledJob, Workflow } from "./types";

describe("Cron Parser", () => {
  it("parses 5-field standard cron expressions", () => {
    const cron = parseCronExpression("0 9 * * 1-5");
    expect(cron.isInterval).toBe(false);
    expect(cron.minutes?.has(0)).toBe(true);
    expect(cron.minutes?.has(1)).toBe(false);
    expect(cron.hours?.has(9)).toBe(true);
    expect(cron.daysOfWeek?.has(1)).toBe(true);
    expect(cron.daysOfWeek?.has(5)).toBe(true);
    expect(cron.daysOfWeek?.has(6)).toBe(false);
  });

  it("parses step values", () => {
    const cron = parseCronExpression("*/15 * * * *");
    expect(cron.minutes?.has(0)).toBe(true);
    expect(cron.minutes?.has(15)).toBe(true);
    expect(cron.minutes?.has(30)).toBe(true);
    expect(cron.minutes?.has(45)).toBe(true);
    expect(cron.minutes?.has(10)).toBe(false);
  });

  it("parses aliases like @daily and @hourly", () => {
    const daily = parseCronExpression("@daily");
    expect(daily.minutes?.has(0)).toBe(true);
    expect(daily.hours?.has(0)).toBe(true);

    const hourly = parseCronExpression("@hourly");
    expect(hourly.minutes?.has(0)).toBe(true);
    expect(hourly.hours?.size).toBe(24);
  });

  it("parses @every duration format", () => {
    const every30m = parseCronExpression("@every 30m");
    expect(every30m.isInterval).toBe(true);
    expect(every30m.intervalMs).toBe(30 * 60 * 1000);

    const every2h = parseCronExpression("@every 2h");
    expect(every2h.isInterval).toBe(true);
    expect(every2h.intervalMs).toBe(2 * 3600 * 1000);
  });

  it("computes next run timestamp in the future", () => {
    const now = new Date("2026-10-21T10:00:00Z").getTime();
    const nextRun = computeNextRunMs("0 11 * * *", now);
    const nextDate = new Date(nextRun);
    expect(nextDate.getHours()).toBe(11);
    expect(nextDate.getMinutes()).toBe(0);
    expect(nextRun).toBeGreaterThan(now);
  });

  it("throws on invalid cron expressions", () => {
    expect(() => parseCronExpression("invalid")).toThrow();
    expect(() => parseCronExpression("0 0 0 0")).toThrow();
  });
});

describe("Automation DB & Operations", () => {
  const db = new Database(":memory:");
  ensureAutomationTables(db);

  it("inserts and queries scheduled jobs", () => {
    const job: ScheduledJob = {
      id: "job-1",
      name: "Daily Backup",
      assistantId: "assistant-1",
      mode: "direct",
      scheduleType: "cron",
      cronExpression: "0 0 * * *",
      actions: [{ tool: "get_time_info", args: {} }],
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
      nextRunAt: 2000,
      runCount: 0,
    };

    insertScheduledJob(job, db);
    const fetched = getScheduledJob("job-1", db);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("Daily Backup");
    expect(fetched?.actions?.length).toBe(1);
    expect(fetched?.actions?.[0]?.tool).toBe("get_time_info");

    const due = listDueScheduledJobs(3000, db);
    expect(due.some((j) => j.id === "job-1")).toBe(true);

    updateScheduledJob("job-1", { runCount: 1, lastRunAt: 2000 }, db);
    const updated = getScheduledJob("job-1", db);
    expect(updated?.runCount).toBe(1);
    expect(updated?.lastRunAt).toBe(2000);

    deleteScheduledJob("job-1", db);
    expect(getScheduledJob("job-1", db)).toBeNull();
  });

  it("records and updates job runs", () => {
    insertScheduledJobRun(
      {
        id: "run-1",
        jobId: "job-1",
        status: "running",
        startedAt: 1000,
      },
      db,
    );

    let runs = listScheduledJobRuns("job-1", 10, db);
    expect(runs.length).toBe(1);
    expect(runs[0]?.status).toBe("running");

    updateScheduledJobRun("run-1", { status: "success", finishedAt: 1500, output: "done" }, db);
    runs = listScheduledJobRuns("job-1", 10, db);
    expect(runs[0]?.status).toBe("success");
    expect(runs[0]?.output).toBe("done");
  });

  it("manages workflow entities", () => {
    const wf: Workflow = {
      id: "wf-1",
      name: "On WiFi",
      enabled: true,
      trigger: { type: "manual" },
      actions: [{ tool: "get_time_info", args: {} }],
      cooldownSeconds: 60,
      createdAt: 1000,
      updatedAt: 1000,
    };

    insertWorkflow(wf, db);
    const fetched = getWorkflow("wf-1", db);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("On WiFi");
    expect(fetched?.actions.length).toBe(1);

    const all = listWorkflows(db);
    expect(all.some((w) => w.id === "wf-1")).toBe(true);

    deleteWorkflow("wf-1", db);
    expect(getWorkflow("wf-1", db)).toBeNull();
  });
});
