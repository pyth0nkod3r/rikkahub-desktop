import { id as newId, message as createMessage } from "../foundation/utils";
import type { Conversation, MessageNode } from "../foundation/types";
import { state } from "../persistence/json-store";
import {
  getConversation,
  persistConversation,
} from "../conversations";
import {
  checkoutConversation,
  registerConversation,
  releaseConversation,
} from "../conversations/working-set";
import { generateAnswer } from "../conversations/orchestrator";
import { abortGeneration, generating } from "../conversations/generation-state";
import { getTelegramConfig, saveTelegramConfig } from "./db";
import type { TelegramBotConfig, TelegramUpdate } from "./types";
import { subAgentRegistry } from "../subagents/registry";
import { listScheduledJobs } from "../automation/db";

export class TelegramBotService {
  private static instance: TelegramBotService | null = null;
  private isRunning: boolean = false;
  private abortController: AbortController | null = null;
  private activeConvByChatId: Map<number, string> = new Map();

  static getInstance(): TelegramBotService {
    if (!TelegramBotService.instance) {
      TelegramBotService.instance = new TelegramBotService();
    }
    return TelegramBotService.instance;
  }

  isRunningStatus(): boolean {
    return this.isRunning;
  }

  async start(): Promise<{ success: boolean; message: string }> {
    if (this.isRunning) {
      return { success: true, message: "Telegram bot is already running" };
    }

    const config = getTelegramConfig();
    if (!config || !config.botToken) {
      return { success: false, message: "Bot token not configured in database" };
    }

    this.isRunning = true;
    this.abortController = new AbortController();
    this.pollLoop(config, this.abortController.signal).catch((err) => {
      console.error("[telegram-bot] Polling loop terminated with error:", err);
      this.isRunning = false;
    });

    return { success: true, message: "Telegram bot service started successfully" };
  }

  stop(): { success: boolean; message: string } {
    if (!this.isRunning) {
      return { success: true, message: "Telegram bot is not running" };
    }

    this.isRunning = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    return { success: true, message: "Telegram bot service stopped" };
  }

  async restart(): Promise<{ success: boolean; message: string }> {
    this.stop();
    return this.start();
  }

