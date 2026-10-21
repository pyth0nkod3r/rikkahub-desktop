import * as React from "react";
import { useTranslation } from "react-i18next";
import { Box, FolderOpen, FolderSearch, Layers, ShieldCheck, Terminal, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import api from "~/services/api";
import { useWorkspaceStore } from "~/stores/workspace-store";
import type { WorkspaceDto } from "~/types";

interface SandboxBackendItem {
  id: "local" | "wsl" | "docker";
  name: string;
  available: boolean;
  version?: string;
  distros?: string[];
}

export function WorkspaceEditDialog({
  workspace,
  open,
  onOpenChange,
  onUpdated,
}: {
  workspace: WorkspaceDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: (workspace: WorkspaceDto) => void;
}) {
  const { t } = useTranslation("page");
  const refresh = useWorkspaceStore((state) => state.refresh);

  const [name, setName] = React.useState("");
  const [root, setRoot] = React.useState("");
  const [sandboxBackend, setSandboxBackend] = React.useState<"local" | "wsl" | "docker">("local");
  const [sandboxImage, setSandboxImage] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [availableBackends, setAvailableBackends] = React.useState<SandboxBackendItem[]>([]);

  // 同步工作区当前属性
  React.useEffect(() => {
    if (workspace && open) {
      setName(workspace.name);
      setRoot(workspace.root);
      setSandboxBackend(workspace.sandboxBackend || "local");
      setSandboxImage(workspace.sandboxImage || "");
    }
  }, [workspace, open]);

  // 获取可用的沙箱后端状态
  React.useEffect(() => {
    if (!open) return;
    let active = true;
    api.get<{ backends: SandboxBackendItem[] }>("workspaces/sandbox-backends")
      .then((res) => {
        if (active && res?.backends) {
          setAvailableBackends(res.backends);
        }
      })
      .catch(() => {
        // 后端可能离线或版本不匹配，默认降级
      });
    return () => {
      active = false;
    };
  }, [open]);

  const browseFolder = async () => {
    try {
      const { open: openPicker } = await import("@tauri-apps/plugin-dialog");
      const picked = await openPicker({ directory: true, multiple: false });
      if (typeof picked === "string" && picked) setRoot(picked);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("workspace.create.pick_failed"));
    }
  };

  const submit = async () => {
    if (!workspace || saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const trimmedRoot = workspace.type === "folder" ? root.trim() : "";
    const nameChanged = trimmedName !== workspace.name;
    const rootChanged = workspace.type === "folder" && !!trimmedRoot && trimmedRoot !== workspace.root;
    const sandboxChanged =
      (sandboxBackend || "local") !== (workspace.sandboxBackend || "local") ||
      (sandboxImage.trim() || undefined) !== workspace.sandboxImage;

    if (!nameChanged && !rootChanged && !sandboxChanged) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      const patchBody: Record<string, unknown> = {};
      if (nameChanged) patchBody.name = trimmedName;
      if (rootChanged) patchBody.root = trimmedRoot;
      if (sandboxChanged) {
        patchBody.sandboxBackend = sandboxBackend;
        patchBody.sandboxImage = sandboxImage.trim() || undefined;
      }

      const res = await api.patch<{ workspace: WorkspaceDto }>(`workspaces/${workspace.id}`, patchBody);
      await refresh();
      onUpdated?.(res.workspace);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("workspace.menu.rename_failed"));
    } finally {
      setSaving(false);
    }
  };

  const wslBackend = availableBackends.find((b) => b.id === "wsl");
  const dockerBackend = availableBackends.find((b) => b.id === "docker");

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("workspace.menu.edit_title")}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("workspace.menu.sandbox_hint")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4 py-1">
          {/* 名称 */}
          <div className="space-y-1.5">
            <label className="text-compact font-medium text-[var(--ds-text-secondary)]">
              {t("workspace.menu.name_label")}
            </label>
            <Input
              value={name}
              placeholder={t("workspace.menu.rename_placeholder")}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </div>

          {/* 路径 */}
          <div className="space-y-1.5">
            <label className="text-compact font-medium text-[var(--ds-text-secondary)]">
              {t("workspace.menu.path_label")}
            </label>
            {workspace?.type === "folder" ? (
              <>
                {workspace.status === "missing" ? (
                  <div className="flex items-start gap-2 rounded-[var(--ds-radius-md)] bg-warning/10 px-3 py-2 text-xs text-warning">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
                    <span>{t("workspace.menu.missing_hint")}</span>
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <Input
                    value={root}
                    onChange={(e) => setRoot(e.target.value)}
                    placeholder={t("workspace.create.folder_path_placeholder")}
                    className="flex-1 font-mono text-compact"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => void browseFolder()}>
                    <FolderSearch className="mr-1 size-4" />
                    {t("workspace.create.browse")}
                  </Button>
                </div>
                {root.trim() && root.trim() !== workspace?.root ? (
                  <div className="text-xs text-muted-foreground">{t("workspace.menu.rebind_notice")}</div>
                ) : null}
              </>
            ) : (
              <div className="flex h-9 w-full min-w-0 items-center gap-2 overflow-hidden rounded-[var(--ds-radius-md)] bg-[var(--ds-surface-input)] px-3 text-compact text-[var(--ds-text-secondary)]">
                <FolderOpen className="size-4 shrink-0 text-[var(--ds-icon)]" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">{workspace?.root}</span>
              </div>
            )}
          </div>

          {/* 沙箱隔离等级 (PRoot Equivalence) */}
          <div className="space-y-1.5 pt-1 border-t border-[var(--ds-border-subtle)]">
            <div className="flex items-center justify-between">
              <label className="text-compact font-medium text-[var(--ds-text-secondary)] flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-primary" />
                {t("workspace.menu.sandbox_label")}
              </label>
              {sandboxBackend !== "local" ? (
                <span className="text-[11px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  Tier {sandboxBackend === "wsl" ? "2: RootFS" : "3: Sealed"}
                </span>
              ) : null}
            </div>

            <Select
              value={sandboxBackend}
              onValueChange={(val) => setSandboxBackend(val as "local" | "wsl" | "docker")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">
                  <div className="flex items-center gap-2">
                    <Terminal className="size-4 text-muted-foreground" />
                    <span>{t("workspace.menu.sandbox_local")}</span>
                  </div>
                </SelectItem>
                <SelectItem value="wsl" disabled={wslBackend && !wslBackend.available}>
                  <div className="flex items-center gap-2">
                    <Layers className="size-4 text-sky-500" />
                    <span>{t("workspace.menu.sandbox_wsl")}</span>
                    {wslBackend?.distros?.length ? (
                      <span className="text-[10px] text-muted-foreground">({wslBackend.distros.join(", ")})</span>
                    ) : null}
                  </div>
                </SelectItem>
                <SelectItem value="docker" disabled={dockerBackend && !dockerBackend.available}>
                  <div className="flex items-center gap-2">
                    <Box className="size-4 text-blue-500" />
                    <span>{t("workspace.menu.sandbox_docker")}</span>
                    {dockerBackend?.available ? (
                      <span className="text-[10px] text-muted-foreground">(Docker Active)</span>
                    ) : null}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>

            {/* WSL2 子配置: 发行版名称 */}
            {sandboxBackend === "wsl" ? (
              <div className="space-y-1 pt-1.5">
                <span className="text-xs text-[var(--ds-text-secondary)]">
                  {t("workspace.menu.sandbox_distro_label")}
                </span>
                {wslBackend?.distros && wslBackend.distros.length > 0 ? (
                  <Select
                    value={sandboxImage || wslBackend.distros[0]}
                    onValueChange={(val) => setSandboxImage(val)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={wslBackend.distros[0]} />
                    </SelectTrigger>
                    <SelectContent>
                      {wslBackend.distros.map((distro) => (
                        <SelectItem key={distro} value={distro}>
                          {distro}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={sandboxImage}
                    onChange={(e) => setSandboxImage(e.target.value)}
                    placeholder={t("workspace.menu.sandbox_distro_placeholder")}
                    className="font-mono text-xs"
                  />
                )}
              </div>
            ) : null}

            {/* Docker 子配置: 镜像名称 */}
            {sandboxBackend === "docker" ? (
              <div className="space-y-1 pt-1.5">
                <span className="text-xs text-[var(--ds-text-secondary)]">
                  {t("workspace.menu.sandbox_image_label")}
                </span>
                <Input
                  value={sandboxImage}
                  onChange={(e) => setSandboxImage(e.target.value)}
                  placeholder={t("workspace.menu.sandbox_image_placeholder")}
                  className="font-mono text-xs"
                />
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("workspace.create.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !name.trim()}>
            {t("workspace.menu.rename_confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
