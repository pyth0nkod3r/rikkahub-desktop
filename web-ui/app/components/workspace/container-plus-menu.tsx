import * as React from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Folder, FolderOpen, FolderSearch, MessageSquare, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { confirmDialog } from "~/stores/confirm-store";
import {
  CreateFolderWorkspaceDialog,
  WorkspaceTrustDialog,
} from "~/components/workspace/workspace-create-dialogs";
import { WorkspaceEditDialog } from "~/components/workspace/workspace-edit-dialog";
import api from "~/services/api";
import { CHAT_CONTAINER, useContainerTabsStore, type ContainerKey } from "~/stores/container-tabs-store";
import { useWorkspaceStore } from "~/stores/workspace-store";
import type { WorkspaceDto } from "~/types";

// "新建容器"入口(一级标签栏行尾):列出已有工作区(行尾悬浮重命名/删除)+ 三类新建。
// 分区模型(L 轮)下每组分栏各有一条一级标签栏,但新建入口只挂在全局焦点组 ——
// 新建出来的容器落在焦点组里,与用户"我正在这一组操作"的直觉一致。

/** 点击/循环切换容器:激活并导航到该容器上次停留的会话(无则回"新对话"首页)。 */
function navigateToContainer(key: ContainerKey, navigate: (to: string) => void) {
  const store = useContainerTabsStore.getState();
  store.activateContainer(key);
  const panes = store.panes[key] ?? [];
  const focused = Math.max(0, Math.min(store.focusedPane[key] ?? 0, panes.length - 1));
  const conversationId = panes[focused]?.active ?? null;
  navigate(conversationId ? `/c/${conversationId}` : "/");
}

