import type { Database } from "bun:sqlite";
import { getConversationsDb } from "../conversations";
import type { TelegramBotConfig } from "./types";

function getDb(): Database {
  const handle = getConversationsDb();
  if (!handle) throw new Error("conversations db not open");
  return handle;
}

export function ensureTelegramTables(db: Database = getDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pc_telegram_config (
      id TEXT PRIMARY KEY DEFAULT 'default',
      bot_token TEXT NOT NULL,
      allowed_chat_ids TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      assistant_id TEXT,
      last_offset INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);
}

export function getTelegramConfig(db: Database = getDb()): TelegramBotConfig | null {
  ensureTelegramTables(db);
  const row = db.prepare("SELECT * FROM pc_telegram_config WHERE id = 'default'").get() as Record<string, unknown> | null;
  if (!row) return null;
  return {
    id: "default",
    botToken: String(row.bot_token),
    allowedChatIds: row.allowed_chat_ids ? JSON.parse(String(row.allowed_chat_ids)) : [],
    enabled: Boolean(row.enabled),
    assistantId: row.assistant_id ? String(row.assistant_id) : undefined,
    lastOffset: typeof row.last_offset === "number" ? row.last_offset : 0,
  };
}

export function saveTelegramConfig(cfg: Partial<TelegramBotConfig>, db: Database = getDb()): void {
  ensureTelegramTables(db);
  const current = getTelegramConfig(db);
  const merged: TelegramBotConfig = {
    botToken: cfg.botToken !== undefined ? cfg.botToken : (current?.botToken || ""),
    allowedChatIds: cfg.allowedChatIds !== undefined ? cfg.allowedChatIds : (current?.allowedChatIds || []),
    enabled: cfg.enabled !== undefined ? cfg.enabled : (current?.enabled || false),
    assistantId: cfg.assistantId !== undefined ? cfg.assistantId : current?.assistantId,
    lastOffset: cfg.lastOffset !== undefined ? cfg.lastOffset : (current?.lastOffset || 0),
  };

  db.prepare(`
    INSERT INTO pc_telegram_config (id, bot_token, allowed_chat_ids, enabled, assistant_id, last_offset, updated_at)
    VALUES ('default', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      bot_token = excluded.bot_token,
      allowed_chat_ids = excluded.allowed_chat_ids,
      enabled = excluded.enabled,
      assistant_id = excluded.assistant_id,
      last_offset = excluded.last_offset,
      updated_at = excluded.updated_at
  `).run(
    merged.botToken,
    JSON.stringify(merged.allowedChatIds),
    merged.enabled ? 1 : 0,
    merged.assistantId ?? null,
    merged.lastOffset ?? 0,
    Date.now(),
  );
}