  private async pollLoop(config: TelegramBotConfig, signal: AbortSignal): Promise<void> {
    let offset = config.lastOffset || 0;

    while (this.isRunning && !signal.aborted) {
      try {
        const liveCfg = getTelegramConfig();
        if (!liveCfg || !liveCfg.enabled) {
          // Disabled in settings; stop polling
          this.isRunning = false;
          break;
        }

        const updates = await this.fetchUpdates(liveCfg.botToken, offset, signal);
        for (const update of updates) {
          if (update.update_id >= offset) {
            offset = update.update_id + 1;
            saveTelegramConfig({ lastOffset: offset });
          }

          await this.handleUpdate(liveCfg, update);
        }
      } catch (err: unknown) {
        if (signal.aborted) break;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[telegram-bot] Polling error:", msg);
        // Wait 3 seconds before retrying on network/API failure
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  private async fetchUpdates(token: string, offset: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=25`;
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new Error(`Telegram API returned ${res.status}: ${res.statusText}`);
    }
    const data = (await res.json()) as { ok: boolean; result?: TelegramUpdate[]; description?: string };
    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description}`);
    }
    return data.result || [];
  }

  private isChatAllowed(cfg: TelegramBotConfig, chatId: number): boolean {
    if (!cfg.allowedChatIds || cfg.allowedChatIds.length === 0) {
      return true; // If no allowed list, open or can restrict
    }
    return cfg.allowedChatIds.map(String).includes(String(chatId));
  }

  private async handleUpdate(cfg: TelegramBotConfig, update: TelegramUpdate): Promise<void> {
    // Handle inline callback buttons
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat.id;
      if (!chatId || !this.isChatAllowed(cfg, chatId)) {
        await this.answerCallbackQuery(cfg.botToken, cq.id, "Unauthorized");
        return;
      }
      await this.handleCallback(cfg, chatId, cq.id, cq.data || "");
      return;
    }

    if (!update.message) return;
    const msg = update.message;
    const chatId = msg.chat.id;
    const text = (msg.text || "").trim();

    if (!this.isChatAllowed(cfg, chatId)) {
      await this.sendMessage(
        cfg.botToken,
        chatId,
        "⛔ Access Denied. Your Telegram Chat ID is not authorized to control this RikkaHub instance.",
      );
      return;
    }

    if (!text) return;

    // Handle commands
    if (text.startsWith("/")) {
      const parts = text.split(/\s+/);
      const command = parts[0].toLowerCase();
      const arg = parts.slice(1).join(" ").trim();

      switch (command) {
        case "/start":
        case "/help":
          await this.sendMessage(
            cfg.botToken,
            chatId,
            `🤖 *RikkaHub Desktop Remote Agent*\n\n` +
              `Commands available:\n` +
              `• /new - Start a fresh conversation session\n` +
              `• /status - View running agents, jobs & system state\n` +
              `• /mode [plan|build] - Check or switch Agent Mode\n` +
              `• /stop - Interrupt active generation\n` +
              `• /model - View active LLM model\n\n` +
              `Or send any task or prompt to begin execution!`,
            "Markdown",
          );
          return;

        case "/new":
          this.activeConvByChatId.delete(chatId);
          await this.sendMessage(
            cfg.botToken,
            chatId,
            "✨ Started a new conversation session. What would you like me to do?",
          );
          return;

        case "/status":
          await this.handleStatusCommand(cfg, chatId);
          return;

        case "/mode":
          await this.handleModeCommand(cfg, chatId, arg);
          return;

        case "/stop":
          await this.handleStopCommand(cfg, chatId);
          return;

        case "/model":
          await this.handleModelCommand(cfg, chatId, arg);
          return;

        case "/approve":
          await this.handleApproveCommand(cfg, chatId);
          return;

        default:
          await this.sendMessage(
            cfg.botToken,
            chatId,
            `Unknown command '${command}'. Type /help to see all available commands.`,
          );
          return;
      }
    }

    // Process regular text as agent prompt
    await this.processUserMessage(cfg, chatId, text);
  }

  private async handleStatusCommand(cfg: TelegramBotConfig, chatId: number): Promise<void> {
    const runningSubAgents = subAgentRegistry.list(true);
    const scheduledJobs = listScheduledJobs();
    const currentConvId = this.activeConvByChatId.get(chatId);
    const currentConv = currentConvId ? getConversation(currentConvId) : null;
    const activeMode = currentConv?.agentMode || "build";

    let text = `📊 *RikkaHub Desktop Status Report*\n\n`;
    text += `• *Agent Mode*: \`${activeMode.toUpperCase()}\`\n`;
    text += `• *Active Sub-Agents*: ${runningSubAgents.length}\n`;
    if (runningSubAgents.length > 0) {
      for (const sa of runningSubAgents.slice(0, 5)) {
        text += `  └ [${sa.status}] \`${sa.label}\`\n`;
      }
    }
    text += `• *Scheduled Jobs*: ${scheduledJobs.length}\n`;
    text += `• *Active Session*: \`${currentConvId || "None (will create on next message)"}\`\n`;

    await this.sendMessage(cfg.botToken, chatId, text, "Markdown");
  }

  private async handleModeCommand(cfg: TelegramBotConfig, chatId: number, arg: string): Promise<void> {
    const convId = this.getOrCreateConversation(chatId, cfg.assistantId);
    const conv = getConversation(convId);
    if (!arg) {
      const current = conv?.agentMode || "build";
      await this.sendMessage(
        cfg.botToken,
        chatId,
        `Current agent mode is *${current.toUpperCase()}*. Use \`/mode plan\` or \`/mode build\` to toggle.`,
        "Markdown",
      );
      return;
    }

    const target = arg.toLowerCase();
    if (target === "plan" || target === "build") {
      if (conv) {
        conv.agentMode = target;
        persistConversation(conv);
      }
      await this.sendMessage(
        cfg.botToken,
        chatId,
        `✅ Switched agent mode to *${target.toUpperCase()}*.`,
        "Markdown",
      );
    } else {
      await this.sendMessage(cfg.botToken, chatId, "Invalid mode. Valid options are `plan` or `build`.", "Markdown");
    }
  }

