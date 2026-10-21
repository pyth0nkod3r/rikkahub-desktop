import type { Database } from "bun:sqlite";
import { getConversationsDb } from "../conversations";

function getDb(): Database {
  const handle = getConversationsDb();
  if (!handle) throw new Error("conversations db not open");
  return handle;
}
import type {
  ScheduledJob,
  ScheduledJobRun,
  Workflow,
} from "./types";

/**
 * Initializes SQLite tables for scheduled automation jobs and workflows.
 */
export function ensureAutomationTables(db: Database = getDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pc_scheduled_job (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      tags TEXT,
      assistant_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      prompt TEXT,
      actions TEXT,
      cron_expression TEXT,
      at_unix_ms INTEGER,
      interval_ms INTEGER,
      timezone TEXT,
      start_at_unix_ms INTEGER,
      end_at_unix_ms INTEGER,
      max_runs INTEGER,
      catchup TEXT NOT NULL DEFAULT 'fire_once',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_run_at INTEGER,
      next_run_at INTEGER,
      run_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_pc_scheduled_job_next_run
      ON pc_scheduled_job (enabled, next_run_at);

    CREATE TABLE IF NOT EXISTS pc_scheduled_job_run (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      output TEXT,
      error TEXT,
      conversation_id TEXT,
      FOREIGN KEY (job_id) REFERENCES pc_scheduled_job(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pc_scheduled_job_run_job_id
      ON pc_scheduled_job_run (job_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS pc_workflow (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      authoring_assistant_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      trigger_def TEXT NOT NULL,
      conditions_def TEXT,
      actions_def TEXT NOT NULL,
      cooldown_seconds INTEGER NOT NULL DEFAULT 0,
      max_runs_per_day INTEGER,
      last_fired_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pc_workflow_run (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      results TEXT,
      FOREIGN KEY (workflow_id) REFERENCES pc_workflow(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pc_workflow_run_wf_id
      ON pc_workflow_run (workflow_id, started_at DESC);
  `);
}

// ----------------- Scheduled Jobs CRUD -----------------

export function insertScheduledJob(job: ScheduledJob, db: Database = getDb()): void {
  ensureAutomationTables(db);
  const stmt = db.prepare(`
    INSERT INTO pc_scheduled_job (
      id, name, description, tags, assistant_id, mode, schedule_type,
      prompt, actions, cron_expression, at_unix_ms, interval_ms, timezone,
      start_at_unix_ms, end_at_unix_ms, max_runs, catchup, enabled,
      created_at, updated_at, last_run_at, next_run_at, run_count
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    job.id,
    job.name,
    job.description ?? null,
    job.tags?.length ? JSON.stringify(job.tags) : null,
    job.assistantId,
    job.mode,
    job.scheduleType,
    job.prompt ?? null,
    job.actions?.length ? JSON.stringify(job.actions) : null,
    job.cronExpression ?? null,
    job.atUnixMs ?? null,
    job.intervalMs ?? null,
    job.timezone ?? null,
    job.startAtUnixMs ?? null,
    job.endAtUnixMs ?? null,
    job.maxRuns ?? null,
    job.catchup || "fire_once",
    job.enabled ? 1 : 0,
    job.createdAt,
    job.updatedAt,
    job.lastRunAt ?? null,
    job.nextRunAt ?? null,
    job.runCount || 0,
  );
}

export function updateScheduledJob(
  id: string,
  updates: Partial<ScheduledJob>,
  db: Database = getDb(),
): void {
  ensureAutomationTables(db);
  const current = getScheduledJob(id, db);
  if (!current) return;

  const merged: ScheduledJob = {
    ...current,
    ...updates,
    updatedAt: Date.now(),
  };

  const stmt = db.prepare(`
    UPDATE pc_scheduled_job SET
      name = ?, description = ?, tags = ?, assistant_id = ?, mode = ?, schedule_type = ?,
      prompt = ?, actions = ?, cron_expression = ?, at_unix_ms = ?, interval_ms = ?, timezone = ?,
      start_at_unix_ms = ?, end_at_unix_ms = ?, max_runs = ?, catchup = ?, enabled = ?,
      updated_at = ?, last_run_at = ?, next_run_at = ?, run_count = ?
    WHERE id = ?
  `);

  stmt.run(
    merged.name,
    merged.description ?? null,
    merged.tags?.length ? JSON.stringify(merged.tags) : null,
    merged.assistantId,
    merged.mode,
    merged.scheduleType,
    merged.prompt ?? null,
    merged.actions?.length ? JSON.stringify(merged.actions) : null,
    merged.cronExpression ?? null,
    merged.atUnixMs ?? null,
    merged.intervalMs ?? null,
    merged.timezone ?? null,
    merged.startAtUnixMs ?? null,
    merged.endAtUnixMs ?? null,
    merged.maxRuns ?? null,
    merged.catchup || "fire_once",
    merged.enabled ? 1 : 0,
    merged.updatedAt,
    merged.lastRunAt ?? null,
    merged.nextRunAt ?? null,
    merged.runCount || 0,
    id,
  );
}

export function deleteScheduledJob(id: string, db: Database = getDb()): boolean {
  ensureAutomationTables(db);
  const res = db.prepare("DELETE FROM pc_scheduled_job WHERE id = ?").run(id);
  return res.changes > 0;
}

function rowToScheduledJob(row: Record<string, unknown>): ScheduledJob {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    tags: row.tags ? JSON.parse(String(row.tags)) : undefined,
    assistantId: String(row.assistant_id),
    mode: row.mode as "llm" | "direct",
    scheduleType: row.schedule_type as "once" | "cron" | "interval",
    prompt: row.prompt ? String(row.prompt) : undefined,
    actions: row.actions ? JSON.parse(String(row.actions)) : undefined,
    cronExpression: row.cron_expression ? String(row.cron_expression) : undefined,
    atUnixMs: typeof row.at_unix_ms === "number" ? row.at_unix_ms : undefined,
    intervalMs: typeof row.interval_ms === "number" ? row.interval_ms : undefined,
    timezone: row.timezone ? String(row.timezone) : undefined,
    startAtUnixMs: typeof row.start_at_unix_ms === "number" ? row.start_at_unix_ms : undefined,
    endAtUnixMs: typeof row.end_at_unix_ms === "number" ? row.end_at_unix_ms : undefined,
    maxRuns: typeof row.max_runs === "number" ? row.max_runs : undefined,
    catchup: (row.catchup as "skip" | "fire_once" | "fire_all") || "fire_once",
    enabled: Boolean(row.enabled),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastRunAt: typeof row.last_run_at === "number" ? row.last_run_at : undefined,
    nextRunAt: typeof row.next_run_at === "number" ? row.next_run_at : undefined,
    runCount: Number(row.run_count || 0),
  };
}

export function getScheduledJob(id: string, db: Database = getDb()): ScheduledJob | null {
  ensureAutomationTables(db);
  const row = db.prepare("SELECT * FROM pc_scheduled_job WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToScheduledJob(row) : null;
}

export function listScheduledJobs(db: Database = getDb()): ScheduledJob[] {
  ensureAutomationTables(db);
  const rows = db.prepare("SELECT * FROM pc_scheduled_job ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map(rowToScheduledJob);
}

export function listDueScheduledJobs(nowMs: number = Date.now(), db: Database = getDb()): ScheduledJob[] {
  ensureAutomationTables(db);
  const rows = db.prepare(`
    SELECT * FROM pc_scheduled_job
    WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
    ORDER BY next_run_at ASC
  `).all(nowMs) as Record<string, unknown>[];
  return rows.map(rowToScheduledJob);
}

// ----------------- Scheduled Job Runs -----------------

export function insertScheduledJobRun(run: ScheduledJobRun, db: Database = getDb()): void {
  ensureAutomationTables(db);
  db.prepare(`
    INSERT INTO pc_scheduled_job_run (
      id, job_id, status, started_at, finished_at, output, error, conversation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    run.id,
    run.jobId,
    run.status,
    run.startedAt,
    run.finishedAt ?? null,
    run.output ?? null,
    run.error ?? null,
    run.conversationId ?? null,
  );
}

export function updateScheduledJobRun(
  id: string,
  updates: Partial<ScheduledJobRun>,
  db: Database = getDb(),
): void {
  ensureAutomationTables(db);
  const sets: string[] = [];
  const args: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push("status = ?");
    args.push(updates.status);
  }
  if (updates.finishedAt !== undefined) {
    sets.push("finished_at = ?");
    args.push(updates.finishedAt);
  }
  if (updates.output !== undefined) {
    sets.push("output = ?");
    args.push(updates.output);
  }
  if (updates.error !== undefined) {
    sets.push("error = ?");
    args.push(updates.error);
  }
  if (updates.conversationId !== undefined) {
    sets.push("conversation_id = ?");
    args.push(updates.conversationId);
  }

  if (sets.length === 0) return;
  args.push(id);
  db.prepare(`UPDATE pc_scheduled_job_run SET ${sets.join(", ")} WHERE id = ?`).run(...(args as [any]));
}

export function listScheduledJobRuns(jobId?: string, limit: number = 50, db: Database = getDb()): ScheduledJobRun[] {
  ensureAutomationTables(db);
  let rows: Record<string, unknown>[];
  if (jobId) {
    rows = db.prepare("SELECT * FROM pc_scheduled_job_run WHERE job_id = ? ORDER BY started_at DESC LIMIT ?").all(jobId, limit) as Record<string, unknown>[];
  } else {
    rows = db.prepare("SELECT * FROM pc_scheduled_job_run ORDER BY started_at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
  }

  return rows.map((r) => ({
    id: String(r.id),
    jobId: String(r.job_id),
    status: r.status as ScheduledJobRun["status"],
    startedAt: Number(r.started_at),
    finishedAt: typeof r.finished_at === "number" ? r.finished_at : undefined,
    output: r.output ? String(r.output) : undefined,
    error: r.error ? String(r.error) : undefined,
    conversationId: r.conversation_id ? String(r.conversation_id) : undefined,
  }));
}

// ----------------- Workflows CRUD -----------------

export function insertWorkflow(wf: Workflow, db: Database = getDb()): void {
  ensureAutomationTables(db);
  db.prepare(`
    INSERT INTO pc_workflow (
      id, name, description, authoring_assistant_id, enabled,
      trigger_def, conditions_def, actions_def, cooldown_seconds,
      max_runs_per_day, last_fired_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    wf.id,
    wf.name,
    wf.description ?? null,
    wf.authoringAssistantId ?? null,
    wf.enabled ? 1 : 0,
    JSON.stringify(wf.trigger),
    wf.conditions?.length ? JSON.stringify(wf.conditions) : null,
    JSON.stringify(wf.actions),
    wf.cooldownSeconds || 0,
    wf.maxRunsPerDay ?? null,
    wf.lastFiredAt ?? null,
    wf.createdAt,
    wf.updatedAt,
  );
}

function rowToWorkflow(row: Record<string, unknown>): Workflow {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    authoringAssistantId: row.authoring_assistant_id ? String(row.authoring_assistant_id) : undefined,
    enabled: Boolean(row.enabled),
    trigger: JSON.parse(String(row.trigger_def)),
    conditions: row.conditions_def ? JSON.parse(String(row.conditions_def)) : undefined,
    actions: JSON.parse(String(row.actions_def)),
    cooldownSeconds: Number(row.cooldown_seconds || 0),
    maxRunsPerDay: typeof row.max_runs_per_day === "number" ? row.max_runs_per_day : undefined,
    lastFiredAt: typeof row.last_fired_at === "number" ? row.last_fired_at : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function getWorkflow(id: string, db: Database = getDb()): Workflow | null {
  ensureAutomationTables(db);
  const row = db.prepare("SELECT * FROM pc_workflow WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToWorkflow(row) : null;
}

export function listWorkflows(db: Database = getDb()): Workflow[] {
  ensureAutomationTables(db);
  const rows = db.prepare("SELECT * FROM pc_workflow ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map(rowToWorkflow);
}

export function deleteWorkflow(id: string, db: Database = getDb()): boolean {
  ensureAutomationTables(db);
  const res = db.prepare("DELETE FROM pc_workflow WHERE id = ?").run(id);
  return res.changes > 0;
}

export function updateWorkflowLastFired(id: string, firedAt: number = Date.now(), db: Database = getDb()): void {
  ensureAutomationTables(db);
  db.prepare("UPDATE pc_workflow SET last_fired_at = ?, updated_at = ? WHERE id = ?").run(firedAt, firedAt, id);
}
