// components/settings/providers/multi-account-pool.tsx — Multi-Account Round-Robin Pool Manager
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Users,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  Clock,
  ShieldCheck,
  Zap,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Switch } from "~/components/ui/switch";
import { Input } from "~/components/ui/input";
import { openExternal } from "~/lib/external-link";
import api from "~/services/api";
import { confirmDialog } from "~/stores/confirm-store";
import type { ProviderProfile } from "~/types";

interface AccountUsageWindow {
  remainingFraction: number;
  resetsAt: number | null;
}

interface AccountUsageSnapshot {
  daily?: AccountUsageWindow | null;
  weekly?: AccountUsageWindow | null;
  remainingPercent?: number;
  resetsAt?: number;
  updatedAt: number;
}

interface ProviderAccountItem {
  id: string;
  name: string;
  email: string;
  projectId?: string;
  chatgptAccountId?: string;
  enabled: boolean;
  tokenStatus: "AVAILABLE" | "EXPIRED" | "INVALID" | "RATE_LIMITED" | "UNKNOWN";
  usage?: AccountUsageSnapshot | null;
}

interface DeviceAuthInfo {
  userCode?: string;
  verificationUrl?: string;
  authUrl?: string;
}

export function MultiAccountPool({
  provider,
  accountType,
}: {
  provider: ProviderProfile;
  accountType: "gemini" | "chatgpt";
}) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = React.useState<ProviderAccountItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loggingIn, setLoggingIn] = React.useState(false);
  const [refreshingId, setRefreshingId] = React.useState<string | null>(null);
  const [deviceAuthInfo, setDeviceAuthInfo] = React.useState<DeviceAuthInfo | null>(null);
  const [manualInput, setManualInput] = React.useState("");
  const [submittingManual, setSubmittingManual] = React.useState(false);

  const isGemini = accountType === "gemini";
  const serviceLabel = isGemini ? "Google / Gemini" : "ChatGPT";

  const loadAccounts = React.useCallback(async () => {
    try {
      const res = await api.get<{ accounts: ProviderAccountItem[] }>("settings/providers/accounts", {
        searchParams: { type: accountType },
      });
      setAccounts(res.accounts || []);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  }, [accountType]);

  React.useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const handleStartLogin = async () => {
    setLoggingIn(true);
    setManualInput("");
    try {
      const res = await api.post<{ authUrl?: string; userCode?: string; verificationUrl?: string }>(
        "settings/providers/accounts/login",
        {},
        { searchParams: { type: accountType } },
      );

      setDeviceAuthInfo({
        userCode: res.userCode,
        verificationUrl: res.verificationUrl,
        authUrl: res.authUrl,
      });

      if (res.authUrl) {
        void openExternal(res.authUrl);
        if (res.userCode) {
          toast.info(`Please enter user code ${res.userCode} on the opened verification page.`);
        } else {
          toast.info("Browser opened for sign-in. Complete authentication in your browser.");
        }

        // Poll for completion
        const start = Date.now();
        const poll = setInterval(async () => {
          if (Date.now() - start > 180000) {
            clearInterval(poll);
            setLoggingIn(false);
            setDeviceAuthInfo(null);
            return;
          }
          try {
            const status = await api.get<{
              status: { phase: string; accountId?: string; message?: string; userCode?: string; verificationUrl?: string };
            }>("settings/providers/accounts/status", { searchParams: { type: accountType } });

            if (status.status.userCode && !res.userCode) {
              setDeviceAuthInfo((prev) => ({
                ...prev,
                userCode: status.status.userCode,
                verificationUrl: status.status.verificationUrl,
              }));
            }

            if (status.status.phase === "success") {
              clearInterval(poll);
              setLoggingIn(false);
              setDeviceAuthInfo(null);
              toast.success("Account signed in successfully and added to Round-Robin pool!");
              void loadAccounts();
            } else if (status.status.phase === "error") {
              clearInterval(poll);
              setLoggingIn(false);
              setDeviceAuthInfo(null);
              toast.error(status.status.message || "Authentication failed");
            }
          } catch {
            // Retry
          }
        }, 1500);
      }
    } catch (err) {
      setLoggingIn(false);
      setDeviceAuthInfo(null);
      toast.error(err instanceof Error ? err.message : "Failed to initiate login");
    }
  };

  const handleManualSubmit = async () => {
    if (!manualInput.trim()) return;
    setSubmittingManual(true);
    try {
      await api.post(
        "settings/providers/accounts/submit-code",
        { code: manualInput.trim() },
        { searchParams: { type: accountType } },
      );
      toast.success("Account added successfully via code!");
      setDeviceAuthInfo(null);
      setLoggingIn(false);
      setManualInput("");
      void loadAccounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit code");
    } finally {
      setSubmittingManual(false);
    }
  };

  const handleCancelLogin = () => {
    setDeviceAuthInfo(null);
    setLoggingIn(false);
    void api.post("settings/providers/accounts/cancel", {}, { searchParams: { type: accountType } });
  };

  const handleToggle = async (acc: ProviderAccountItem) => {
    const nextEnabled = !acc.enabled;
    setAccounts((prev) => prev.map((a) => (a.id === acc.id ? { ...a, enabled: nextEnabled } : a)));
    try {
      await api.patch(
        `settings/providers/accounts/${encodeURIComponent(acc.id)}`,
        { enabled: nextEnabled },
        { searchParams: { type: accountType } },
      );
    } catch {
      toast.error("Failed to update account status");
      void loadAccounts();
    }
  };

  const handleRefresh = async (acc: ProviderAccountItem) => {
    setRefreshingId(acc.id);
    try {
      const res = await api.post<{ account: ProviderAccountItem }>(
        `settings/providers/accounts/${encodeURIComponent(acc.id)}/refresh`,
        {},
        { searchParams: { type: accountType } },
      );
      if (res.account) {
        setAccounts((prev) => prev.map((a) => (a.id === acc.id ? res.account : a)));
        toast.success("Account status & quota refreshed");
      }
    } catch {
      toast.error("Failed to refresh account quota");
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (acc: ProviderAccountItem) => {
    const ok = await confirmDialog({
      title: `Remove Account "${acc.name || acc.email}"?`,
      description: "This account will be removed from the multi-account round-robin pool.",
      danger: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;

    try {
      await api.delete(`settings/providers/accounts/${encodeURIComponent(acc.id)}`, {
        searchParams: { type: accountType },
      });
      setAccounts((prev) => prev.filter((a) => a.id !== acc.id));
      toast.success("Account removed from pool");
    } catch {
      toast.error("Failed to remove account");
    }
  };

  const activeCount = accounts.filter((a) => a.enabled && a.tokenStatus !== "INVALID").length;

  return (
    <div className="rounded-xl border bg-card/60 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-primary" />
            <span className="font-semibold text-sm">Multi-Account Round-Robin Pool</span>
            <Badge variant="outline" className="font-mono text-mini gap-1 py-0">
              <Zap className="size-3 text-amber-500 fill-amber-500" />
              {activeCount} / {accounts.length} Active
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Requests rotate automatically across active accounts in round-robin sequence to distribute quota and bypass rate limits.
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loggingIn}
          onClick={() => void handleStartLogin()}
          className="gap-1.5 text-xs h-8"
        >
          {loggingIn ? (
            <Loader2 className="size-3.5 animate-spin text-primary" />
          ) : (
            <Plus className="size-3.5" />
          )}
          <span>Add {serviceLabel} Account</span>
        </Button>
      </div>

      {deviceAuthInfo && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3.5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-medium text-primary">
              <Loader2 className="size-4 animate-spin" />
              <span>Waiting for {serviceLabel} Authorization</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-mini"
              onClick={handleCancelLogin}
            >
              Cancel
            </Button>
          </div>

          {deviceAuthInfo.userCode ? (
            <div className="space-y-2">
              <p className="text-muted-foreground">
                Please visit{" "}
                <a
                  href={deviceAuthInfo.verificationUrl || "https://auth.openai.com/codex/device"}
                  target="_blank"
                  rel="noreferrer"
                  className="underline text-primary font-medium"
                  onClick={(e) => {
                    e.preventDefault();
                    void openExternal(deviceAuthInfo.verificationUrl || "https://auth.openai.com/codex/device");
                  }}
                >
                  {deviceAuthInfo.verificationUrl || "https://auth.openai.com/codex/device"}
                </a>{" "}
                and enter this verification code:
              </p>
              <div className="flex items-center gap-2">
                <div className="font-mono text-base font-bold tracking-widest bg-background px-3 py-1 rounded border">
                  {deviceAuthInfo.userCode}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(deviceAuthInfo.userCode!);
                    toast.success("Code copied to clipboard!");
                    if (deviceAuthInfo.verificationUrl) void openExternal(deviceAuthInfo.verificationUrl);
                  }}
                >
                  <Copy className="size-3.5" />
                  <span>Copy Code & Open Browser</span>
                </Button>
              </div>
            </div>
          ) : null}

          <div className="border-t border-border/50 pt-2 space-y-1.5">
            <p className="text-micro text-muted-foreground">
              If the redirect port is blocked on your system, you can also paste the redirect URL or authorization code here:
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="http://localhost:1455/auth/callback?code=... or authorization code"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                className="h-7 text-xs bg-background"
              />
              <Button
                size="sm"
                className="h-7 text-xs shrink-0"
                disabled={!manualInput.trim() || submittingManual}
                onClick={() => void handleManualSubmit()}
              >
                {submittingManual ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
                Submit Code
              </Button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-6 flex justify-center text-muted-foreground text-xs gap-2">
          <Loader2 className="size-4 animate-spin" />
          <span>Loading accounts...</span>
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground space-y-2">
          <div>No {serviceLabel} accounts added yet.</div>
          <p className="text-micro text-muted-foreground/80 max-w-sm mx-auto">
            Click &ldquo;Add {serviceLabel} Account&rdquo; above to sign in. You can add multiple accounts to form a high-capacity round-robin pool.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {accounts.map((acc) => {
            const isRefreshing = refreshingId === acc.id;
            const statusColor =
              acc.tokenStatus === "AVAILABLE"
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                : acc.tokenStatus === "RATE_LIMITED"
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                : "bg-destructive/15 text-destructive border-destructive/30";

            const dailyPercent = acc.usage?.daily
              ? Math.round(acc.usage.daily.remainingFraction * 100)
              : acc.usage?.remainingPercent;
            const weeklyPercent = acc.usage?.weekly
              ? Math.round(acc.usage.weekly.remainingFraction * 100)
              : undefined;

            return (
              <div
                key={acc.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-background/50 hover:bg-background/80 transition-colors text-xs gap-3"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary shrink-0">
                    {acc.name ? acc.name.charAt(0).toUpperCase() : acc.email ? acc.email.charAt(0).toUpperCase() : "A"}
                  </div>

                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate max-w-[180px]">{acc.name || acc.email}</span>
                      <Badge variant="outline" className={`text-micro py-0 px-1.5 ${statusColor}`}>
                        {acc.tokenStatus}
                      </Badge>
                      {acc.projectId ? (
                        <span className="text-micro font-mono text-muted-foreground truncate max-w-[120px]">
                          {acc.projectId}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-3 text-micro text-muted-foreground">
                      {acc.email ? <span className="truncate max-w-[160px]">{acc.email}</span> : null}
                      {dailyPercent !== undefined ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <ShieldCheck className="size-3" />
                          <span>Daily: {dailyPercent}%</span>
                        </span>
                      ) : null}
                      {weeklyPercent !== undefined ? (
                        <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                          <Clock className="size-3" />
                          <span>Weekly: {weeklyPercent}%</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={isRefreshing}
                    onClick={() => void handleRefresh(acc)}
                    title="Refresh Quota"
                  >
                    <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin text-primary" : "text-muted-foreground"}`} />
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    onClick={() => void handleDelete(acc)}
                    title="Remove Account"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>

                  <Switch
                    checked={acc.enabled}
                    onCheckedChange={() => void handleToggle(acc)}
                    aria-label="Toggle Account"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