  private async handleStopCommand(cfg: TelegramBotConfig, chatId: number): Promise<void> {
    const convId = this.activeConvByChatId.get(chatId);
    if (!convId || !generating.get(convId)) {
      await this.sendMessage(cfg.botToken, chatId, "No active agent generation is currently running for this chat.");
      return;
    }

    abortGeneration(convId, "interrupted");
    await this.sendMessage(cfg.botToken, chatId, "⏹ Generation stopped.");
  }

  private async handleModelCommand(cfg: TelegramBotConfig, chatId: number, _arg: string): Promise<void> {
    const providers = state?.settings?.providers || [];
    const enabled = providers.filter((p) => p.enabled !== false);
    let summary = `🤖 *Active Model Configuration*\n\n`;
    for (const p of enabled) {
      summary += `*${p.name}*:\n`;
      for (const m of p.models.slice(0, 3)) {
        summary += `  • \`${m.displayName || m.modelId}\` (id: \`${m.id}\`)\n`;
      }
    }
    await this.sendMessage(cfg.botToken, chatId, summary, "Markdown");
  }

  private async handleApproveCommand(cfg: TelegramBotConfig, chatId: number): Promise<void> {
    const convId = this.activeConvByChatId.get(chatId);
    if (!convId) {
      await this.sendMessage(cfg.botToken, chatId, "No active session.");
      return;
    }

    const conv = getConversation(convId);
    if (conv) {
      conv.agentMode = "build";
      persistConversation(conv);
    }
    await this.sendMessage(
      cfg.botToken,
      chatId,
      "✅ Plan approved! Switched mode to *BUILD*. Resuming execution...",
      "Markdown",
    );
    await this.processUserMessage(cfg, chatId, "The plan has been approved by the user. Proceed with full execution.");
  }

  private async handleCallback(
    cfg: TelegramBotConfig,
    chatId: number,
    callbackQueryId: string,
    data: string,
  ): Promise<void> {
    await this.answerCallbackQuery(cfg.botToken, callbackQueryId, "Processing selection...");

    if (data === "plan_approve") {
      await this.handleApproveCommand(cfg, chatId);
    } else if (data === "plan_decline") {
      const convId = this.activeConvByChatId.get(chatId);
      const conv = convId ? getConversation(convId) : null;
      if (conv) {
        conv.agentMode = "plan";
        persistConversation(conv);
      }
      await this.sendMessage(
        cfg.botToken,
        chatId,
        "❌ Plan declined. What changes would you like made to the plan?",
      );
    }
  }

  private getOrCreateConversation(chatId: number, assistantId?: string): string {
    let convId = this.activeConvByChatId.get(chatId);
    if (convId && getConversation(convId)) {
      return convId;
    }

    convId = newId();
    const now = Date.now();
    const conv: Conversation = {
      id: convId,
      assistantId: assistantId || "default",
      systemPrompt: "You are RikkaHub Desktop Agent interacting via Telegram remote control.",
      title: `Telegram Chat ${chatId}`,
      messages: [],
      chatSuggestions: [],
      isPinned: false,
      createAt: now,
      updateAt: now,
      agentMode: "build",
    };

    registerConversation(conv);
    persistConversation(conv);
    this.activeConvByChatId.set(chatId, convId);
    return convId;
  }

