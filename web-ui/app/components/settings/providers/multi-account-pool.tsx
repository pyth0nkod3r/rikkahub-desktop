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
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Switch } from "~/components/ui/switch";
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
    try {
      const res = await api.post<{ authUrl: string }>(
        "settings/providers/accounts/login",
        {},
        { searchParams: { type: accountType } },
      );
      if (res.authUrl) {
        void openExternal(res.authUrl);
        toast.info("Browser opened for sign-in. Complete authentication in your browser.");

        // Poll for completion
        const start = Date.now();
        const poll = setInterval(async () => {
          if (Date.now() - start > 120000) {
            clearInterval(poll);
            setLoggingIn(false);
            return;
          }
          try {
            const status = await api.get<{ status: { phase: string; accountId?: string; message?: string } }>(
              "settings/providers/accounts/status",
              { searchParams: { type: accountType } },
            );
            if (status.status.phase === "success") {
              clearInterval(poll);
              setLoggingIn(false);
              toast.success("Account signed in successfully and added to Round-Robin pool!");
              void loadAccounts();
            } else if (status.status.phase === "error") {
              clearInterval(poll);
              setLoggingIn(false);
              toast.error(status.status.message || "Authentication failed");
            }
          } catch {
            // Retry
          }
        }, 1500);
      }
    } catch (err) {
      setLoggingIn(false);
      toast.error(err instanceof Error ? err.message : "Failed to initiate login");
    }
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
    } catch (err) {
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
    } catch (err) {
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

      {loading ? (
        <div className="py-6 flex justify-center text-muted-foreground text-xs gap-2">
          <Loader2 className="size-4 animate-spin" />
          <span>Loading accounts...</span>
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground space-y-2">
          <div>No {serviceLabel} accounts added yet.</div>
          <p className="text-micro text-muted-foreground/80 max-w-sm mx-auto">
            Click &ldquo;Add {serviceLabel} Account&rdquo; above to sign in via Google OAuth. You can add multiple accounts to form a high-capacity round-robin pool.
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
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg border bg-background/50 hover:bg-muted/20 gap-3 transition-colors"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs truncate max-w-[220px]">
                      {acc.name || acc.email}
                    </span>
                    <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${statusColor}`}>
                      {acc.tokenStatus}
                    </Badge>
                    {acc.projectId ? (
                      <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[180px]">
                        [{acc.projectId}]
                      </span>
                    ) : null}
                  </div>

                  <div className="text-[11px] text-muted-foreground truncate">{acc.email}</div>

                  {/* Quota Progress */}
                  {dailyPercent !== undefined ? (
                    <div className="flex items-center gap-3 pt-1 text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <span>Daily:</span>
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${dailyPercent}%` }}
                          />
                        </div>
                        <span className="font-mono text-[10px]">{dailyPercent}%</span>
                      </div>

                      {weeklyPercent !== undefined ? (
                        <div className="flex items-center gap-1.5">
                          <span>Weekly:</span>
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full transition-all"
                              style={{ width: `${weeklyPercent}%` }}
                            />
                          </div>
                          <span className="font-mono text-[10px]">{weeklyPercent}%</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isRefreshing}
                    onClick={() => void handleRefresh(acc)}
                    className="size-7 p-0 text-muted-foreground hover:text-foreground"
                    title="Refresh Quota & Status"
                  >
                    <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDelete(acc)}
                    className="size-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Remove Account"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>

                  <Switch
                    checked={acc.enabled}
                    onCheckedChange={() => void handleToggle(acc)}
                    aria-label="Toggle Account in Pool"
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
