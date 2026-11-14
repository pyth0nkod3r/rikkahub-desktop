// workspace/command-watchdog.ts — Non-destructive command watchdog & verdict-before-kill
// Adopted from Agent-2 architecture (agent2/core/commands.py & procio.py)

export type CommandVerdict = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";

export interface ActiveCommandRecord {
  id: string;
  command: string;
  workspacePath?: string;
  startedAtMs: number;
  lastOutputAtMs: number;
  isStuck: boolean;
  verdict: CommandVerdict;
  exitCode: number | null;
  pid?: number;
}

export type StuckEventListener = (cmd: ActiveCommandRecord) => void;

export class CommandWatchdog {
  private active = new Map<string, ActiveCommandRecord>();
  private stuckThresholdMs: number;
  private timer: NodeJS.Timeout | null = null;
  private listeners: Set<StuckEventListener> = new Set();

  constructor(stuckThresholdMs = 20000) {
    this.stuckThresholdMs = stuckThresholdMs;
  }

  startWatchdog(intervalMs = 3000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.checkHeartbeats(), intervalMs);
  }

  stopWatchdog(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  onStuck(listener: StuckEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  registerCommand(id: string, command: string, workspacePath?: string, pid?: number): ActiveCommandRecord {
    const now = Date.now();
    const record: ActiveCommandRecord = {
      id,
      command,
      workspacePath,
      startedAtMs: now,
      lastOutputAtMs: now,
      isStuck: false,
      verdict: "RUNNING",
      exitCode: null,
      pid,
    };
    this.active.set(id, record);
    return record;
  }

  recordHeartbeat(id: string): void {
    const record = this.active.get(id);
    if (record && record.verdict === "RUNNING") {
      record.lastOutputAtMs = Date.now();
      record.isStuck = false;
    }
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    for (const record of this.active.values()) {
      if (record.verdict === "RUNNING" && !record.isStuck) {
        if (now - record.lastOutputAtMs >= this.stuckThresholdMs) {
          record.isStuck = true;
          for (const listener of this.listeners) {
            try {
              listener(record);
            } catch (e) {
              console.warn("[CommandWatchdog] Listener error:", e);
            }
          }
        }
      }
    }
  }

  /**
   * Pre-records verdict BEFORE OS process termination to prevent SIGKILL / taskkill exit codes
   * from masking true intent.
   */
  recordVerdictBeforeKill(id: string, verdict: "CANCELLED" | "TIMED_OUT"): ActiveCommandRecord | null {
    const record = this.active.get(id);
    if (!record) return null;
    record.verdict = verdict;
    return record;
  }

  completeCommand(id: string, exitCode: number): ActiveCommandRecord | null {
    const record = this.active.get(id);
    if (!record) return null;
    if (record.verdict === "RUNNING") {
      record.verdict = exitCode === 0 ? "COMPLETED" : "FAILED";
    }
    record.exitCode = exitCode;
    record.isStuck = false;
    return record;
  }

  getCommand(id: string): ActiveCommandRecord | null {
    return this.active.get(id) ?? null;
  }

  listActive(): ActiveCommandRecord[] {
    return Array.from(this.active.values()).filter((c) => c.verdict === "RUNNING");
  }
}

export const commandWatchdog = new CommandWatchdog();
