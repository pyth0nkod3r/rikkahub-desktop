// subagents/db.ts — SQLite persistence for SubAgent Profiles and Runs
// Ported from rikkahub-agent (Pyth0nkod3r fork)

import type { Database } from "bun:sqlite";
import { getConversationsDb } from "../conversations";
import type { SubAgentProfile, SubAgentRun, SubAgentStatus } from "./types";

const ensuredDbs = new WeakSet<Database>();

function db(): Database | null {
  const handle = getConversationsDb();
  if (!handle) return null;
  if (!ensuredDbs.has(handle)) {
    handle.exec(`
      CREATE TABLE IF NOT EXISTS pc_subagent_profile (
        id            TEXT PRIMARY KEY NOT NULL,
        name          TEXT NOT NULL,
        description   TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        model_id      TEXT,
        enabled       INTEGER NOT NULL DEFAULT 1,
        tools         TEXT NOT NULL DEFAULT '[]',
        capabilities  TEXT NOT NULL DEFAULT '[]',
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pc_subagent_run (
        id                     TEXT PRIMARY KEY NOT NULL,
        parent_conversation_id TEXT,
        parent_assistant_id    TEXT NOT NULL,
        sub_conversation_id    TEXT,
        label                  TEXT NOT NULL,
        task                   TEXT NOT NULL,
        model_id               TEXT,
        agent_name             TEXT,
        tools                  TEXT,
        capabilities           TEXT,
        run_in_background      INTEGER NOT NULL DEFAULT 0,
        no_result              INTEGER NOT NULL DEFAULT 0,
        timeout_seconds        INTEGER NOT NULL DEFAULT 300,
        max_trips              INTEGER NOT NULL DEFAULT 12,
        status                 TEXT NOT NULL DEFAULT 'pending',
        result                 TEXT,
        error                  TEXT,
        started_at_ms          INTEGER NOT NULL,
        finished_at_ms         INTEGER,
        tokens_in              INTEGER NOT NULL DEFAULT 0,
        tokens_out             INTEGER NOT NULL DEFAULT 0,
        trip_count             INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_pc_subagent_run_parent
        ON pc_subagent_run (parent_conversation_id, started_at_ms DESC);

      CREATE INDEX IF NOT EXISTS idx_pc_subagent_run_status
        ON pc_subagent_run (status, started_at_ms DESC);
    `);
    ensuredDbs.add(handle);
  }
  return handle;
}

interface ProfileRow {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  model_id: string | null;
  enabled: number;
  tools: string;
  capabilities: string;
  created_at: number;
  updated_at: number;
}

interface RunRow {
  id: string;
  parent_conversation_id: string | null;
  parent_assistant_id: string;
  sub_conversation_id: string | null;
  label: string;
  task: string;
  model_id: string | null;
  agent_name: string | null;
  tools: string | null;
  capabilities: string | null;
  run_in_background: number;
  no_result: number;
  timeout_seconds: number;
  max_trips: number;
  status: string;
  result: string | null;
  error: string | null;
  started_at_ms: number;
  finished_at_ms: number | null;
  tokens_in: number;
  tokens_out: number;
  trip_count: number;
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowToProfile(row: ProfileRow): SubAgentProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    modelId: row.model_id,
    enabled: Boolean(row.enabled),
    tools: parseJsonArray(row.tools),
    capabilities: parseJsonArray(row.capabilities),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: RunRow): SubAgentRun {
  return {
    id: row.id,
    parentChatId: row.parent_conversation_id,
    parentAssistantId: row.parent_assistant_id,
    subConversationId: row.sub_conversation_id,
    label: row.label,
    task: row.task,
    modelId: row.model_id,
    agentName: row.agent_name,
    tools: row.tools ? parseJsonArray(row.tools) : null,
    capabilities: row.capabilities ? parseJsonArray(row.capabilities) : null,
    runInBackground: Boolean(row.run_in_background),
    noResult: Boolean(row.no_result),
    timeoutSeconds: row.timeout_seconds,
    maxTrips: row.max_trips,
    status: row.status as SubAgentStatus,
    result: row.result,
    error: row.error,
    startedAtMs: row.started_at_ms,
    finishedAtMs: row.finished_at_ms,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    tripCount: row.trip_count,
  };
}

// ---------------- Profile CRUD ----------------

