import { getTelegramConfig } from "../telegram/db";
import { telegramBotService } from "../telegram/bot-service";

export const TELEGRAM_SEND_MESSAGE_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "telegram_send_message",
    description: "Send a proactive notification or message to a Telegram chat using the configured bot.",
    parameters: {
      type: "object",
      properties: {
        chat_id: { type: "number", description: "Target Telegram Chat ID (optional if configured in allowed chats)" },
        text: { type: "string", description: "Text message to send" },
        parse_mode: { type: "string", enum: ["Markdown", "HTML"], description: "Optional formatting mode" },
      },
      required: ["text"],
    },
  },
};

export const TELEGRAM_SEND_PHOTO_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "telegram_send_photo",
    description: "Send a photo or screenshot to a Telegram chat via URL or base64.",
    parameters: {
      type: "object",
      properties: {
        chat_id: { type: "number", description: "Target Telegram Chat ID" },
        photo: { type: "string", description: "URL or base64 data URI of the image" },
        caption: { type: "string", description: "Optional caption for the image" },
      },
      required: ["photo"],
    },
  },
};

export const TELEGRAM_TOOL_SCHEMAS = [
  TELEGRAM_SEND_MESSAGE_TOOL_SCHEMA,
  TELEGRAM_SEND_PHOTO_TOOL_SCHEMA,
];

export function openAiTelegramTools() {
  return TELEGRAM_TOOL_SCHEMAS;
}

export function isTelegramTool(name: string): boolean {
  return name === "telegram_send_message" || name === "telegram_send_photo";
}

export async function executeTelegramTool(name: string, args: Record<string, unknown>): Promise<string> {
  const config = getTelegramConfig();
  if (!config || !config.botToken) {
    throw new Error("Telegram bot is not configured. Please set the bot token in Settings.");
  }

  const defaultChatId =
    config.allowedChatIds && config.allowedChatIds.length > 0
      ? Number(config.allowedChatIds[0])
      : undefined;

  switch (name) {
    case "telegram_send_message": {
      const chatId = typeof args.chat_id === "number" ? args.chat_id : defaultChatId;
      if (!chatId) {
        throw new Error("No chat_id specified and no default allowed chat ID configured.");
      }
      const text = String(args.text || "").trim();
      if (!text) throw new Error("text is required");
      const parseMode = args.parse_mode === "HTML" ? "HTML" : args.parse_mode === "Markdown" ? "Markdown" : undefined;

      const ok = await telegramBotService.sendMessage(config.botToken, chatId, text, parseMode);
      return JSON.stringify({ ok, chatId });
    }

    case "telegram_send_photo": {
      const chatId = typeof args.chat_id === "number" ? args.chat_id : defaultChatId;
      if (!chatId) {
        throw new Error("No chat_id specified and no default allowed chat ID configured.");
      }
      const photo = String(args.photo || "").trim();
      if (!photo) throw new Error("photo is required");
      const caption = args.caption ? String(args.caption) : undefined;

      const ok = await telegramBotService.sendPhoto(config.botToken, chatId, photo, caption);
      return JSON.stringify({ ok, chatId });
    }

    default:
      throw new Error(`Unknown Telegram tool: ${name}`);
  }
}