  private async processUserMessage(cfg: TelegramBotConfig, chatId: number, text: string): Promise<void> {
    const convId = this.getOrCreateConversation(chatId, cfg.assistantId);
    const conv = getConversation(convId);
    if (!conv) {
      await this.sendMessage(cfg.botToken, chatId, "Error: Could not retrieve conversation.");
      return;
    }

    // Append user message
    const userMsg = createMessage("USER", [{ type: "text", text }]);
    const userNode: MessageNode = { id: newId(), messages: [userMsg], selectIndex: 0 };
    conv.messages.push(userNode);
    persistConversation(conv);

    // Send typing action
    await this.sendChatAction(cfg.botToken, chatId, "typing");

    // Periodic typing indicator while generating
    const typingInterval = setInterval(() => {
      this.sendChatAction(cfg.botToken, chatId, "typing").catch(() => {});
    }, 4500);

    try {
      checkoutConversation(convId);
      await generateAnswer(conv);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.sendMessage(cfg.botToken, chatId, `⚠️ Execution error: ${msg}`);
      return;
    } finally {
      clearInterval(typingInterval);
      releaseConversation(convId);
    }

    // Harvest latest assistant response
    const updatedConv = getConversation(convId) ?? conv;
    const finalReply = this.harvestLatestReply(updatedConv);

    if (finalReply.proposedPlan) {
      const planMsg = `📋 *Plan Proposed: ${finalReply.proposedPlan.title}*\n\n${finalReply.proposedPlan.plan}\n\n*Would you like to approve and execute this plan?*`;
      await this.sendMessageWithInlineKeyboard(cfg.botToken, chatId, planMsg, [
        [
          { text: "✅ Approve & Run", callback_data: "plan_approve" },
          { text: "❌ Decline", callback_data: "plan_decline" },
        ],
      ]);
      return;
    }

    if (finalReply.text) {
      // Chunk response if longer than 4000 chars (Telegram message limit 4096)
      await this.sendChunkedText(cfg.botToken, chatId, finalReply.text);
    } else {
      await this.sendMessage(cfg.botToken, chatId, "✅ Task completed without text output.");
    }
  }

  private harvestLatestReply(conv: Conversation): { text: string; proposedPlan?: { title: string; plan: string } } {
    if (!conv.messages || conv.messages.length === 0) return { text: "" };
    const lastNode = conv.messages[conv.messages.length - 1];
    const assistantMsg = lastNode.messages.find((m) => m.role === "ASSISTANT");
    if (!assistantMsg) return { text: "" };

    let text = "";
    let proposedPlan: { title: string; plan: string } | undefined;

    for (const part of assistantMsg.parts) {
      if (part.type === "text") {
        text += part.text;
      } else if (part.type === "tool") {
        if (part.toolName === "propose_plan") {
          try {
            const parsed = typeof part.input === "string" ? JSON.parse(part.input) : (part.input as Record<string, unknown>);
            proposedPlan = {
              title: parsed.title || "Proposed Execution Plan",
              plan: parsed.plan || "",
            };
          } catch {
            // Ignore parse error
          }
        }
      }
    }

    return { text: text.trim(), proposedPlan };
  }

  private async sendChunkedText(token: string, chatId: number, fullText: string): Promise<void> {
    const MAX_LEN = 3900;
    let remaining = fullText;
    while (remaining.length > 0) {
      const chunk = remaining.slice(0, MAX_LEN);
      remaining = remaining.slice(MAX_LEN);
      await this.sendMessage(token, chatId, chunk);
    }
  }

  async sendMessage(
    token: string,
    chatId: number,
    text: string,
    parseMode?: "Markdown" | "HTML",
  ): Promise<boolean> {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
    };
    if (parseMode) body.parse_mode = parseMode;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async sendMessageWithInlineKeyboard(
    token: string,
    chatId: number,
    text: string,
    inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>,
  ): Promise<boolean> {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: inlineKeyboard,
      },
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async sendPhoto(token: string, chatId: number, photoUrlOrBase64: string, caption?: string): Promise<boolean> {
    const url = `https://api.telegram.org/bot${token}/sendPhoto`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      photo: photoUrlOrBase64,
    };
    if (caption) body.caption = caption;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async sendChatAction(token: string, chatId: number, action: "typing" | "upload_photo"): Promise<boolean> {
    const url = `https://api.telegram.org/bot${token}/sendChatAction`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async answerCallbackQuery(token: string, callbackQueryId: string, text?: string): Promise<boolean> {
    const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export const telegramBotService = TelegramBotService.getInstance();
