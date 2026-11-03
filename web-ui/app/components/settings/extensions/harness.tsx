import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Bot,
  ChevronRight,
  Clock,
  Compass,
  Cpu,
  FileCode,
  FolderGit2,
  Layers,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  SettingsGroup,
  SettingsRow,
  SettingsRows,
  SettingsStack,
  SettingsSwitchRow,
} from "~/components/settings/shared";
import { saveDisplayPatch } from "~/lib/settings-patch";
import { useSettingsStore } from "~/stores/app-store";
import type { Settings } from "~/types";

interface PageProps {
  settings: Settings;
  onSettings: (settings: Settings) => void;
}

export function AgentHarnessSection({ settings }: PageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const display = settings?.displaySetting ?? {};

  // 1. Subagent settings
  const subagentHubThreshold =
    typeof display.subagentHubThreshold === "number" ? display.subagentHubThreshold : 2;
  const showSubagentHubTokens = display.showSubagentHubTokens !== false;
  const enableWorktreeIsolation = display.enableWorktreeIsolation !== false;
  const subagentDefaultMaxTrips =
    typeof display.subagentDefaultMaxTrips === "number" ? display.subagentDefaultMaxTrips : 12;
  const subagentDefaultTimeoutSeconds =
    typeof display.subagentDefaultTimeoutSeconds === "number"
      ? display.subagentDefaultTimeoutSeconds
      : 180;
  const enableModelFallbackCascade = display.enableModelFallbackCascade !== false;

  // 2. Conversation & Streaming
  const showLiveThinkingTimer = display.showLiveThinkingTimer !== false;
  const autoCollapseThinkingOnOutput = display.autoCollapseThinkingOnOutput !== false;
  const enableThinkingSyntaxHighlighting = display.enableThinkingSyntaxHighlighting !== false;
  const enableMidStreamSteering = display.enableMidStreamSteering !== false;
  const showCompactionDividers = display.showCompactionDividers !== false;

  // 3. Workspace, Terminal & Tools
  const enableWriteDiffViewer = display.enableWriteDiffViewer !== false;
  const terminalFoldLines =
    typeof display.terminalFoldLines === "number" ? display.terminalFoldLines : 30;
  const enableFileMentionAutocomplete = display.enableFileMentionAutocomplete !== false;
  const enableSlashCommandMenu = display.enableSlashCommandMenu !== false;
  const enableFloatingQuickDock = display.enableFloatingQuickDock !== false;

  // 4. Resiliency & Discovery
  const streamWatchdogTimeoutSeconds =
    typeof display.streamWatchdogTimeoutSeconds === "number"
      ? display.streamWatchdogTimeoutSeconds
      : 120;
  const enableContextAutoDiscovery = display.enableContextAutoDiscovery !== false;

  const handlePatch = async (patch: Record<string, unknown>) => {
    try {
      await saveDisplayPatch(patch);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleResetDefaults = async () => {
    if (!window.confirm(t("settings:harness.reset_defaults_confirm", "Reset all Agent Harness and Ergonomics preferences to recommended defaults?"))) {
      return;
    }
    const defaults = {
      subagentHubThreshold: 2,
      showSubagentHubTokens: true,
      enableWorktreeIsolation: true,
      subagentDefaultMaxTrips: 12,
      subagentDefaultTimeoutSeconds: 180,
      enableModelFallbackCascade: true,
      showLiveThinkingTimer: true,
      autoCollapseThinkingOnOutput: true,
      enableThinkingSyntaxHighlighting: true,
      enableMidStreamSteering: true,
      showCompactionDividers: true,
      enableWriteDiffViewer: true,
      terminalFoldLines: 30,
      enableFileMentionAutocomplete: true,
      enableSlashCommandMenu: true,
      enableFloatingQuickDock: true,
      streamWatchdogTimeoutSeconds: 120,
      enableContextAutoDiscovery: true,
    };
    await handlePatch(defaults);
    toast.success(t("settings:harness.reset_success", "Harness settings reset to defaults"));
  };

  return (
    <SettingsStack>
      {/* Header & Quick Reset */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ds-divider)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Zap className="h-4 w-4" />
            </div>
            <h1 className="text-base font-semibold text-[var(--ds-text-primary)]">
              {t("settings:harness.title", "Agent Harness & Ergonomics")}
            </h1>
          </div>
          <p className="mt-1 text-xs text-[var(--ds-text-secondary)]">
            {t("settings:harness.subtitle", "Fine-tune subagent topology, streaming disclosures, and desktop ergonomics")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleResetDefaults}
          className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>{t("settings:harness.reset_defaults", "Reset Defaults")}</span>
        </Button>
      </div>

      {/* Group 1: Subagent Orchestration & Topology */}
      <SettingsGroup
        title={t("settings:harness.group_subagents", "Subagent Orchestration & Topology")}
        description={t("settings:harness.subagents_desc", "Control how parallel subagents are dispatched, clustered, and bounded")}
      >
        <SettingsRows>
          <SettingsRow
            label={t("settings:harness.hub_threshold_title", "Top Tab Strip Auto-Collapse Threshold")}
            description={t("settings:harness.hub_threshold_desc", "Automatically collapse subagents into a compact header drawer when the count exceeds this threshold")}
            control={
              <Select
                value={String(subagentHubThreshold)}
                onValueChange={(val) => handlePatch({ subagentHubThreshold: Number(val) })}
              >
                <SelectTrigger className="w-36 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 subagent</SelectItem>
                  <SelectItem value="2">2 (Default)</SelectItem>
                  <SelectItem value="3">3 subagents</SelectItem>
                  <SelectItem value="5">5 subagents</SelectItem>
                  <SelectItem value="0">Never collapse</SelectItem>
                </SelectContent>
              </Select>
            }
          />

          <SettingsSwitchRow
            label={t("settings:harness.hub_tokens_title", "Show Real-Time Token Gauges")}
            description={t("settings:harness.hub_tokens_desc", "Display real-time token consumption badges and active model indicators on subagent cards and tabs")}
            checked={showSubagentHubTokens}
            onCheckedChange={(checked) => handlePatch({ showSubagentHubTokens: checked })}
          />

          <SettingsSwitchRow
            label={t("settings:harness.worktree_isolation_title", "Git Worktree Branch Isolation")}
            description={t("settings:harness.worktree_isolation_desc", "Execute subagent filesystem operations in isolated temporary worktrees (.rikkahub-worktrees/) to prevent concurrent edit collisions")}
            checked={enableWorktreeIsolation}
            onCheckedChange={(checked) => handlePatch({ enableWorktreeIsolation: checked })}
          />

          <SettingsRow
            label={t("settings:harness.max_trips_title", "Subagent Max Steps (Trip Limit)")}
            description={t("settings:harness.max_trips_desc", "Maximum conversation turns permitted before terminating a runaway subagent run (default: 12)")}
            control={
              <Input
                type="number"
                min={1}
                max={30}
                className="w-24 h-8 text-xs"
                value={subagentDefaultMaxTrips}
                onChange={(e) => {
                  const val = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(val) && val >= 1 && val <= 30) {
                    handlePatch({ subagentDefaultMaxTrips: val });
                  }
                }}
              />
            }
          />

          <SettingsRow
            label={t("settings:harness.timeout_title", "Subagent Timeout (Seconds)")}
            description={t("settings:harness.timeout_desc", "Maximum wall-clock seconds before auto-terminating a subagent run (default: 180s)")}
            control={
              <Input
                type="number"
                min={10}
                max={1800}
                step={10}
                className="w-24 h-8 text-xs"
                value={subagentDefaultTimeoutSeconds}
                onChange={(e) => {
                  const val = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(val) && val >= 10) {
                    handlePatch({ subagentDefaultTimeoutSeconds: val });
                  }
                }}
              />
            }
          />

          <SettingsSwitchRow
            label={t("settings:harness.model_fallback_title", "Automatic Model Fallback Cascades")}
            description={t("settings:harness.model_fallback_desc", "Automatically fallback to configured fast or chat models when encountering rate limits (HTTP 429), server overloads (HTTP 503), or network timeouts")}
            checked={enableModelFallbackCascade}
            onCheckedChange={(checked) => handlePatch({ enableModelFallbackCascade: checked })}
          />
        </SettingsRows>
      </SettingsGroup>

      {/* Group 2: Conversation Flow & Streaming Experience */}
      <SettingsGroup
        title={t("settings:harness.group_streaming", "Conversation Flow & Streaming Experience")}
        description={t("settings:harness.streaming_desc", "Configure reasoning disclosure, mid-stream steering, and context compaction dividers")}
      >
        <SettingsRows>
          <SettingsSwitchRow
            label={t("settings:harness.thinking_timer_title", "Live Reasoning Indicator & Elapsed Timer")}
            description={t("settings:harness.thinking_timer_desc", "Show an animated timer with glowing border while the reasoning model streams internal thought tokens")}
            checked={showLiveThinkingTimer}
            onCheckedChange={(checked) => handlePatch({ showLiveThinkingTimer: checked })}
          />

          <SettingsSwitchRow
            label={t("settings:harness.thinking_autocollapse_title", "Auto-Collapse Thinking on First Output Token")}
            description={t("settings:harness.thinking_autocollapse_desc", "Automatically collapse internal reasoning blocks when the model emits its first visible answer text or tool call")}
            checked={autoCollapseThinkingOnOutput}
            onCheckedChange={(checked) => handlePatch({ autoCollapseThinkingOnOutput: checked })}
          />

          <SettingsSwitchRow
            label={t("settings:harness.thinking_syntax_title", "Reasoning Pane Syntax Highlighting")}
            description={t("settings:harness.thinking_syntax_desc", "Enable markdown and syntax highlighting inside expanded reasoning disclosure panels")}
            checked={enableThinkingSyntaxHighlighting}
            onCheckedChange={(checked) => handlePatch({ enableThinkingSyntaxHighlighting: checked })}
          />

          <SettingsSwitchRow
            label={t("settings:harness.midstream_steer_title", "Mid-Stream Steering UI")}
            description={t("settings:harness.midstream_steer_desc", "Show 'Steer active agent' button and inject steer messages seamlessly into running generation turns")}
            checked={enableMidStreamSteering}
            onCheckedChange={(checked) => handlePatch({ enableMidStreamSteering: checked })}
          />

          <SettingsSwitchRow
            label={t("settings:harness.compaction_dividers_title", "Visual Context Compaction Dividers")}
            description={t("settings:harness.compaction_dividers_desc", "Insert clean timeline dividers with inspectable summary drawers when conversation history auto-compacts")}
            checked={showCompactionDividers}
            onCheckedChange={(checked) => handlePatch({ showCompactionDividers: checked })}
          />
        </SettingsRows>
      </SettingsGroup>

      {/* Group 3: Workspace, Terminal & Tool Ergonomics */}
      <SettingsGroup
        title={t("settings:harness.group_workspace", "Workspace, Terminal & Tool Ergonomics")}
        description={t("settings:harness.workspace_desc", "Configure interactive approvals, file write diffs, terminal folding, and productivity popups")}
      >
        <SettingsRows>
          <SettingsSwitchRow
            label={t("settings:harness.write_diff_title", "Syntax-Highlighted Unified Diff Viewer")}
            description={t("settings:harness.write_diff_desc", "Display color-coded unified diffs showing additions and deletions for write and patch file modifications")}
            checked={enableWriteDiffViewer}
            onCheckedChange={(checked) => handlePatch({ enableWriteDiffViewer: checked })}
          />

          <SettingsRow
            label={t("settings:harness.terminal_fold_title", "Terminal Output Auto-Folding (Line Limit)")}
            description={t("settings:harness.terminal_fold_desc", "Automatically fold terminal / bash execution output exceeding this line limit (default: 30 lines)")}
            control={
              <Input
                type="number"
                min={5}
                max={500}
                className="w-24 h-8 text-xs"
                value={terminalFoldLines}
                onChange={(e) => {
                  const val = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(val) && val >= 5) {
                    handlePatch({ terminalFoldLines: val });
                  }
                }}
              />
            }
          />

          <SettingsSwitchRow
            label={t("settings:harness.file_mention_title", "Workspace File Autocomplete (@ Mention)")}
            description={t("settings:harness.file_mention_desc", "Show instant file search popup when typing '@' in the chat input bar")}
            checked={enableFileMentionAutocomplete}
            onCheckedChange={(checked) => handlePatch({ enableFileMentionAutocomplete: checked })}
          />

          <SettingsSwitchRow
            label={t("settings:harness.slash_command_title", "Slash Command Menu (/ Triggers)")}
            description={t("settings:harness.slash_command_desc", "Show slash command helper popup when typing '/' at the beginning of the input bar")}
            checked={enableSlashCommandMenu}
            onCheckedChange={(checked) => handlePatch({ enableSlashCommandMenu: checked })}
          />

          <SettingsSwitchRow
            label={t("settings:harness.floating_dock_title", "Floating Quick Action Dock")}
            description={t("settings:harness.floating_dock_desc", "Render quick action buttons and helper pills directly above the chat composer")}
            checked={enableFloatingQuickDock}
            onCheckedChange={(checked) => handlePatch({ enableFloatingQuickDock: checked })}
          />
        </SettingsRows>
      </SettingsGroup>

      {/* Group 4: Resiliency & Upstream Discovery */}
      <SettingsGroup
        title={t("settings:harness.group_resiliency", "Resiliency & Dynamic Upstream Discovery")}
        description={t("settings:harness.resiliency_desc", "Background connection watchdogs and context limits auto-discovery")}
      >
        <SettingsRows>
          <SettingsRow
            label={t("settings:harness.watchdog_title", "Inactivity Stream Watchdog Timeout (Seconds)")}
            description={t("settings:harness.watchdog_desc", "Abort and retry stalled streams if no tokens are received within this period (default: 120s, 0 to disable)")}
            control={
              <Input
                type="number"
                min={0}
                max={600}
                step={10}
                className="w-24 h-8 text-xs"
                value={streamWatchdogTimeoutSeconds}
                onChange={(e) => {
                  const val = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(val) && val >= 0) {
                    handlePatch({ streamWatchdogTimeoutSeconds: val });
                  }
                }}
              />
            }
          />

          <SettingsSwitchRow
            label={t("settings:harness.context_discovery_title", "Dynamic Upstream Context Auto-Discovery")}
            description={t("settings:harness.context_discovery_desc", "Capture upstream provider response headers (x-context-length) at runtime to adapt context thresholds automatically")}
            checked={enableContextAutoDiscovery}
            onCheckedChange={(checked) => handlePatch({ enableContextAutoDiscovery: checked })}
          />
        </SettingsRows>
      </SettingsGroup>

      {/* Navigation Quick Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
        <button
          type="button"
          onClick={() => navigate("/settings?section=extensions&sub=subagents")}
          className="flex items-center justify-between p-3 rounded-xl border border-border/70 bg-card hover:bg-accent/40 text-left transition-colors group"
        >
          <div className="flex items-center gap-2.5">
            <Bot className="h-4 w-4 text-primary" />
            <div>
              <div className="text-xs font-semibold text-foreground">
                {t("settings:harness.open_subagents_profiles", "Manage Specialist Subagent Profiles")}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Configure roles, system prompts & granted tool sets
              </div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
        </button>

        <button
          type="button"
          onClick={() => navigate("/settings?section=extensions&sub=workspace")}
          className="flex items-center justify-between p-3 rounded-xl border border-border/70 bg-card hover:bg-accent/40 text-left transition-colors group"
        >
          <div className="flex items-center gap-2.5">
            <FolderGit2 className="h-4 w-4 text-primary" />
            <div>
              <div className="text-xs font-semibold text-foreground">
                {t("settings:harness.open_workspace_settings", "Manage Workspaces & Shell Sandboxes")}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Project directories, Docker & WSL permissions
              </div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>
    </SettingsStack>
  );
}
