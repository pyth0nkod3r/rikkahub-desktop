import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
  ensureTelegramTables,
  getTelegramConfig,
  saveTelegramConfig,
} from "./db";
import { telegramBotService } from "./bot-service";
import {
  isTelegramTool,
  openAiTelegramTools,
} from "../tools/telegram-tools";

describe("Telegram Remote Control Module", () => {
  it("initializes SQLite tables and saves configuration", () => {
    const db = new Database(":memory:");
    ensureTelegramTables(db);

    saveTelegramConfig(
      {
        botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        allowedChatIds: ["987654321"],
        enabled: true,
        assistantId: "asst-default",
      },
      db,
    );

    const cfg = getTelegramConfig(db);
    expect(cfg).not.toBeNull();
    expect(cfg?.botToken).toBe("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11");
    expect(cfg?.allowedChatIds).toContain("987654321");
    expect(cfg?.enabled).toBe(true);
  });

  it("identifies telegram tools and exposes proper schemas", () => {
    expect(isTelegramTool("telegram_send_message")).toBe(true);
    expect(isTelegramTool("telegram_send_photo")).toBe(true);
    expect(isTelegramTool("random_tool")).toBe(false);

    const tools = openAiTelegramTools();
    expect(tools.length).toBe(2);
    const names = tools.map((t) => t.function.name);
    expect(names).toContain("telegram_send_message");
    expect(names).toContain("telegram_send_photo");
  });

  it("handles bot service lifecycle status", () => {
    expect(telegramBotService.isRunningStatus()).toBe(false);
    const stopRes = telegramBotService.stop();
    expect(stopRes.success).toBe(true);
  });
});
