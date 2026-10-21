// tools/propose-plan.ts — 规划模式结构化计划提交工具
// 对齐安卓 rikkahub-agent:
// 在 PLAN 模式下完成代码审查与设计后调用本工具，向用户呈现包含计划标题、概览、
// 执行步骤和 Markdown 详情的交互式卡片。
// 用户审核通过后自动切换会话至 BUILD 模式，开启写权限执行任务。

import type { ToolOutputEntry } from "../foundation/types";

export const PROPOSE_PLAN_TOOL_NAME = "propose_plan";

export interface ProposePlanInput {
  title: string;
  overview?: string;
  steps?: string[];
  plan_markdown?: string;
}

export const proposePlanToolSchema = {
  type: "function" as const,
  function: {
    name: PROPOSE_PLAN_TOOL_NAME,
    description:
      "Propose a structured implementation plan to the user for review in Plan Mode. " +
      "The user will be presented with an interactive plan card in chat to review, accept, or decline. " +
      "If accepted, the conversation automatically transitions to Build Mode for execution.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "A concise title summarizing the plan",
        },
        overview: {
          type: "string",
          description: "A brief high-level summary of what the plan achieves",
        },
        steps: {
          type: "array",
          items: { type: "string" },
          description: "Ordered list of concrete implementation steps",
        },
        plan_markdown: {
          type: "string",
          description: "Detailed markdown content of the plan",
        },
      },
      required: ["title"],
    },
  },
};

/** 解析 propose_plan 参数 */
export function parseProposePlanInput(args: unknown): ProposePlanInput {
  if (!args || typeof args !== "object") {
    return { title: "Implementation Plan" };
  }
  const obj = args as Record<string, unknown>;
  const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "Implementation Plan";
  const overview = typeof obj.overview === "string" ? obj.overview.trim() : undefined;
  const steps = Array.isArray(obj.steps)
    ? obj.steps.map((s) => String(s)).filter((s) => s.length > 0)
    : undefined;
  const plan_markdown = typeof obj.plan_markdown === "string" ? obj.plan_markdown : undefined;

  return { title, overview, steps, plan_markdown };
}

/** 用户决策后产出工具输出结果 */
export function formatProposePlanResult(approved: boolean, feedback?: string): ToolOutputEntry[] {
  const payload = approved
    ? {
        status: "plan_approved",
        mode: "BUILD",
        message: "The plan was approved by the user. Switched to Build Mode. You may now proceed with execution.",
      }
    : {
        status: "plan_declined",
        mode: "PLAN",
        message: `The user declined this proposal.${feedback ? ` Feedback: ${feedback}` : " Please revise your plan accordingly."}`,
      };

  return [{ type: "text", text: JSON.stringify(payload, null, 2) }];
}
