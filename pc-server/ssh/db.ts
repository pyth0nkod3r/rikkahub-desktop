import type { Database } from "bun:sqlite";
import { getConversationsDb } from "../conversations";
import type { SshHost } from "./types";

function getDb(): Database {
  const handle = getConversationsDb();
  if (!handle) throw new Error("conversations db not open");
  return handle;
}

export function ensureSshTables(db: Database = getDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pc_ssh_host (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      user TEXT NOT NULL,
      key_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pc_ssh_host_label ON pc_ssh_host (label);
  `);
}

export function insertSshHost(h: SshHost, db: Database = getDb()): void {
  ensureSshTables(db);
  db.prepare(`
    INSERT INTO pc_ssh_host (id, label, host, port, user, key_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(label) DO UPDATE SET
      host = excluded.host,
      port = excluded.port,
      user = excluded.user,
      key_path = excluded.key_path,
      updated_at = excluded.updated_at
  `).run(
    h.id,
    h.label,
    h.host,
    h.port || 22,
    h.user,
    h.keyPath ?? null,
    h.createdAt,
    h.updatedAt,
  );
}

export function getSshHostByLabel(label: string, db: Database = getDb()): SshHost | null {
  ensureSshTables(db);
  const row = db.prepare("SELECT * FROM pc_ssh_host WHERE label = ?").get(label) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    id: String(row.id),
    label: String(row.label),
    host: String(row.host),
    port: Number(row.port || 22),
    user: String(row.user),
    keyPath: row.key_path ? String(row.key_path) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function listSshHosts(db: Database = getDb()): SshHost[] {
  ensureSshTables(db);
  const rows = db.prepare("SELECT * FROM pc_ssh_host ORDER BY label ASC").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    label: String(r.label),
    host: String(r.host),
    port: Number(r.port || 22),
    user: String(r.user),
    keyPath: r.key_path ? String(r.key_path) : undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));
}

export function deleteSshHost(label: string, db: Database = getDb()): boolean {
  ensureSshTables(db);
  const res = db.prepare("DELETE FROM pc_ssh_host WHERE label = ?").run(label);
  return res.changes > 0;
}