export function ContainerPlusMenu() {
  const { t } = useTranslation("page");
  const navigate = useNavigate();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const refresh = useWorkspaceStore((state) => state.refresh);
  const activeTab = useContainerTabsStore((state) => state.activeTab);
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false);
  // 信任门目标 + 拒绝语义:创建流拒绝=删除记录;重开已有未信任工作区拒绝=仅关门。
  const [trustTarget, setTrustTarget] = React.useState<{ workspace: WorkspaceDto; fromCreate: boolean } | null>(null);
  // R7 工作区管理:重命名对话框目标 + 输入值(提交 PATCH workspaces/:id)。
  const [renameTarget, setRenameTarget] = React.useState<WorkspaceDto | null>(null);

  const createManagedWorkspace = React.useCallback(async () => {
    try {
      const res = await api.post<{ workspace: WorkspaceDto }>("workspaces", { type: "managed" });
      await refresh();
      useContainerTabsStore.getState().openContainer(res.workspace.id);
      navigate("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("workspace.create.failed"));
    }
  }, [navigate, refresh, t]);

  // R7:从菜单激活已有工作区——folder 型未信任先过信任门,其余直接开标签并导航。
  const openWorkspaceFromMenu = React.useCallback(
    (workspace: WorkspaceDto) => {
      if (workspace.type === "folder" && workspace.trustedAt == null) {
        setTrustTarget({ workspace, fromCreate: false });
        return;
      }
      useContainerTabsStore.getState().openContainer(workspace.id);
      navigateToContainer(workspace.id, navigate);
    },
    [navigate],
  );

  // 删除仅移除工作区记录与会话索引,不碰磁盘文件(folder 型的真实目录保持原样)。
  const deleteWorkspace = React.useCallback(
    async (workspace: WorkspaceDto) => {
      const ok = await confirmDialog({
        title: t("workspace.menu.delete_confirm_title", { name: workspace.name }),
        description: t("workspace.menu.delete_confirm_desc"),
        danger: true,
      });
      if (!ok) return;
      try {
        await api.delete(`workspaces/${workspace.id}`);
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("workspace.menu.delete_failed"));
      }
    },
    [refresh, t],
  );

  // G4 在资源管理器中显示:path 空串 = 工作区根目录本身(explorer /select 选中)。
  const revealWorkspace = React.useCallback(
    (workspace: WorkspaceDto) => {
      void api
        .post(`workspaces/${workspace.id}/files/reveal`, { path: "" })
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : t("workspace.menu.reveal_failed"));
        });
    },
    [t],
  );

  const openChatContainer = React.useCallback(() => {
    useContainerTabsStore.getState().openContainer(CHAT_CONTAINER);
    navigateToContainer(CHAT_CONTAINER, navigate);
  }, [navigate]);

  const openEditDialog = React.useCallback((workspace: WorkspaceDto) => {
    setRenameTarget(workspace);
  }, []);


  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("workspace.tabs.new_container")}
            className="mb-[5px] flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--ds-icon)] transition-colors duration-150 hover:bg-[var(--ds-on-surface)] hover:text-foreground"
          >
            <Plus className="size-[18px]" strokeWidth={1.75} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {/* R7:已有工作区列表——点击激活;行尾悬浮出重命名/删除(阻断 item 选中) */}
          {workspaces.length > 0 ? (
            <>
              <DropdownMenuLabel>{t("workspace.menu.existing")}</DropdownMenuLabel>
              {workspaces.map((workspace) => {
                const WsIcon = workspace.type === "folder" ? FolderOpen : Folder;
                return (
                  <DropdownMenuItem
                    key={workspace.id}
                    className="group/ws"
                    data-active={workspace.id === activeTab || undefined}
                    onSelect={() => openWorkspaceFromMenu(workspace)}
                  >
                    <WsIcon className="size-4" strokeWidth={1.75} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1.5 truncate">
                        <span className="truncate">{workspace.name}</span>
                        {workspace.status === "missing" ? (
                          <span className="flex shrink-0 items-center gap-0.5 rounded bg-warning/15 px-1 py-px text-micro font-medium text-warning">
                            <TriangleAlert className="size-2.5" strokeWidth={2} />
                            {t("workspace.menu.missing_badge")}
                          </span>
                        ) : null}
                      </span>
                      <span className="truncate text-mini leading-4 text-[var(--ds-text-tertiary)]">
                        {workspace.root}
                      </span>
                    </span>
                    <span
                      className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/ws:opacity-100"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="flex size-6 items-center justify-center rounded-full text-[var(--ds-icon)] hover:bg-[var(--ds-on-surface-active)] hover:text-foreground"
                            onClick={() => openEditDialog(workspace)}
                          >
                            <Pencil className="size-3.5" strokeWidth={1.75} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{t("workspace.menu.rename")}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="flex size-6 items-center justify-center rounded-full text-[var(--ds-icon)] hover:bg-[var(--ds-on-surface-active)] hover:text-destructive"
                            onClick={() => void deleteWorkspace(workspace)}
                          >
                            <Trash2 className="size-3.5" strokeWidth={1.75} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{t("workspace.menu.delete")}</TooltipContent>
                      </Tooltip>
                    </span>
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onSelect={() => void createManagedWorkspace()}>
            <Folder className="size-4" />
            <div className="min-w-0">
              <div className="text-sm">{t("workspace.create.managed")}</div>
              <div className="truncate text-xs text-muted-foreground">
                {t("workspace.create.managed_hint")}
              </div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setFolderDialogOpen(true)}>
            <FolderOpen className="size-4" />
            <div className="min-w-0">
              <div className="text-sm">{t("workspace.create.folder")}</div>
              <div className="truncate text-xs text-muted-foreground">
                {t("workspace.create.folder_hint")}
              </div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openChatContainer}>
            <MessageSquare className="size-4" />
            <div className="min-w-0">
              <div className="text-sm">{t("workspace.create.chat")}</div>
              <div className="truncate text-xs text-muted-foreground">
                {t("workspace.create.chat_hint")}
              </div>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <WorkspaceEditDialog
        workspace={renameTarget}
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      />

      <CreateFolderWorkspaceDialog
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        onCreated={(workspace) => setTrustTarget({ workspace, fromCreate: true })}
      />
      <WorkspaceTrustDialog
        workspace={trustTarget?.workspace ?? null}
        onOpenChange={(open) => {
          if (!open) setTrustTarget(null);
        }}
        onDeclinedDelete={trustTarget?.fromCreate ?? false}
        onTrusted={(workspace) => {
          useContainerTabsStore.getState().openContainer(workspace.id);
          navigateToContainer(workspace.id, navigate);
        }}
      />
    </>
  );
}
