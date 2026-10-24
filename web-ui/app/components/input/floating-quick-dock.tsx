import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Cpu,
  Expand,
  FolderGit2,
  PanelRight,
  Sparkles,
} from "lucide-react";

import { cn } from "~/lib/utils";
import { useConversationStore } from "~/stores/conversation-store";
import { useWorkspaceLayoutStore } from "~/stores/workspace-layout-store";
import { useCurrentAssistant } from "~/hooks/use-current-assistant";
import { useConversationList } from "~/hooks/use-conversation-list";
import type { ConversationListDto } from "~/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";

interface FloatingQuickDockProps {
  conversationId: string | null;
  onCompress?: () => void;
  className?: string;
}

export function FloatingQuickDock({
  conversationId,
  onCompress,
  className,
}: FloatingQuickDockProps) {
  const { t } = useTranslation();

  const widthMode = useWorkspaceLayoutStore((s) => s.widthMode);
  const toggleWidthMode = useWorkspaceLayoutStore((s) => s.toggleWidthMode);
  const sidecarOpen = useWorkspaceLayoutStore((s) => s.sidecarOpen);
  const toggleSidecar = useWorkspaceLayoutStore((s) => s.toggleSidecar);
  const setSidecarTab = useWorkspaceLayoutStore((s) => s.setSidecarTab);

  const { currentAssistantId } = useCurrentAssistant();
  const { conversations } = useConversationList({ currentAssistantId, autoSelectFirst: false });
  const subagents = React.useMemo(() => {
    return conversations.filter(
      (c: ConversationListDto) =>
        c.title &&
        (c.title.startsWith("[Sub-agent]") ||
          c.title.toLowerCase().includes("sub-agent") ||
          c.title.toLowerCase().includes("subagent")),
    );
  }, [conversations]);

  const activeEntry = useConversationStore((s) =>
    conversationId ? s.entries[conversationId] : null,
  );

  const tokenSummary = React.useMemo(() => {
    const nodes = activeEntry?.detail?.messages ?? [];
    let promptTotal = 0;
    let completionTotal = 0;
    for (const node of nodes) {
      const msg = node.messages[node.selectIndex] ?? node.messages[0];
      if (!msg) continue;
      const usage = msg.usage as Record<string, unknown> | null | undefined;
      if (!usage || typeof usage !== "object") continue;
      promptTotal += Number(usage.promptTokens ?? usage.inputTokens ?? 0) || 0;
      completionTotal += Number(usage.completionTokens ?? usage.outputTokens ?? 0) || 0;
    }
    const total = promptTotal + completionTotal;
    if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M tok`;
    if (total >= 1_000) return `${(total / 1_000).toFixed(0)}k tok`;
    return `${total} tok`;
  }, [activeEntry]);

  const widthLabel = {
    compact: "Standard (768px)",
    comfortable: "Comfortable (1024px)",
    expanded: "Expanded (1280px)",
    full: "Full Width",
  }[widthMode];

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-1.5 px-3 py-1 mb-1 text-xs text-muted-foreground select-none transition-all",
        className,
      )}
    >
      {/* Left Quick Navigation Pills */}
      <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {/* Width Toggle Pill */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleWidthMode}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/60 bg-background/50 hover:bg-accent hover:text-foreground text-[11px] transition-colors"
            >
              <Expand className="size-3" />
              <span>{widthLabel}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>Switch conversation layout width</TooltipContent>
        </Tooltip>

        {/* Subagents Pill */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setSidecarTab("subagents")}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/60 text-[11px] transition-colors",
                subagents.length > 0
                  ? "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"
                  : "bg-background/50 hover:bg-accent hover:text-foreground",
              )}
            >
              <Bot className="size-3" />
              <span>Subagents</span>
              {subagents.length > 0 ? (
                <span className="font-mono tabular-nums font-semibold">({subagents.length})</span>
              ) : null}
            </button>
          </TooltipTrigger>
          <TooltipContent>Open subagents activity inspector</TooltipContent>
        </Tooltip>

        {/* Workspace Files Pill */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setSidecarTab("files")}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/60 bg-background/50 hover:bg-accent hover:text-foreground text-[11px] transition-colors"
            >
              <FolderGit2 className="size-3" />
              <span>Workspace Files</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>Open project file explorer</TooltipContent>
        </Tooltip>

        {/* Context Breakdown Pill */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setSidecarTab("context")}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/60 bg-background/50 hover:bg-accent hover:text-foreground text-[11px] transition-colors"
            >
              <Cpu className="size-3" />
              <span className="font-mono tabular-nums">{tokenSummary}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>Inspect context tokens & memory usage</TooltipContent>
        </Tooltip>
      </div>

      {/* Right Sidecar Toggle Button */}
      <div className="flex items-center gap-1 shrink-0">
        {onCompress && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onCompress}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border/60 bg-background/50 hover:bg-primary/10 hover:text-primary hover:border-primary/30 text-[11px] transition-colors"
              >
                <Sparkles className="size-3 text-primary" />
                <span>Compact</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>Compact conversation context</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleSidecar}
              className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] transition-colors",
                sidecarOpen
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/60 bg-background/50 hover:bg-accent hover:text-foreground",
              )}
            >
              <PanelRight className="size-3" />
              <span>{sidecarOpen ? "Hide Inspector" : "Inspector"}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>Toggle right work panel</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
