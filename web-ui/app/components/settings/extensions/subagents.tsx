
function SubAgentModelPicker({
  value,
  onChange,
  providers,
}: {
  value: string | null;
  onChange: (modelId: string | null) => void;
  providers: any[];
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const groups = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const result: Array<{ providerId: string; providerName: string; models: Array<{ id: string; modelId: string; name: string }> }> = [];

    for (const p of providers || []) {
      if (!p.enabled) continue;
      const matchedModels = (p.models || [])
        .filter((m: any) => m.type === "CHAT")
        .map((m: any) => ({
          id: m.id,
          modelId: m.modelId,
          name: m.displayName || m.modelId,
        }))
        .filter((m: any) => {
          if (!q) return true;
          return (
            m.name.toLowerCase().includes(q) ||
            m.modelId.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q)
          );
        });

      if (matchedModels.length > 0) {
        result.push({
          providerId: p.id,
          providerName: p.name,
          models: matchedModels,
        });
      }
    }
    return result;
  }, [providers, search]);

  const selectedModel = React.useMemo(() => {
    if (!value) return null;
    for (const p of providers || []) {
      for (const m of p.models || []) {
        if (m.id === value) {
          return { id: m.id, modelId: m.modelId, name: m.displayName || m.modelId, providerName: p.name };
        }
      }
    }
    return null;
  }, [providers, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-9 px-3 text-xs font-normal bg-background"
        >
          <div className="flex items-center gap-2 truncate">
            {selectedModel ? (
              <>
                <AIIcon name={selectedModel.modelId} size={16} className="bg-transparent shrink-0" />
                <span className="truncate">{selectedModel.name}</span>
                <span className="text-muted-foreground text-micro">({selectedModel.providerName})</span>
              </>
            ) : (
              <span className="text-muted-foreground">Inherit from parent assistant</span>
            )}
          </div>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-2 space-y-2" align="start">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search models or providers..."
          clearLabel="Clear"
          className="w-full"
        />
        <div className="max-h-[280px] overflow-y-auto space-y-2 pr-1">
          <button
            type="button"
            className={cn(
              "flex items-center justify-between w-full px-2.5 py-1.5 rounded-md text-xs hover:bg-accent text-left transition-colors",
              !value && "bg-accent/70 font-medium"
            )}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <span>Inherit from parent assistant</span>
            {!value ? <Check className="size-3.5 text-primary" /> : null}
          </button>

          {groups.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No matching models found
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.providerId} className="space-y-1">
                <div className="px-2 pt-1 text-micro font-semibold uppercase tracking-wider text-muted-foreground border-t border-border/40">
                  {group.providerName}
                </div>
                {group.models.map((m) => {
                  const isSelected = m.id === value;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={cn(
                        "flex items-center justify-between w-full px-2.5 py-1.5 rounded-md text-xs hover:bg-accent text-left gap-2 transition-colors",
                        isSelected && "bg-accent/70 font-medium"
                      )}
                      onClick={() => {
                        onChange(m.id);
                        setOpen(false);
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <AIIcon name={m.modelId} size={16} className="bg-transparent shrink-0" />
                        <span className="truncate">{m.name}</span>
                        {m.modelId !== m.name && (
                          <span className="text-micro text-muted-foreground font-mono truncate max-w-[120px]">
                            {m.modelId}
                          </span>
                        )}
                      </div>
                      {isSelected ? <Check className="size-3.5 text-primary shrink-0" /> : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// components/settings/extensions/subagents.tsx — Settings > Extensions > Sub-Agents
// Ported from rikkahub-agent (Pyth0nkod3r fork) SettingSubAgentsPage.kt

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { AIIcon } from "~/components/ui/ai-icon";
import { SearchInput } from "~/components/ui/search-input";
import { Check, ChevronDown } from "lucide-react";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import api from "~/services/api";
import type { Settings } from "~/types";
import {
  SettingsDetailFooter,
  SettingsDetailHeader,
  SettingsEmpty,
  SettingsField,
  SettingsGroup,
  SettingsListAddButton,
  SettingsListRow,
  SettingsSplit,
  SettingsStack,
} from "~/components/settings/shared";

export interface SubAgentProfileDto {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string | null;
  enabled: boolean;
  tools: string[];
  capabilities: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SubAgentRunDto {
  id: string;
  parentChatId: string | null;
  parentAssistantId: string;
  subConversationId: string | null;
  label: string;
  task: string;
  modelId: string | null;
  agentName: string | null;
  runInBackground: boolean;
  timeoutSeconds: number;
  maxTrips: number;
  status: "pending" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled";
  result: string | null;
  error: string | null;
  startedAtMs: number;
  finishedAtMs: number | null;
  tripCount: number;
}

const AVAILABLE_CAPABILITIES = [
  { id: "memory", label: "Memory (save_memory)" },
  { id: "schedule", label: "Schedule & Workflows (cron/automation)" },
  { id: "browser", label: "Browser Automation (CDP web driver)" },
  { id: "ssh", label: "SSH Remote Execution" },
  { id: "subagent", label: "Recursive Sub-Agents" },
  { id: "keystore", label: "Keystore & Cryptography" },
  { id: "web", label: "Web Search & Scraping" },
] as const;

export function SubAgentsSection({ settings }: { settings: Settings; onSettings: (s: Settings) => void }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = React.useState<"profiles" | "runs">("profiles");

  // Profiles State
  const [profiles, setProfiles] = React.useState<SubAgentProfileDto[]>([]);
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [draft, setDraft] = React.useState<SubAgentProfileDto | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Runs State
  const [runs, setRuns] = React.useState<SubAgentRunDto[]>([]);
  const [runsLoading, setRunsLoading] = React.useState(false);

  const loadProfiles = React.useCallback(async () => {
    try {
      const data = await api.get<SubAgentProfileDto[]>("subagents/profiles");
      setProfiles(data);
      if (data.length > 0 && !selectedId) {
        setSelectedId(data[0].id);
        setDraft(data[0]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadRuns = React.useCallback(async () => {
    setRunsLoading(true);
    try {
      const data = await api.get<SubAgentRunDto[]>("subagents/runs?limit=100");
      setRuns(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRunsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  React.useEffect(() => {
    if (activeTab === "runs") {
      loadRuns();
    }
  }, [activeTab, loadRuns]);

  const handleSelectProfile = (p: SubAgentProfileDto) => {
    setSelectedId(p.id);
    setDraft({ ...p });
  };

  const handleCreateProfile = () => {
    const newProfile: SubAgentProfileDto = {
      id: "",
      name: "New Specialist",
      description: "",
      systemPrompt: "",
      modelId: null,
      enabled: true,
      tools: [],
      capabilities: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSelectedId("");
    setDraft(newProfile);
  };

  const handleSaveDraft = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("Profile name is required");
      return;
    }
    try {
      const saved = await api.post<SubAgentProfileDto>("subagents/profiles", draft);
      toast.success(t("settings:subagents.saved", "Sub-agent profile saved"));
      setSelectedId(saved.id);
      setDraft(saved);
      loadProfiles();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteProfile = async (id: string) => {
    if (!confirm(t("settings:subagents.confirm_delete", "Delete this sub-agent profile?"))) return;
    try {
      await api.delete(`subagents/profiles/${id}`);
      toast.success(t("settings:subagents.deleted", "Profile deleted"));
      const remaining = profiles.filter((p) => p.id !== id);
      setProfiles(remaining);
      if (remaining.length > 0) {
        setSelectedId(remaining[0].id);
        setDraft(remaining[0]);
      } else {
        setSelectedId("");
        setDraft(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCancelRun = async (runId: string) => {
    try {
      await api.post(`subagents/runs/${runId}/cancel`, {});
      toast.success(t("settings:subagents.cancelled", "Sub-agent run cancelled"));
      loadRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const allModels = React.useMemo(() => {
    const list: Array<{ id: string; name: string; providerName: string }> = [];
    for (const provider of settings.providers ?? []) {
      for (const m of provider.models ?? []) {
        list.push({
          id: m.id,
          name: m.displayName || m.modelId,
          providerName: provider.name,
        });
      }
    }
    return list;
  }, [settings.providers]);

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t("settings:subnav.extensions.subagents", "Sub-Agents Harness")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t(
              "settings:subagents.subtitle",
              "Manage specialist sub-agent profiles, granted capability boundaries, and execution runs.",
            )}
          </p>
        </div>
        <div className="flex rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => setActiveTab("profiles")}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              activeTab === "profiles"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("settings:subagents.tab_profiles", "Profiles")}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("runs")}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              activeTab === "runs"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("settings:subagents.tab_runs", "Active Runs")}
          </button>
        </div>
      </div>

      {activeTab === "profiles" ? (
        <SettingsSplit
          list={
            <div className="flex flex-col space-y-1">
              <SettingsListAddButton
                label={t("settings:subagents.new_profile", "New Sub-Agent")}
                onClick={handleCreateProfile}
              />
              {profiles.map((p, index) => (
                <SettingsListRow
                  key={p.id}
                  id={p.id}
                  index={index}
                  active={selectedId === p.id}
                  onSelect={() => handleSelectProfile(p)}
                  badge={
                    !p.enabled ? (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        Disabled
                      </Badge>
                    ) : undefined
                  }
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-xs">{p.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {p.description || "Specialist Agent"}
                    </div>
                  </div>
                </SettingsListRow>
              ))}
              {profiles.length === 0 && !loading && (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  {t("settings:subagents.empty_profiles", "No sub-agent profiles configured yet.")}
                </div>
              )}
            </div>
          }
        >
          {draft ? (
            <SettingsStack>
              <SettingsDetailHeader
                title={draft.name || "Untitled Sub-Agent"}
                description={draft.description || t("settings:subagents.detail_subtitle", "Sub-agent configuration")}
                action={
                  draft.id ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => handleDeleteProfile(draft.id)}
                      title={t("common:delete", "Delete")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null
                }
              />

              <SettingsGroup title={t("settings:subagents.general_title", "Identity & Prompt")}>
                <SettingsField label={t("settings:subagents.name_label", "Profile Name")}>
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="e.g. Code Auditor, Web Researcher"
                  />
                </SettingsField>

                <SettingsField label={t("settings:subagents.desc_label", "Description")}>
                  <Input
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder="Brief summary of when to delegate to this sub-agent"
                  />
                </SettingsField>

                <SettingsField label={t("settings:subagents.model_label", "Assigned Model")}>
                  <SubAgentModelPicker
                    value={draft.modelId}
                    onChange={(val) => setDraft({ ...draft, modelId: val })}
                    providers={settings.providers ?? []}
                  />
                </SettingsField>

                <SettingsField label={t("settings:subagents.enabled_label", "Enabled")}>
                  <Switch
                    checked={draft.enabled}
                    onCheckedChange={(val) => setDraft({ ...draft, enabled: val })}
                  />
                </SettingsField>

                <SettingsField label={t("settings:subagents.system_prompt_label", "Custom System Prompt")}>
                  <Textarea
                    rows={6}
                    value={draft.systemPrompt}
                    onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
                    placeholder="Leave blank to use the default isolated sub-agent system prompt."
                    className="font-mono text-xs"
                  />
                </SettingsField>
              </SettingsGroup>

              <SettingsGroup title={t("settings:subagents.capabilities_title", "Granted Capabilities")}>
                <p className="mb-2 text-xs text-muted-foreground">
                  {t(
                    "settings:subagents.caps_desc",
                    "Sub-agents operate in a restricted workspace sandbox by default. Grant opt-in capability suites below:",
                  )}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {AVAILABLE_CAPABILITIES.map((cap) => {
                    const isGranted = (draft.capabilities ?? []).includes(cap.id);
                    return (
                      <div
                        key={cap.id}
                        className="flex items-center justify-between rounded-lg border p-2.5 text-xs hover:bg-accent/40"
                      >
                        <span className="font-medium">{cap.label}</span>
                        <Switch
                          checked={isGranted}
                          onCheckedChange={(checked) => {
                            const current = new Set(draft.capabilities ?? []);
                            if (checked) current.add(cap.id);
                            else current.delete(cap.id);
                            setDraft({ ...draft, capabilities: Array.from(current) });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </SettingsGroup>

              <SettingsDetailFooter>
                <Button onClick={handleSaveDraft}>
                  {t("common:save", "Save Profile")}
                </Button>
              </SettingsDetailFooter>
            </SettingsStack>
          ) : (
            <SettingsEmpty>
              <div className="text-center text-xs text-muted-foreground">
                {t("settings:subagents.no_selected", "No sub-agent profile selected")}
              </div>
            </SettingsEmpty>
          )}
        </SettingsSplit>
      ) : (
        /* Runs Tab */
        <div className="flex flex-col space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {runs.length} {t("settings:subagents.runs_recorded", "runs recorded in ledger")}
            </span>
            <Button variant="outline" size="sm" onClick={loadRuns} disabled={runsLoading}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${runsLoading ? "animate-spin" : ""}`} />
              {t("common:refresh", "Refresh")}
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/50 font-medium text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">{t("settings:subagents.col_status", "Status")}</th>
                  <th className="px-3 py-2">{t("settings:subagents.col_label", "Label / Task")}</th>
                  <th className="px-3 py-2">{t("settings:subagents.col_mode", "Mode")}</th>
                  <th className="px-3 py-2">{t("settings:subagents.col_started", "Started")}</th>
                  <th className="px-3 py-2">{t("settings:subagents.col_actions", "Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {runs.map((r) => {
                  const isRunning = r.status === "pending" || r.status === "running";
                  return (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            r.status === "succeeded"
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : r.status === "running"
                              ? "bg-primary/15 text-primary animate-pulse"
                              : r.status === "failed" || r.status === "timed_out"
                              ? "bg-destructive/15 text-destructive"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {r.status === "succeeded" && <CheckCircle2 className="h-3 w-3" />}
                          {isRunning && <Clock className="h-3 w-3" />}
                          {(r.status === "failed" || r.status === "timed_out") && <AlertCircle className="h-3 w-3" />}
                          {r.status === "cancelled" && <Ban className="h-3 w-3" />}
                          {r.status}
                        </span>
                      </td>
                      <td className="max-w-xs truncate px-3 py-2.5 font-medium" title={r.task}>
                        {r.label || r.task}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {r.runInBackground ? "Background" : "Foreground"}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {new Date(r.startedAtMs).toLocaleTimeString()}
                      </td>
                      <td className="px-3 py-2.5">
                        {isRunning && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() => handleCancelRun(r.id)}
                          >
                            <Ban className="mr-1 h-3 w-3" />
                            {t("settings:subagents.cancel", "Cancel")}
                          </Button>
                        )}
                        {!isRunning && r.result && (
                          <span className="text-[11px] text-muted-foreground truncate max-w-[150px] inline-block">
                            {r.result.slice(0, 50)}...
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                      {t("settings:subagents.no_runs", "No sub-agent runs recorded yet.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
