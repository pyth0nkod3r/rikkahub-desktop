// workspace/diffs.ts — Pre-write diff capture & atomic hunk-verified undo ledger (adopted from Agent-2)

import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { getConversationsDb } from "../conversations";
import type { Workspace } from "../foundation/types";
import { id as newId } from "../foundation/utils";
import { assertInsideWorkspace } from "./boundary";
import { generateUnifiedPatch } from "./tools/edit-diff";

const MAX_STORED_SNAPSHOT_BYTES = 512 * 1024;
const ensuredDbs = new WeakSet<Database>();

export interface WorkspaceDiffRecord {
  id: string;
  workspaceId: string;
  conversationId: string | null;
  toolCallId: string | null;
  filePath: string;
  relPath: string;
  existedBefore: boolean;
  beforeContent: string | null;
  afterContent: string | null;
  unifiedDiff: string;
  reverted: boolean;
  revertedAt: number | null;
  createdAt: number;
}

interface DiffRow {
  id: string;
  workspace_id: string;
  conversation_id: string | null;
  tool_call_id: string | null;
  file_path: string;
  rel_path: string;
  existed_before: number;
  before_content: string | null;
  after_content: string | null;
  unified_diff: string;
  reverted: number;
  reverted_at: number | null;
  created_at: number;
}

function db(): Database | null {
  const handle = getConversationsDb();
  if (!handle) return null;
  if (!ensuredDbs.has(handle)) {
    handle.exec(`
      CREATE TABLE IF NOT EXISTS pc_workspace_diff (
        id              TEXT PRIMARY KEY NOT NULL,
        workspace_id    TEXT NOT NULL,
        conversation_id TEXT,
        tool_call_id    TEXT,
        file_path       TEXT NOT NULL,
        rel_path        TEXT NOT NULL,
        existed_before  INTEGER NOT NULL,
        before_content  TEXT,
        after_content   TEXT,
        unified_diff    TEXT NOT NULL DEFAULT '',
        reverted        INTEGER NOT NULL DEFAULT 0,
        reverted_at     INTEGER,
        created_at      INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pc_workspace_diff_ws
        ON pc_workspace_diff (workspace_id, created_at DESC);
    `);
    ensuredDbs.add(handle);
  }
  return handle;
}

function rowToDiff(row: DiffRow): WorkspaceDiffRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    conversationId: row.conversation_id,
    toolCallId: row.tool_call_id,
    filePath: row.file_path,
    relPath: row.rel_path,
    existedBefore: Boolean(row.existed_before),
    beforeContent: row.before_content,
    afterContent: row.after_content,
    unifiedDiff: row.unified_diff,
    reverted: Boolean(row.reverted),
    revertedAt: row.reverted_at,
    createdAt: row.created_at,
  };
}

function capContent(content: string | null): string | null {
  if (content === null) return null;
  if (Buffer.byteLength(content, "utf8") > MAX_STORED_SNAPSHOT_BYTES) return null;
  return content;
}

export function capturePreWriteSnapshot(absPath: string): { existedBefore: boolean; beforeContent: string | null } {
  try {
    if (!existsSync(absPath)) {
      return { existedBefore: false, beforeContent: null };
    }
    const content = readFileSync(absPath, "utf8");
    return { existedBefore: true, beforeContent: capContent(content) };
  } catch {
    return { existedBefore: existsSync(absPath), beforeContent: null };
  }
}

