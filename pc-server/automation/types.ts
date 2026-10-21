export type ScheduleType = "once" | "cron" | "interval";
export type AutomationMode = "llm" | "direct";
export type CatchupPolicy = "skip" | "fire_once" | "fire_all";
export type JobRunStatus = "running" | "success" | "failed" | "timed_out" | "skipped";

export interface ScheduledJobAction {
  tool: string;
  args: Record<string, unknown>;
  timeoutSeconds?: number;
}

export interface ScheduledJob {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  assistantId: string;
  mode: AutomationMode;
  scheduleType: ScheduleType;
  prompt?: string;
  actions?: ScheduledJobAction[];
  cronExpression?: string;
  atUnixMs?: number;
  intervalMs?: number;
  timezone?: string;
  startAtUnixMs?: number;
  endAtUnixMs?: number;
  maxRuns?: number;
  catchup?: CatchupPolicy;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
}

export interface ScheduledJobRun {
  id: string;
  jobId: string;
  status: JobRunStatus;
  startedAt: number;
  finishedAt?: number;
  output?: string;
  error?: string;
  conversationId?: string;
}

export interface WorkflowCondition {
  type: string;
  params?: Record<string, unknown>;
  invert?: boolean;
}

export interface WorkflowTrigger {
  type: string;
  params?: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  authoringAssistantId?: string;
  enabled: boolean;
  trigger: WorkflowTrigger;
  conditions?: WorkflowCondition[];
  actions: ScheduledJobAction[];
  cooldownSeconds?: number;
  maxRunsPerDay?: number;
  lastFiredAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: JobRunStatus;
  startedAt: number;
  finishedAt?: number;
  results?: Array<{ tool: string; success: boolean; output?: string; error?: string }>;
}
