// components/settings/extensions/workspace.tsx — Settings > Extensions > Workspace & Shell Sandbox
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Terminal,
  Cpu,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FolderOpen,
  Plus,
  Box,
  Layers,
  ShieldCheck,
  ShieldAlert,
  Shield,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import api from "~/services/api";
import { SettingsField, SettingsGroup } from "~/components/settings/shared";
import type { SettingsSectionProps } from "../settings-registry";
import { useWorkspaceStore } from "~/stores/workspace-store";
import { WorkspaceEditDialog } from "~/components/workspace/workspace-edit-dialog";
import { useContainerTabsStore } from "~/stores/container-tabs-store";
import { closeSettingsDialog } from "~/stores/settings-dialog-store";
import { confirmDialog } from "~/stores/confirm-store";
import { WorkspaceTerminalModal } from "~/components/workspace/workspace-terminal-modal";
import { useNavigate } from "react-router";
import type { WorkspaceDto } from "~/types";

interface ShellStatus {
  available: boolean;
  shellPath: string | null;
  detectedBashPath: string | null;
}

interface SandboxStatus {
  local: boolean;
  wsl: {
    available: boolean;
    defaultDistro?: string | null;
    distros: string[];
  };
  docker: {
    available: boolean;
    running: boolean;
  };
}

