import { json, error, readJson } from "../request";
import {
  deleteSshHost,
  getSshHostByLabel,
  insertSshHost,
  listSshHosts,
} from "../../ssh/db";
import { sshExec } from "../../ssh/client";
import { id as newId } from "../../foundation/utils";
import { getTelegramConfig, saveTelegramConfig } from "../../telegram/db";
import { telegramBotService } from "../../telegram/bot-service";
import type { SshHost } from "../../ssh/types";

export async function handleRemoteRoutes(
  request: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  const method = request.method;

  // GET /api/ssh/hosts
  if (method === "GET" && path === "ssh/hosts") {
    const hosts = listSshHosts();
    return json({ hosts });
  }

  // POST /api/ssh/hosts
  if (method === "POST" && path === "ssh/hosts") {
    const body = (await readJson<Record<string, any>>(request)) ?? {};
    const label = String(body.label || "").trim();
    const host = String(body.host || "").trim();
    const user = String(body.user || "").trim();
    if (!label || !host || !user) {
      return error("label, host, and user are required", 400);
    }

    const now = Date.now();
    const sshHost: SshHost = {
      id: body.id ? String(body.id) : newId(),
      label,
      host,
      port: typeof body.port === "number" ? body.port : 22,
      user,
      keyPath: body.keyPath ? String(body.keyPath) : undefined,
      createdAt: now,
      updatedAt: now,
    };

    insertSshHost(sshHost);
    return json({ host: sshHost });
  }

  // DELETE /api/ssh/hosts/:label
  const delHostMatch = path.match(/^ssh\/hosts\/([^/]+)$/);
  if (method === "DELETE" && delHostMatch) {
    const label = decodeURIComponent(delHostMatch[1]);
    const ok = deleteSshHost(label);
    if (!ok) return error(`Host '${label}' not found`, 404);
    return json({ ok: true, label });
  }

  // POST /api/ssh/test
  if (method === "POST" && path === "ssh/test") {
    const body = (await readJson<Record<string, any>>(request)) ?? {};
    let host = String(body.host || "").trim();
    let port = typeof body.port === "number" ? body.port : 22;
    let user = String(body.user || "").trim();
    let keyPath = body.keyPath ? String(body.keyPath) : undefined;

    if (body.label) {
      const saved = getSshHostByLabel(String(body.label));
      if (!saved) return error(`Saved host '${body.label}' not found`, 404);
      host = saved.host;
      port = saved.port;
      user = saved.user;
      keyPath = saved.keyPath;
    }

    if (!host || !user) return error("host and user are required", 400);

    try {
      const res = await sshExec({
        host,
        port,
        user,
        command: "echo rikkahub_ssh_ok",
        keyPath,
        timeoutSeconds: 10,
      });
      return json({ ok: res.exitCode === 0, ...res });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ ok: false, error: msg }, { status: 400 });
    }
  }

  // GET /api/telegram/config
  if (method === "GET" && path === "telegram/config") {
    const config = getTelegramConfig() || {
      id: "default",
      botToken: "",
      allowedChatIds: [],
      enabled: false,
      lastOffset: 0,
    };
    return json({
      config,
      running: telegramBotService.isRunningStatus(),
    });
  }

  // POST /api/telegram/config
  if (method === "POST" && path === "telegram/config") {
    const body = (await readJson<Record<string, any>>(request)) ?? {};
    saveTelegramConfig({
      botToken: body.botToken !== undefined ? String(body.botToken).trim() : undefined,
      allowedChatIds: Array.isArray(body.allowedChatIds) ? body.allowedChatIds.map(String) : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      assistantId: body.assistantId ? String(body.assistantId) : undefined,
    });

    const updated = getTelegramConfig();
    // If enabled toggled, update service state accordingly
    if (updated?.enabled && !telegramBotService.isRunningStatus()) {
      void telegramBotService.start();
    } else if (!updated?.enabled && telegramBotService.isRunningStatus()) {
      telegramBotService.stop();
    }

    return json({
      config: updated,
      running: telegramBotService.isRunningStatus(),
    });
  }

  // POST /api/telegram/start
  if (method === "POST" && path === "telegram/start") {
    const res = await telegramBotService.start();
    return json(res);
  }

  // POST /api/telegram/stop
  if (method === "POST" && path === "telegram/stop") {
    const res = telegramBotService.stop();
    return json(res);
  }

  // GET /api/telegram/status
  if (method === "GET" && path === "telegram/status") {
    return json({ running: telegramBotService.isRunningStatus() });
  }

  return null;
}
