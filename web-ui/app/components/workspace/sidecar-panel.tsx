import * as React from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Bot,
  ChevronRight,
  Cpu,
  FileDiff,
  FolderGit2,
  PanelRightClose,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "~/lib/utils";
import api from "~/services/api";
import { useWorkspaceLayoutStore } from "~/stores/workspace-layout-store";
import { useConversationStore } from "~/stores/conversation-store";
import { useContainerTabsStore, type ContainerKey } from "~/stores/container-tabs-store";
import type { ConversationListDto } from "~/types";
import { WorkspaceFilesPanel } from "~/components/workbench/workspace-files-panel";
import { DiffView } from "~/components/workspace/diff-view";
import { Button } from "~/components/ui/button";

interface SidecarPanelProps {
  activeConversationId: string | null;
  conversations?: ConversationListDto[];
  container?: ContainerKey;
  activeWorkspaceId?: string;
  onCompressConversation?: () => void;
  onRefreshList?: () => void;
  className?: string;
}

export function SidecarPanel({
  activeConversationId,
  conversations = [],
  container = "chat",
  activeWorkspaceId,
  onCompressConversation,
  onRefreshList,
  className,
}: SidecarPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const sidecarOpen = useWorkspaceLayoutStore((s) => s.sidecarOpen);
  const sidecarTab = useWorkspaceLayoutStore((s) => s.sidecarTab);
  const activeDiff = useWorkspaceLayoutStore((s) => s.activeDiff);
  const setSidecarTab = useWorkspaceLayoutStore((s) => s.setSidecarTab);
  const setSidecarOpen = useWorkspaceLayoutStore((s) => s.setSidecarOpen);
  const closeDiff = useWorkspaceLayoutStore((s) => s.closeDiff);

  // Filter subagents from all conversations
  const subagents = React.useMemo(() => {
    if (!Array.isArray(conversations)) return [];
    return conversations.filter(
      (c: ConversationListDto) =>
        c &&
        typeof c.title === "string" &&
        (c.title.startsWith("[Sub-agent]") ||
          c.title.toLowerCase().includes("sub-agent") ||
          c.title.toLowerCase().includes("subagent")),
    );
  }, [conversations]);

  const handleDeleteSubagent = async (subagentId: string) => {
    try {
      await api.delete(`conversations/${subagentId}`);
      onRefreshList?.();
      toast.success("Subagent deleted");
    } catch {
      toast.error("Failed to delete subagent");
    }
  };

  const handleClearSubagentTabs = () => {
    const tabsStore = useContainerTabsStore.getState();
    const panes = tabsStore.panes[container] ?? [];
    panes.forEach((pane) => {
      pane.tabs.forEach((tabId) => {
        const conv = conversations.find((c) => c.id === tabId);
        if (conv?.title && conv.title.startsWith("[Sub-agent]")) {
          tabsStore.closeConversation(container, tabId);
        }
      });
    });
    toast.success("Subagent tabs cleared from top bar");
  };

  // Active conversation stats for Tokens & Context tab
  const activeEntry = useConversationStore((s) =>
    activeConversationId ? s.entries[activeConversationId] : null,
  );
  const engineStatus = useConversationStore((s) =>
    activeConversationId ? s.engineStatus[activeConversationId] : null,
  );

  const tokenStats = React.useMemo(() => {
    const nodes = activeEntry?.detail?.messages ?? [];
    let promptTotal = 0;
    let completionTotal = 0;
    let cachedTotal = 0;
    let turns = 0;

    for (const node of nodes) {
      const msgs = node?.messages;
      if (!Array.isArray(msgs) || msgs.length === 0) continue;
      const selectIdx = typeof node.selectIndex === "number" ? node.selectIndex : 0;
      const msg = msgs[selectIdx] ?? msgs[0];
      if (!msg) continue;
      turns++;
      const usage = msg.usage as Record<string, unknown> | null | undefined;
      if (!usage || typeof usage !== "object") continue;
      promptTotal += Number(usage.promptTokens ?? usage.inputTokens ?? 0) || 0;
      completionTotal += Number(usage.completionTokens ?? usage.outputTokens ?? 0) || 0;
      cachedTotal += Number(usage.cachedTokens ?? 0) || 0;
    }

    const total = promptTotal + completionTotal;
    const cacheRate = promptTotal > 0 ? ((cachedTotal / promptTotal) * 100).toFixed(1) : "0.0";
    const contextLimit = 1_048_576; // 1M tokens default for modern agent harness
    const percentage = Math.min(100, Math.max(0, (total / contextLimit) * 100));

    return {
      total,
      promptTotal,
      completionTotal,
      cachedTotal,
      turns,
      cacheRate,
      contextLimit,
      percentage: percentage.toFixed(2),
    };
  }, [activeEntry]);

  if (!sidecarOpen) return null;

  return (
    <aside
      className={cn(
        "flex w-80 lg:w-96 flex-col border-l border-border bg-card/60 backdrop-blur-sm shrink-0 min-h-0 z-10 transition-all duration-200",
        className,
      )}
    >
      {/* Sidecar Tab Navigation Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/80 px-2">
        <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          <button
            type="button"
            onClick={() => setSidecarTab("subagents")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
              sidecarTab === "subagents"
                ? "bg-accent text-accent-foreground font-semibold"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <Bot className="size-3.5" />
            <span>Subagents</span>
            {subagents.length > 0 && (
              <span className="ml-0.5 rounded-full bg-primary/20 text-primary px-1.5 py-0.2 text-[10px] font-mono">
                {subagents.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSidecarTab("files")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
              sidecarTab === "files"
                ? "bg-accent text-accent-foreground font-semibold"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <FolderGit2 className="size-3.5" />
            <span>Files</span>
          </button>

          <button
            type="button"
            onClick={() => setSidecarTab("context")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
              sidecarTab === "context"
                ? "bg-accent text-accent-foreground font-semibold"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <Cpu className="size-3.5" />
            <span>Context</span>
          </button>

          {activeDiff && (
            <button
              type="button"
              onClick={() => setSidecarTab("diff")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                sidecarTab === "diff"
                  ? "bg-accent text-accent-foreground font-semibold"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <FileDiff className="size-3.5 text-amber-500" />
              <span>Diff</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setSidecarOpen(false)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title="Close inspector (collapse sidecar)"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>

      {/* Sidecar Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {sidecarTab === "subagents" && (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Autonomous Subagents ({subagents.length})
              </span>
              {subagents.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearSubagentTabs}
                  className="text-primary hover:underline text-[11px]"
                >
                  Clear from tabs
                </button>
              )}
            </div>

            {subagents.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground space-y-2">
                <Bot className="mx-auto size-8 opacity-40" />
                <p className="font-medium text-foreground/80">No Subagents Spawned</p>
                <p className="text-[11px] leading-relaxed">
                  When tasks require research, file auditing, or parallel execution, the agent spawns autonomous subagents visible here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {subagents.map((sub: ConversationListDto) => {
                  const isCurrent = sub.id === activeConversationId;
                  const displayTitle = (sub.title || "").replace(/^\[Sub-agent\]\s*/i, "").trim();

                  return (
                    <div
                      key={sub.id}
                      onClick={() => navigate(`/c/${sub.id}`)}
                      className={cn(
                        "group relative flex cursor-pointer flex-col gap-1 rounded-lg border p-2.5 transition-all text-xs",
                        isCurrent
                          ? "border-primary/40 bg-primary/5 shadow-sm"
                          : "border-border/60 bg-background/50 hover:border-border hover:bg-accent/40",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="size-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                          <span className="font-medium text-foreground truncate">
                            {displayTitle || "Autonomous Worker"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteSubagent(sub.id);
                            }}
                            className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            title="Delete subagent"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{sub.createAt ? new Date(sub.createAt).toLocaleTimeString() : ""}</span>
                        <span className="flex items-center gap-0.5 text-primary">
                          Open <ChevronRight className="size-3" />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {sidecarTab === "files" && (
          <div className="h-full">
            {activeWorkspaceId ? (
              <WorkspaceFilesPanel workspaceId={activeWorkspaceId} />
            ) : (
              <div className="p-6 text-center text-xs text-muted-foreground space-y-2">
                <FolderGit2 className="mx-auto size-8 opacity-40" />
                <p className="font-medium text-foreground/80">No Active Workspace</p>
                <p className="text-[11px] leading-relaxed">
                  Select or attach a project directory to explore files, edit code, and view live edits made by the agent.
                </p>
              </div>
            )}
          </div>
        )}

        {sidecarTab === "context" && (
          <div className="p-4 space-y-4 text-xs">
            {/* Header & Token Limit Progress Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">Context Window</span>
                <span className="font-mono text-muted-foreground font-medium">
                  {tokenStats.percentage}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/80">
                <div
                  className={cn(
                    "h-full transition-all duration-300",
                    Number(tokenStats.percentage) > 80
                      ? "bg-rose-500"
                      : Number(tokenStats.percentage) > 50
                      ? "bg-amber-500"
                      : "bg-primary",
                  )}
                  style={{ width: `${Math.max(1, Number(tokenStats.percentage))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{tokenStats.total.toLocaleString()} tokens used</span>
                <span>{(tokenStats.contextLimit / 1000).toFixed(0)}k limit</span>
              </div>
            </div>

            {/* Token Breakdown Cards */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
                <div className="text-[10px] text-muted-foreground">Input / Prompt</div>
                <div className="text-sm font-semibold font-mono text-foreground mt-0.5">
                  {tokenStats.promptTotal.toLocaleString()}
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
                <div className="text-[10px] text-muted-foreground">Output / Completion</div>
                <div className="text-sm font-semibold font-mono text-foreground mt-0.5">
                  {tokenStats.completionTotal.toLocaleString()}
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
                <div className="text-[10px] text-muted-foreground">Cache Hit Rate</div>
                <div className="text-sm font-semibold font-mono text-emerald-500 mt-0.5">
                  {tokenStats.cacheRate}%
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
                <div className="text-[10px] text-muted-foreground">Conversation Turns</div>
                <div className="text-sm font-semibold font-mono text-foreground mt-0.5">
                  {tokenStats.turns}
                </div>
              </div>
            </div>

            {/* Engine / Status Card */}
            {engineStatus && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-1">
                <div className="flex items-center gap-1.5 font-medium text-primary">
                  <RefreshCw className="size-3.5 animate-spin" />
                  <span>Engine Phase: {engineStatus.phase}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Autonomous agent harness is actively updating context and managing state transitions.
                </p>
              </div>
            )}

            {/* 1-Click Compact Button */}
            {onCompressConversation && (
              <Button
                variant="outline"
                size="sm"
                className="w-full flex items-center justify-center gap-1.5 mt-2 border-primary/30 hover:bg-primary/10 hover:text-primary"
                onClick={onCompressConversation}
              >
                <Sparkles className="size-3.5 text-primary" />
                <span>Compact & Summarize Context</span>
              </Button>
            )}
          </div>
        )}

        {sidecarTab === "diff" && activeDiff && (
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between border-b border-border/80 px-3 py-2 bg-muted/30">
              <span className="font-mono text-xs truncate max-w-[200px]" title={activeDiff.file}>
                {activeDiff.file}
              </span>
              <button
                type="button"
                onClick={closeDiff}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
              <DiffView diff={activeDiff.diff} />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