export function recordWorkspaceFileDiff(input: {
  workspaceId: string;
  workspaceRoot: string;
  conversationId?: string | null;
  toolCallId?: string | null;
  absPath: string;
  existedBefore: boolean;
  beforeContent: string | null;
  afterContent?: string | null;
  unifiedDiff?: string;
}): WorkspaceDiffRecord | null {
  const handle = db();
  if (!handle) return null;

  let actualAfter = input.afterContent ?? null;
  if (actualAfter === null) {
    try {
      actualAfter = existsSync(input.absPath) ? capContent(readFileSync(input.absPath, "utf8")) : "";
    } catch {
      actualAfter = null;
    }
  } else {
    actualAfter = capContent(actualAfter);
  }

  const relPath = relative(input.workspaceRoot, input.absPath).replace(/\\/g, "/") || input.absPath;
  const beforeForPatch = input.beforeContent ?? "";
  const afterForPatch = actualAfter ?? "";
  const unifiedDiff =
    input.unifiedDiff?.trim() ||
    (input.beforeContent !== null || actualAfter !== null
      ? generateUnifiedPatch(relPath, beforeForPatch, afterForPatch)
      : "");

  const record: WorkspaceDiffRecord = {
    id: newId(),
    workspaceId: input.workspaceId,
    conversationId: input.conversationId ?? null,
    toolCallId: input.toolCallId ?? null,
    filePath: input.absPath,
    relPath,
    existedBefore: input.existedBefore,
    beforeContent: capContent(input.beforeContent),
    afterContent: actualAfter,
    unifiedDiff,
    reverted: false,
    revertedAt: null,
    createdAt: Date.now(),
  };

  handle
    .prepare(
      `INSERT INTO pc_workspace_diff (
        id, workspace_id, conversation_id, tool_call_id, file_path, rel_path,
        existed_before, before_content, after_content, unified_diff,
        reverted, reverted_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
    )
    .run(
      record.id,
      record.workspaceId,
      record.conversationId,
      record.toolCallId,
      record.filePath,
      record.relPath,
      record.existedBefore ? 1 : 0,
      record.beforeContent,
      record.afterContent,
      record.unifiedDiff,
      record.createdAt,
    );

  return record;
}

export function listWorkspaceDiffs(workspaceId: string, limit = 50): WorkspaceDiffRecord[] {
  const handle = db();
  if (!handle) return [];
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  const rows = handle
    .prepare("SELECT * FROM pc_workspace_diff WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(workspaceId, safeLimit) as DiffRow[];
  return rows.map(rowToDiff);
}

export function getWorkspaceDiff(diffId: string): WorkspaceDiffRecord | null {
  const handle = db();
  if (!handle) return null;
  const row = handle.prepare("SELECT * FROM pc_workspace_diff WHERE id = ?").get(diffId) as DiffRow | null;
  return row ? rowToDiff(row) : null;
}

export function revertWorkspaceDiff(
  workspace: Pick<Workspace, "id" | "root">,
  diffId: string,
): { ok: true; record: WorkspaceDiffRecord } | { ok: false; error: string; status: number } {
  const handle = db();
  if (!handle) return { ok: false, error: "Diff database unavailable", status: 500 };

  const row = handle
    .prepare("SELECT * FROM pc_workspace_diff WHERE id = ? AND workspace_id = ?")
    .get(diffId, workspace.id) as DiffRow | null;
  if (!row) return { ok: false, error: "Diff record not found", status: 404 };

  const record = rowToDiff(row);
  if (record.reverted) {
    return { ok: false, error: "Diff has already been reverted", status: 409 };
  }

  let safePath: string;
  try {
    safePath = assertInsideWorkspace(record.filePath, workspace.root);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid file path", status: 400 };
  }

  // Atomic check: verify file on disk still matches the recorded post-write state
  if (record.afterContent !== null) {
    if (!existsSync(safePath)) {
      return {
        ok: false,
        error: `Cannot revert '${record.relPath}': file no longer exists on disk.`,
        status: 409,
      };
    }
    const current = readFileSync(safePath, "utf8");
    if (current !== record.afterContent) {
      return {
        ok: false,
        error: `Cannot revert '${record.relPath}': file was modified after this recorded change.`,
        status: 409,
      };
    }
  } else if (record.existedBefore) {
    return {
      ok: false,
      error: `Cannot revert '${record.relPath}': snapshot exceeded size limit and cannot be verified atomically.`,
      status: 409,
    };
  }

  if (!record.existedBefore) {
    if (existsSync(safePath)) {
      rmSync(safePath, { force: true });
    }
  } else {
    if (record.beforeContent === null) {
      return {
        ok: false,
        error: `Cannot revert '${record.relPath}': original content snapshot missing.`,
        status: 409,
      };
    }
    mkdirSync(dirname(safePath), { recursive: true });
    writeFileSync(safePath, record.beforeContent, "utf8");
  }

  const revertedAt = Date.now();
  handle
    .prepare("UPDATE pc_workspace_diff SET reverted = 1, reverted_at = ? WHERE id = ?")
    .run(revertedAt, diffId);

  return {
    ok: true,
    record: { ...record, reverted: true, revertedAt },
  };
}
