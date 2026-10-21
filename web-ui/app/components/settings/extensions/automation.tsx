// components/settings/extensions/automation.tsx — Settings > Extensions > Automation & Cron
// Ported from rikkahub-agent (Pyth0nkod3r fork) ScheduledJob / Workflow Engine

import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Play,
  RefreshCw,
  Trash2,
  Workflow as WorkflowIcon,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
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

export interface ScheduledJobDto {
  id: string;
  name: string;
  description?: string;
  assistantId: string;
  mode: "llm" | "direct";
  scheduleType: "once" | "cron" | "interval";
  prompt?: string;
  actions?: Array<{ tool: string; args: Record<string, unknown> }>;
  cronExpression?: string;
  atUnixMs?: number;
  intervalMs?: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
}

export interface ScheduledJobRunDto {
  id: string;
  jobId: string;
  status: "running" | "success" | "failed" | "timed_out" | "skipped";
  startedAt: number;
  finishedAt?: number;
  output?: string;
  error?: string;
  conversationId?: string;
}

export interface WorkflowDto {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  trigger: { type: string; params?: Record<string, unknown> };
  conditions?: Array<{ type: string; params?: Record<string, unknown>; invert?: boolean }>;
  actions: Array<{ tool: string; args: Record<string, unknown> }>;
  cooldownSeconds?: number;
  lastFiredAt?: number;
}