export function listSubAgentProfiles(): SubAgentProfile[] {
  const handle = db();
  if (!handle) return [];
  const rows = handle
    .prepare("SELECT * FROM pc_subagent_profile ORDER BY name COLLATE NOCASE ASC")
    .all() as ProfileRow[];
  return rows.map(rowToProfile);
}

export function getSubAgentProfile(id: string): SubAgentProfile | null {
  const handle = db();
  if (!handle) return null;
  const row = handle
    .prepare("SELECT * FROM pc_subagent_profile WHERE id = ?")
    .get(id) as ProfileRow | null;
  return row ? rowToProfile(row) : null;
}

export function upsertSubAgentProfile(profile: SubAgentProfile): void {
  const handle = db();
  if (!handle) return;
  handle
    .prepare(
      `INSERT INTO pc_subagent_profile (
        id, name, description, system_prompt, model_id, enabled, tools, capabilities, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        system_prompt = excluded.system_prompt,
        model_id = excluded.model_id,
        enabled = excluded.enabled,
        tools = excluded.tools,
        capabilities = excluded.capabilities,
        updated_at = excluded.updated_at`,
    )
    .run(
      profile.id,
      profile.name,
      profile.description ?? "",
      profile.systemPrompt ?? "",
      profile.modelId ?? null,
      profile.enabled ? 1 : 0,
      JSON.stringify(profile.tools ?? []),
      JSON.stringify(profile.capabilities ?? []),
      profile.createdAt,
      profile.updatedAt,
    );
}

export function deleteSubAgentProfile(id: string): boolean {
  const handle = db();
  if (!handle) return false;
  const result = handle.prepare("DELETE FROM pc_subagent_profile WHERE id = ?").run(id);
  return result.changes > 0;
}

// ---------------- Run CRUD ----------------

export function insertSubAgentRun(run: SubAgentRun): void {
  const handle = db();
  if (!handle) return;
  handle
    .prepare(
      `INSERT INTO pc_subagent_run (
        id, parent_conversation_id, parent_assistant_id, sub_conversation_id,
        label, task, model_id, agent_name, tools, capabilities,
        run_in_background, no_result, timeout_seconds, max_trips,
        status, result, error, started_at_ms, finished_at_ms,
        tokens_in, tokens_out, trip_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.parentChatId,
      run.parentAssistantId,
      run.subConversationId,
      run.label,
      run.task,
      run.modelId,
      run.agentName,
      run.tools ? JSON.stringify(run.tools) : null,
      run.capabilities ? JSON.stringify(run.capabilities) : null,
      run.runInBackground ? 1 : 0,
      run.noResult ? 1 : 0,
      run.timeoutSeconds,
      run.maxTrips,
      run.status,
      run.result,
      run.error,
      run.startedAtMs,
      run.finishedAtMs,
      run.tokensIn,
      run.tokensOut,
      run.tripCount,
    );
}

export function updateSubAgentRun(run: SubAgentRun): void {
  const handle = db();
  if (!handle) return;
  handle
    .prepare(
      `UPDATE pc_subagent_run SET
        sub_conversation_id = ?,
        status = ?,
        result = ?,
        error = ?,
        finished_at_ms = ?,
        tokens_in = ?,
        tokens_out = ?,
        trip_count = ?
      WHERE id = ?`,
    )
    .run(
      run.subConversationId,
      run.status,
      run.result,
      run.error,
      run.finishedAtMs,
      run.tokensIn,
      run.tokensOut,
      run.tripCount,
      run.id,
    );
}

export function getSubAgentRun(id: string): SubAgentRun | null {
  const handle = db();
  if (!handle) return null;
  const row = handle.prepare("SELECT * FROM pc_subagent_run WHERE id = ?").get(id) as RunRow | null;
  return row ? rowToRun(row) : null;
}

export function listSubAgentRuns(opts?: {
  activeOnly?: boolean;
  parentConversationId?: string;
  limit?: number;
}): SubAgentRun[] {
  const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
  let sql = "SELECT * FROM pc_subagent_run WHERE 1=1";
  const params: (string | number)[] = [];

  if (opts?.activeOnly) {
    sql += " AND status IN ('pending', 'running')";
  }
  if (opts?.parentConversationId) {
    sql += " AND parent_conversation_id = ?";
    params.push(opts.parentConversationId);
  }
  sql += " ORDER BY started_at_ms DESC LIMIT ?";
  params.push(limit);

  const handle = db();
  if (!handle) return [];
  const rows = handle.prepare(sql).all(...params) as RunRow[];
  return rows.map(rowToRun);
}
