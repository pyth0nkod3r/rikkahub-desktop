// components/settings/extensions/remote.tsx — Settings > Extensions > Remote Control & SSH
// Ported from rikkahub-agent (Pyth0nkod3r fork) Remote Bot & SSH Module

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  CheckCircle2,
  Key,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Server,
  Square,
  Terminal,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Badge } from "~/components/ui/badge";
import api from "~/services/api";
import {
  SettingsField,
  SettingsGroup,
} from "~/components/settings/shared";
import type { SettingsSectionProps } from "../settings-registry";

interface TelegramConfig {
  botToken: string;
  allowedChatIds: string[];
  enabled: boolean;
  assistantId?: string;
}

interface SshHost {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
  keyPath?: string;
  createdAt: number;
  updatedAt: number;
}

export function RemoteSection(_props: SettingsSectionProps) {
  const { t } = useTranslation();

  // Telegram state
  const [tgConfig, setTgConfig] = React.useState<TelegramConfig>({
    botToken: "",
    allowedChatIds: [],
    enabled: false,
  });
  const [tgRunning, setTgRunning] = React.useState<boolean>(false);
  const [allowedChatsInput, setAllowedChatsInput] = React.useState<string>("");
  const [isSavingTg, setIsSavingTg] = React.useState<boolean>(false);

  // SSH Hosts state
  const [sshHosts, setSshHosts] = React.useState<SshHost[]>([]);
  const [isLoadingHosts, setIsLoadingHosts] = React.useState<boolean>(false);
  const [isTestingHost, setIsTestingHost] = React.useState<string | null>(null);

  // New host form state
  const [newLabel, setNewLabel] = React.useState<string>("");
  const [newHost, setNewHost] = React.useState<string>("");
  const [newPort, setNewPort] = React.useState<number>(22);
  const [newUser, setNewUser] = React.useState<string>("root");
  const [newKeyPath, setNewKeyPath] = React.useState<string>("");
  const [isAddingHost, setIsAddingHost] = React.useState<boolean>(false);

  // Fetch Telegram config & SSH hosts
  const refreshTelegram = React.useCallback(async () => {
    try {
      const res = await api.get<{ config: TelegramConfig; running: boolean }>("telegram/config");
      if (res && res.config) {
        setTgConfig(res.config);
        setAllowedChatsInput((res.config.allowedChatIds || []).join(", "));
        setTgRunning(res.running);
      }
    } catch (err) {
      console.error("Failed to load Telegram configuration:", err);
    }
  }, []);

  const refreshSshHosts = React.useCallback(async () => {
    setIsLoadingHosts(true);
    try {
      const res = await api.get<{ hosts: SshHost[] }>("ssh/hosts");
      setSshHosts(res?.hosts || []);
    } catch (err) {
      console.error("Failed to load SSH hosts:", err);
    } finally {
      setIsLoadingHosts(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshTelegram();
    void refreshSshHosts();
  }, [refreshTelegram, refreshSshHosts]);

  // Save Telegram config
  const handleSaveTelegram = async () => {
    setIsSavingTg(true);
    try {
      const chatIds = allowedChatsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await api.post<{ config: TelegramConfig; running: boolean }>("telegram/config", {
        botToken: tgConfig.botToken,
        allowedChatIds: chatIds,
        enabled: tgConfig.enabled,
      });

      if (res && res.config) {
        setTgConfig(res.config);
        setTgRunning(res.running);
        toast.success(t("settings:remote.saved", "Telegram settings saved"));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingTg(false);
    }
  };

  // Toggle Bot Service
  const handleToggleBot = async () => {
    try {
      if (tgRunning) {
        await api.post("telegram/stop");
        setTgRunning(false);
        toast.info("Telegram bot service stopped");
      } else {
        const res = await api.post<{ success: boolean; message: string }>("telegram/start");
        if (res.success) {
          setTgRunning(true);
          toast.success("Telegram bot service started");
        } else {
          toast.error(res.message);
        }
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  // Test SSH connection
  const handleTestSsh = async (label: string) => {
    setIsTestingHost(label);
    try {
      const res = await api.post<{ ok: boolean; stdout?: string; stderr?: string; error?: string }>("ssh/test", {
        label,
      });
      if (res.ok) {
        toast.success(`SSH Connection to '${label}' successful!`);
      } else {
        toast.error(`SSH Connection to '${label}' failed: ${res.stderr || res.error || "Exit code non-zero"}`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTestingHost(null);
    }
  };

  // Add SSH host
  const handleAddHost = async () => {
    if (!newLabel.trim() || !newHost.trim() || !newUser.trim()) {
      toast.error("Label, Host, and User are required");
      return;
    }

    try {
      await api.post("ssh/hosts", {
        label: newLabel.trim(),
        host: newHost.trim(),
        port: newPort,
        user: newUser.trim(),
        keyPath: newKeyPath.trim() || undefined,
      });

      toast.success(`Saved SSH host profile '${newLabel.trim()}'`);
      setNewLabel("");
      setNewHost("");
      setNewPort(22);
      setNewUser("root");
      setNewKeyPath("");
      setIsAddingHost(false);
      void refreshSshHosts();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  // Delete SSH host
  const handleDeleteHost = async (label: string) => {
    try {
      await api.delete(`ssh/hosts/${encodeURIComponent(label)}`);
      toast.success(`Removed host '${label}'`);
      void refreshSshHosts();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Telegram Remote Control */}
      <SettingsGroup
        title={t("settings:remote.general_title", "Telegram Bot Remote Control")}
        description={t(
          "settings:remote.general_desc",
          "Control RikkaHub desktop agent directly from your phone or mobile Telegram app.",
        )}
      >
        <SettingsField
          label={t("settings:remote.bot_status_label", "Service Status")}
          description={t(
            "settings:remote.bot_status_desc",
            "Real-time status of the background long-polling Telegram listener.",
          )}
        >
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className={
                tgRunning
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 gap-1.5 py-1 px-2.5"
                  : "border-slate-300 bg-slate-100 text-slate-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 gap-1.5 py-1 px-2.5"
              }
            >
              <Radio className={tgRunning ? "size-3.5 animate-pulse text-emerald-500" : "size-3.5 text-neutral-400"} />
              {tgRunning ? "Active & Listening" : "Stopped"}
            </Badge>

            <Button
              size="sm"
              variant={tgRunning ? "destructive" : "default"}
              onClick={handleToggleBot}
              disabled={!tgConfig.botToken}
              className="gap-1.5 h-8 text-xs font-medium"
            >
              {tgRunning ? (
                <>
                  <Square className="size-3.5" /> Stop Listener
                </>
              ) : (
                <>
                  <Play className="size-3.5" /> Start Listener
                </>
              )}
            </Button>
          </div>
        </SettingsField>

        <SettingsField
          label={t("settings:remote.bot_token_label", "Telegram Bot Token")}
          description={t("settings:remote.bot_token_desc", "Bot token obtained from @BotFather.")}
        >
          <Input
            type="password"
            value={tgConfig.botToken}
            onChange={(e) => setTgConfig((prev) => ({ ...prev, botToken: e.target.value }))}
            placeholder="123456789:ABCDefGHIjkLmNoPQRstuVWxyz"
            className="font-mono text-xs w-full max-w-md"
          />
        </SettingsField>

        <SettingsField
          label={t("settings:remote.allowed_chats_label", "Allowed Chat IDs")}
          description={t(
            "settings:remote.allowed_chats_desc",
            "Comma-separated list of Telegram user or group chat IDs authorized to control the agent.",
          )}
        >
          <Input
            type="text"
            value={allowedChatsInput}
            onChange={(e) => setAllowedChatsInput(e.target.value)}
            placeholder="e.g. 123456789, 987654321"
            className="font-mono text-xs w-full max-w-md"
          />
        </SettingsField>

        <SettingsField
          label={t("settings:remote.enabled_label", "Enable Remote Service")}
          description={t(
            "settings:remote.enabled_desc",
            "Automatically start the Telegram service when RikkaHub launches.",
          )}
        >
          <Switch
            checked={tgConfig.enabled}
            onCheckedChange={(checked) => setTgConfig((prev) => ({ ...prev, enabled: checked }))}
          />
        </SettingsField>

        <div className="flex justify-end pt-2">
          <Button size="sm" onClick={handleSaveTelegram} disabled={isSavingTg} className="gap-1.5">
            {isSavingTg ? <RefreshCw className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            Save Telegram Settings
          </Button>
        </div>
      </SettingsGroup>

      {/* SSH Hosts Management */}
      <SettingsGroup
        title={t("settings:remote.ssh_title", "Remote SSH Hosts & Servers")}
        description={t(
          "settings:remote.ssh_desc",
          "Manage saved SSH remote hosts for agent tools (ssh_exec, ssh_upload, ssh_download).",
        )}
      >
        <div className="flex items-center justify-between pb-2">
          <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <Server className="size-4" />
            Configured Hosts ({sshHosts.length})
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsAddingHost((prev) => !prev)}
            className="gap-1.5 h-8 text-xs font-medium"
          >
            <Plus className="size-3.5" />
            {isAddingHost ? "Cancel" : "Add Host"}
          </Button>
        </div>

        {isAddingHost && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Terminal className="size-3.5 text-primary" />
              New SSH Host Profile
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">
                  {t("settings:remote.ssh_label_label", "Host Label")}
                </label>
                <Input
                  size={1}
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. vps, staging, raspberry-pi"
                  className="font-mono text-xs mt-1"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground">
                  {t("settings:remote.ssh_host_label", "Remote Address & Port")}
                </label>
                <div className="flex gap-2 mt-1">
                  <Input
                    size={1}
                    value={newHost}
                    onChange={(e) => setNewHost(e.target.value)}
                    placeholder="192.168.1.100 or myserver.com"
                    className="font-mono text-xs flex-1"
                  />
                  <Input
                    type="number"
                    value={newPort}
                    onChange={(e) => setNewPort(Number(e.target.value) || 22)}
                    className="font-mono text-xs w-20"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground">
                  {t("settings:remote.ssh_user_label", "User & Auth")}
                </label>
                <Input
                  size={1}
                  value={newUser}
                  onChange={(e) => setNewUser(e.target.value)}
                  placeholder="root or deploy"
                  className="font-mono text-xs mt-1"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground">
                  Private Key Identity Path (optional)
                </label>
                <Input
                  size={1}
                  value={newKeyPath}
                  onChange={(e) => setNewKeyPath(e.target.value)}
                  placeholder="C:\Users\username\.ssh\id_ed25519"
                  className="font-mono text-xs mt-1"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={handleAddHost} className="gap-1.5 h-8 text-xs">
                <CheckCircle2 className="size-3.5" />
                Save Profile
              </Button>
            </div>
          </div>
        )}

        {sshHosts.length === 0 && !isAddingHost ? (
          <div className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
            No remote SSH hosts saved yet. Click "Add Host" above to configure a remote server.
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {sshHosts.map((host) => (
              <div key={host.id} className="flex items-center justify-between p-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{host.label}</span>
                    <Badge variant="secondary" className="font-mono text-[10px] py-0 px-1.5">
                      {host.user}@{host.host}:{host.port}
                    </Badge>
                  </div>
                  {host.keyPath && (
                    <div className="text-[11px] text-muted-foreground flex items-center gap-1 font-mono">
                      <Key className="size-3" />
                      {host.keyPath}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTestSsh(host.label)}
                    disabled={isTestingHost === host.label}
                    className="gap-1 h-7 text-[11px] px-2.5"
                  >
                    {isTestingHost === host.label ? (
                      <RefreshCw className="size-3 animate-spin" />
                    ) : (
                      <Activity className="size-3" />
                    )}
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteHost(host.label)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}
