// agents/agent-mode.ts — 会话 Agent 模式(BUILD 与 PLAN 状态机)
// 对齐安卓 rikkahub-agent:
// - PLAN: 规划模式。只读检查(读文件/搜索/查环境),状态修改与执行工具硬锁定;
//   调查完成后调用 propose_plan 生成交互式计划卡片供用户审核。
// - BUILD: 建造模式。全功能工具可用,执行具体构建与修改任务。
// 用户可通过 /plan 与 /build 指令即时切换,或在审核通过 propose_plan 后自动切换至 BUILD。

export type AgentMode = "build" | "plan";

const READ_ONLY_TOOLS = new Set<string>([
  "propose_plan",
  "ask_user",
  "get_time_info",
  "memory_tool",
  "read",
  "grep",
  "find",
  "ls",
  "web_search",
  "web_fetch",
  "web_extract",
  "browser_open",
  "browser_get_dom",
  "browser_get_text",
  "browser_get_links",
  "browser_current_url",
  "browser_wait_for",
  "browser_screenshot",
  "skill_get_content",
]);

/** 判定某工具在 PLAN 模式下是否允许调用 */
export function isToolAllowedInPlanMode(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

/** PLAN 模式系统提示词注入 */
export const PLAN_MODE_SYSTEM_PROMPT = `
[AGENT MODE: PLAN]
You are currently operating in PLAN MODE.
- Your objective is to inspect, analyze, and formulate a clear, step-by-step implementation plan.
- You have read-only tools to examine the workspace, read files, and search information.
- State-modifying and execution tools are locked in this mode. Do not attempt to modify files or execute commands.
- Once your investigation is complete, call the \`propose_plan\` tool with a descriptive title, overview, and implementation steps.
- The user will review your proposal in chat and can accept it (which switches to Build mode for execution) or decline it with adjustments.
`.trim();