export function AutomationSection() {
  const { t } = useTranslation("settings");
  const [activeTab, setActiveTab] = React.useState<"jobs" | "history" | "workflows">("jobs");

  const [jobs, setJobs] = React.useState<ScheduledJobDto[]>([]);
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [runs, setRuns] = React.useState<ScheduledJobRunDto[]>([]);
  const [workflows, setWorkflows] = React.useState<WorkflowDto[]>([]);
  const [loading, setLoading] = React.useState(false);

  // Edit draft for scheduled job
  const [draft, setDraft] = React.useState<Partial<ScheduledJobDto>>({
    name: "",
    description: "",
    mode: "llm",
    scheduleType: "cron",
    cronExpression: "0 9 * * *",
    prompt: "",
    enabled: true,
  });

  const loadJobs = React.useCallback(async () => {
    try {
      const data = await api.get<{ jobs: ScheduledJobDto[] }>("automation/jobs");
      setJobs(data?.jobs || []);
    } catch {
      // Ignore
    }
  }, []);

  const loadRuns = React.useCallback(async () => {
    try {
      const data = await api.get<{ runs: ScheduledJobRunDto[] }>("automation/runs");
      setRuns(data?.runs || []);
    } catch {
      // Ignore
    }
  }, []);

  const loadWorkflows = React.useCallback(async () => {
    try {
      const data = await api.get<{ workflows: WorkflowDto[] }>("automation/workflows");
      setWorkflows(data?.workflows || []);
    } catch {
      // Ignore
    }
  }, []);

  const refreshAll = React.useCallback(async () => {
    setLoading(true);
    await Promise.all([loadJobs(), loadRuns(), loadWorkflows()]);
    setLoading(false);
  }, [loadJobs, loadRuns, loadWorkflows]);

  React.useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // Select job
  const selectJob = (job: ScheduledJobDto) => {
    setSelectedJobId(job.id);
    setDraft({ ...job });
  };

  const createNewJob = () => {
    setSelectedJobId(null);
    setDraft({
      name: "",
      description: "",
      mode: "llm",
      scheduleType: "cron",
      cronExpression: "0 9 * * *",
      prompt: "",
      enabled: true,
    });
  };

  const saveJob = async () => {
    if (!draft.name?.trim()) {
      toast.error(t("settings:automation.name_required", "Job name is required"));
      return;
    }

    try {
      if (selectedJobId) {
        // Update existing job by creating replacement or patching
        await api.delete(`automation/jobs/${selectedJobId}`);
      }

      const res = await api.post<{ job: ScheduledJobDto }>("automation/jobs", {
        name: draft.name.trim(),
        description: draft.description?.trim() || undefined,
        mode: draft.mode || "llm",
        scheduleType: draft.scheduleType || "cron",
        cronExpression: draft.cronExpression || undefined,
        prompt: draft.prompt || undefined,
      });

      toast.success(t("settings:automation.saved", "Scheduled job saved successfully"));
      await loadJobs();
      if (res?.job) selectJob(res.job);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const deleteJob = async (id: string) => {
    if (!confirm(t("settings:automation.confirm_delete", "Delete this scheduled job?"))) return;
    try {
      await api.delete(`automation/jobs/${id}`);
      toast.success(t("settings:automation.deleted", "Scheduled job deleted"));
      if (selectedJobId === id) createNewJob();
      await loadJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const runJobNow = async (id: string) => {
    try {
      toast.info(t("settings:automation.triggering", "Triggering scheduled job..."));
      await api.post(`automation/jobs/${id}/run`, {});
      toast.success(t("settings:automation.triggered", "Job executed"));
      await loadRuns();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const togglePause = async (job: ScheduledJobDto) => {
    try {
      if (job.enabled) {
        await api.post(`automation/jobs/${job.id}/pause`, {});
      } else {
        await api.post(`automation/jobs/${job.id}/resume`, {});
      }
      await loadJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const runWorkflowNow = async (id: string) => {
    try {
      toast.info(t("settings:automation.triggering_workflow", "Triggering workflow..."));
      await api.post(`automation/workflows/${id}/run`, {});
      toast.success(t("settings:automation.workflow_triggered", "Workflow executed"));
      await loadWorkflows();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* Header */}
      <div className="p-4 border-b border-[var(--ds-border-subtle)] flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Clock className="size-5 text-primary" />
            {t("subnav.extensions.automation", "Automation & Cron Jobs")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("settings:automation.subtitle", "Schedule autonomous recurring tasks, one-shot timers, and event workflows")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void refreshAll()} disabled={loading}>
            <RefreshCw className={cn("size-4 mr-1", loading && "animate-spin")} />
            {t("common.refresh", "Refresh")}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--ds-border-subtle)] px-4 gap-4 bg-[var(--ds-surface-secondary)] text-sm">
        <button
          type="button"
          onClick={() => setActiveTab("jobs")}
          className={cn(
            "py-2.5 font-medium border-b-2 transition-colors",
            activeTab === "jobs"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t("settings:automation.tab_jobs", "Scheduled Jobs")} ({jobs.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={cn(
            "py-2.5 font-medium border-b-2 transition-colors",
            activeTab === "history"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t("settings:automation.tab_runs", "Run History")} ({runs.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("workflows")}
          className={cn(
            "py-2.5 font-medium border-b-2 transition-colors",
            activeTab === "workflows"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t("settings:automation.tab_workflows", "Workflows")} ({workflows.length})
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {activeTab === "jobs" ? (
          <SettingsSplit
            list={
              <SettingsStack>
                <SettingsListAddButton
                  label={t("settings:automation.new_job", "New Scheduled Job")}
                  onClick={createNewJob}
                />
                {jobs.map((job, index) => (
                  <SettingsListRow
                    key={job.id}
                    id={job.id}
                    index={index}
                    active={selectedJobId === job.id}
                    onSelect={() => selectJob(job)}
                    badge={
                      <div className="flex items-center gap-1.5">
                        <Badge variant={job.enabled ? "default" : "secondary"} className="text-[10px]">
                          {job.enabled ? t("settings:automation.active", "Active") : t("settings:automation.paused", "Paused")}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {job.mode}
                        </Badge>
                      </div>
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-xs">{job.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {job.cronExpression || (job.atUnixMs ? new Date(job.atUnixMs).toLocaleString() : "")}
                      </div>
                    </div>
                  </SettingsListRow>
                ))}
                {jobs.length === 0 ? (
                  <SettingsEmpty>
                    {t("settings:automation.empty_jobs", "No scheduled automation jobs configured yet.")}
                  </SettingsEmpty>
                ) : null}
              </SettingsStack>
            }
          >
            <div className="flex h-full flex-col justify-between">
                <div>
                  <SettingsDetailHeader
                    title={draft.name || t("settings:automation.untitled_job", "Untitled Scheduled Job")}
                    description={draft.description || t("settings:automation.job_config_desc", "Recurring job configuration")}
                  />

                  <div className="p-4 space-y-4">
                    <SettingsGroup title={t("settings:automation.general_title", "Job Identity & Timing")}>
                      <SettingsField label={t("settings:automation.name_label", "Job Name")}>
                        <Input
                          value={draft.name || ""}
                          placeholder={t("settings:automation.name_placeholder", "e.g. Daily Standup Prep")}
                          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                        />
                      </SettingsField>

                      <SettingsField label={t("settings:automation.desc_label", "Description")}>
                        <Input
                          value={draft.description || ""}
                          placeholder={t("settings:automation.desc_placeholder", "Optional notes on task purpose")}
                          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                        />
                      </SettingsField>

                      <SettingsField label={t("settings:automation.mode_label", "Execution Mode")}>
                        <Select
                          value={draft.mode || "llm"}
                          onValueChange={(val) => setDraft((d) => ({ ...d, mode: val as "llm" | "direct" }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="llm">
                              <div className="flex items-center gap-2">
                                <Zap className="size-4 text-amber-500" />
                                <span>{t("settings:automation.mode_llm", "LLM Reasoning (Sends Prompt to Assistant)")}</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="direct">
                              <div className="flex items-center gap-2">
                                <Calendar className="size-4 text-blue-500" />
                                <span>{t("settings:automation.mode_direct", "Direct Tool Actions (Deterministic)")}</span>
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </SettingsField>

                      <SettingsField label={t("settings:automation.schedule_type_label", "Schedule Type")}>
                        <Select
                          value={draft.scheduleType || "cron"}
                          onValueChange={(val) => setDraft((d) => ({ ...d, scheduleType: val as "cron" | "once" }))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cron">{t("settings:automation.type_cron", "Cron Expression (@daily, 0 9 * * *)")}</SelectItem>
                            <SelectItem value="once">{t("settings:automation.type_once", "One-Shot Timer (Timestamp)")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </SettingsField>

                      {draft.scheduleType === "cron" ? (
                        <SettingsField label={t("settings:automation.cron_label", "Cron Expression")}>
                          <Input
                            value={draft.cronExpression || ""}
                            placeholder="0 9 * * MON-FRI, @daily, @hourly, @every 30m"
                            className="font-mono text-xs"
                            onChange={(e) => setDraft((d) => ({ ...d, cronExpression: e.target.value }))}
                          />
                        </SettingsField>
                      ) : null}

                      <SettingsField label={t("settings:automation.enabled_label", "Enabled / Active")}>
                        <Switch
                          checked={draft.enabled ?? true}
                          onCheckedChange={(checked) => setDraft((d) => ({ ...d, enabled: checked }))}
                        />
                      </SettingsField>
                    </SettingsGroup>

                    {draft.mode === "llm" ? (
                      <SettingsGroup title={t("settings:automation.prompt_title", "Prompt & Task Instructions")}>
                        <Textarea
                          value={draft.prompt || ""}
                          placeholder={t("settings:automation.prompt_placeholder", "Enter instructions for the AI model to execute when the schedule triggers...")}
                          rows={4}
                          className="font-mono text-xs"
                          onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
                        />
                      </SettingsGroup>
                    ) : null}
                  </div>
                </div>

                <SettingsDetailFooter>
                  <div className="flex items-center gap-2">
                    {selectedJobId ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const cur = jobs.find((j) => j.id === selectedJobId);
                            if (cur) void togglePause(cur);
                          }}
                        >
                          {draft.enabled ? t("settings:automation.pause", "Pause") : t("settings:automation.resume", "Resume")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void runJobNow(selectedJobId)}
                        >
                          <Play className="size-3.5 mr-1 text-primary" />
                          {t("settings:automation.run_now", "Run Now")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void deleteJob(selectedJobId)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                  <Button onClick={() => void saveJob()}>
                    {t("common.save", "Save")}
                  </Button>
                </SettingsDetailFooter>
              </div>
          </SettingsSplit>
        ) : null}

        {activeTab === "history" ? (
          <div className="p-4 space-y-2">
            <div className="text-xs text-muted-foreground pb-2">
              {runs.length} {t("settings:automation.runs_recorded", "execution runs recorded")}
            </div>

            <div className="rounded border border-[var(--ds-border-subtle)] overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--ds-surface-secondary)] text-[var(--ds-text-secondary)] border-b border-[var(--ds-border-subtle)]">
                  <tr>
                    <th className="px-3 py-2">{t("settings:automation.col_status", "Status")}</th>
                    <th className="px-3 py-2">{t("settings:automation.col_job", "Job ID")}</th>
                    <th className="px-3 py-2">{t("settings:automation.col_started", "Started")}</th>
                    <th className="px-3 py-2">{t("settings:automation.col_output", "Output / Error")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ds-border-subtle)]">
                  {runs.map((r) => {
                    const isSuccess = r.status === "success";
                    const isRunning = r.status === "running";
                    return (
                      <tr key={r.id} className="hover:bg-[var(--ds-on-surface)] transition-colors">
                        <td className="px-3 py-2.5">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium",
                              isSuccess && "bg-emerald-500/10 text-emerald-500",
                              isRunning && "bg-blue-500/10 text-blue-500",
                              !isSuccess && !isRunning && "bg-rose-500/10 text-rose-500",
                            )}
                          >
                            {isSuccess ? <CheckCircle2 className="size-3" /> : isRunning ? <RefreshCw className="size-3 animate-spin" /> : <AlertCircle className="size-3" />}
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                          {r.jobId.slice(0, 8)}...
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {new Date(r.startedAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 max-w-md truncate">
                          {r.error ? (
                            <span className="text-destructive font-mono">{r.error}</span>
                          ) : (
                            <span className="text-muted-foreground">{r.output || "Completed"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {runs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                        {t("settings:automation.no_runs", "No execution history recorded yet.")}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === "workflows" ? (
          <div className="p-4 space-y-4">
            <div className="text-xs text-muted-foreground">
              {workflows.length} {t("settings:automation.workflows_count", "event-driven workflows")}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {workflows.map((wf) => (
                <div
                  key={wf.id}
                  className="rounded-lg border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-secondary)] p-4 flex flex-col justify-between space-y-3"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm flex items-center gap-1.5">
                        <WorkflowIcon className="size-4 text-primary" />
                        {wf.name}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {wf.trigger.type}
                      </Badge>
                    </div>
                    {wf.description ? (
                      <p className="text-xs text-muted-foreground mt-1">{wf.description}</p>
                    ) : null}
                    <div className="text-[11px] text-muted-foreground mt-2">
                      {wf.actions.length} {t("settings:automation.action_count", "tool action(s)")}
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--ds-border-subtle)]">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runWorkflowNow(wf.id)}
                    >
                      <Play className="size-3.5 mr-1 text-primary" />
                      {t("settings:automation.run_now", "Run Now")}
                    </Button>
                  </div>
                </div>
              ))}
              {workflows.length === 0 ? (
                <div className="col-span-full py-12 text-center text-muted-foreground text-sm">
                  {t("settings:automation.no_workflows", "No workflows created yet. Workflows can be authored via the workflow_create tool or API.")}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