export function WorkspaceSection(_props: SettingsSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const refreshWorkspaces = useWorkspaceStore((state) => state.refresh);

  const [shellStatus, setShellStatus] = React.useState<ShellStatus | null>(null);
  const [sandboxStatus, setSandboxStatus] = React.useState<SandboxStatus | null>(null);
  const [refreshingShell, setRefreshingShell] = React.useState(false);
  const [editingWorkspace, setEditingWorkspace] = React.useState<WorkspaceDto | null>(null);
  const [terminalWorkspace, setTerminalWorkspace] = React.useState<WorkspaceDto | null>(null);

  const loadData = React.useCallback(async () => {
    try {
      const [shellRes, sandboxRes] = await Promise.all([
        api.get<{ shell: ShellStatus }>("workspaces/shell-status"),
        api.get<SandboxStatus>("workspaces/sandbox-backends"),
      ]);
      setShellStatus(shellRes.shell);
      setSandboxStatus(sandboxRes);
    } catch (err) {
      console.error("Failed to load workspace/shell status:", err);
    }
  }, []);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRefreshShell = async () => {
    setRefreshingShell(true);
    try {
      const res = await api.post<{ shell: ShellStatus }>("workspaces/shell-status/refresh", {});
      setShellStatus(res.shell);
      toast.success("Shell status re-probed successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to re-probe shell");
    } finally {
      setRefreshingShell(false);
    }
  };

  const createManagedWorkspace = async () => {
    try {
      const res = await api.post<{ workspace: WorkspaceDto }>("workspaces", { type: "managed" });
      await refreshWorkspaces();
      useContainerTabsStore.getState().openContainer(res.workspace.id);
      closeSettingsDialog();
      navigate("/");
      toast.success(`Created managed workspace: ${res.workspace.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create workspace");
    }
  };

  const handleDeleteWorkspace = async (ws: WorkspaceDto) => {
    const confirmed = await confirmDialog({
      title: `Delete Workspace "${ws.name}"?`,
      description: "This unlinks the workspace registration from Rikkahub AgentX. Files on your disk will remain untouched.",
      danger: true,
      confirmLabel: "Delete Workspace",
    });
    if (!confirmed) return;
    try {
      await api.delete(`workspaces/${ws.id}`);
      useContainerTabsStore.getState().closeContainer(ws.id);
      await refreshWorkspaces();
      toast.success(`Deleted workspace "${ws.name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete workspace");
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Shell Access & Runtime Status */}
      <SettingsGroup
        title="Shell Access & Execution"
        description="Bash execution runtime used by the agent to run terminal commands."
      >
        <div className="rounded-xl border bg-card/60 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Terminal className="size-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">Bash Runtime</span>
                  {shellStatus?.available ? (
                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-mini gap-1">
                      <CheckCircle2 className="size-3" />
                      Ready
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-mini gap-1">
                      <AlertCircle className="size-3" />
                      Unavailable
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {shellStatus?.detectedBashPath
                    ? `Detected: ${shellStatus.detectedBashPath}`
                    : "Using embedded MSYS2 Bash runtime (bundled with Rikkahub AgentX)."}
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshingShell}
              onClick={() => void handleRefreshShell()}
              className="gap-1.5"
            >
              <RefreshCw className={refreshingShell ? "size-3.5 animate-spin" : "size-3.5"} />
              <span>Re-probe</span>
            </Button>
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
            <div className="font-medium text-foreground">Out-of-the-Box Windows Compatibility</div>
            <div>
              Rikkahub AgentX includes a minimal embedded MSYS2 Bash bundle. Even if Git for Windows is not installed, the agent can execute standard shell commands, pipelines, and terminal operations.
            </div>
          </div>
        </div>
      </SettingsGroup>

      {/* 2. Sandboxing Tiers (Local, WSL2, Docker) */}
      <SettingsGroup
        title="Multi-Tier Sandboxing"
        description="Isolate agent operations across Local, WSL2 Linux distributions, or Docker containers."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {/* Local */}
          <div className="rounded-xl border p-4 bg-card/60 flex flex-col justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Local (Bash)</span>
                <Badge variant="secondary" className="text-mini">Default</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Runs commands in the local workspace directory via system Git Bash or embedded MSYS2.
              </p>
            </div>
            <div className="mt-4 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="size-3.5" />
              <span>Always Available</span>
            </div>
          </div>

          {/* WSL2 */}
          <div className="rounded-xl border p-4 bg-card/60 flex flex-col justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">WSL2 Linux</span>
                {sandboxStatus?.wsl.available ? (
                  <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-mini">
                    Detected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-mini text-muted-foreground">
                    Not Found
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Runs commands in a real Linux kernel rootfs with automatic Windows path mapping.
              </p>
            </div>
            <div className="mt-4 text-xs text-muted-foreground truncate">
              {sandboxStatus?.wsl.available && sandboxStatus.wsl.distros.length > 0 ? (
                <span>Distros: {sandboxStatus.wsl.distros.join(", ")}</span>
              ) : (
                <span>No WSL2 distributions detected</span>
              )}
            </div>
          </div>

          {/* Docker */}
          <div className="rounded-xl border p-4 bg-card/60 flex flex-col justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Docker</span>
                {sandboxStatus?.docker.running ? (
                  <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-mini">
                    Running
                  </Badge>
                ) : sandboxStatus?.docker.available ? (
                  <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-mini">
                    Daemon Stopped
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-mini text-muted-foreground">
                    Not Installed
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Spawns disposable ephemeral containers mounted to the project directory.
              </p>
            </div>
            <div className="mt-4 text-xs text-muted-foreground">
              {sandboxStatus?.docker.running ? "Daemon ready for container execution" : "Requires Docker Desktop running"}
            </div>
          </div>
        </div>
      </SettingsGroup>

      {/* 3. Workspaces Management */}
      <SettingsGroup
        title="Configured Workspaces"
        description="Persistent environments where the agent reads, writes, and executes code."
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {workspaces.length} workspace{workspaces.length === 1 ? "" : "s"} configured
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void createManagedWorkspace()}
              className="gap-1.5"
            >
              <Plus className="size-3.5" />
              <span>New Managed Workspace</span>
            </Button>
          </div>

          {workspaces.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No workspaces configured yet. Create a managed workspace or open a folder from the tab bar.
            </div>
          ) : (
            <div className="divide-y rounded-xl border bg-card/60 overflow-hidden">
              {workspaces.map((ws) => (
                <div key={ws.id} className="flex items-center justify-between p-3.5 hover:bg-muted/30 transition-colors">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="size-4 text-primary" />
                      <span className="text-sm font-medium">{ws.name}</span>
                      <Badge variant="outline" className="text-mini">
                        {ws.sandboxBackend || "local"}
                      </Badge>
                      <Badge variant="secondary" className="text-mini">
                        {ws.permissionPreset || "balanced"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-[500px]">
                      {ws.root || "Managed directory"}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setTerminalWorkspace(ws)}
                      className="h-8 px-2 text-xs gap-1"
                      title="Open Interactive Sandboxed Terminal"
                    >
                      <Terminal className="size-3.5" />
                      Terminal
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingWorkspace(ws)}
                      className="h-8 px-2 text-xs"
                      title="Edit Sandbox & Permissions"
                    >
                      <Pencil className="size-3.5 mr-1" />
                      Configure
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => {
                        useContainerTabsStore.getState().openContainer(ws.id);
                        closeSettingsDialog();
                        navigate("/");
                      }}
                      className="h-8 px-2 text-xs"
                    >
                      Open
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDeleteWorkspace(ws)}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Delete Workspace"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsGroup>

      {/* Edit Workspace Dialog */}
      {editingWorkspace ? (
        <WorkspaceEditDialog
          workspace={editingWorkspace}
          open={Boolean(editingWorkspace)}
          onOpenChange={(open) => {
            if (!open) {
              setEditingWorkspace(null);
              void refreshWorkspaces();
            }
          }}
        />
      ) : null}

      {/* Interactive Sandboxed Terminal Modal */}
      {terminalWorkspace ? (
        <WorkspaceTerminalModal
          workspace={terminalWorkspace}
          open={Boolean(terminalWorkspace)}
          onOpenChange={(open) => {
            if (!open) setTerminalWorkspace(null);
          }}
        />
      ) : null}
    </div>
  );
}
