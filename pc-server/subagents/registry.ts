// subagents/registry.ts — In-Memory Store & Job Lifecycle Manager for SubAgent Runs
// Ported from rikkahub-agent (Pyth0nkod3r fork) SubAgentRegistry.kt

import { SubAgentDefaults, type SubAgentRun } from "./types";
import { getSubAgentRun, insertSubAgentRun, listSubAgentRuns, updateSubAgentRun } from "./db";

export class SubAgentRegistry {
  private runs = new Map<string, SubAgentRun>();
  private activeControllers = new Map<string, AbortController>();

  constructor() {
    // Warm up from database recent runs
    try {
      const recent = listSubAgentRuns({ limit: SubAgentDefaults.REGISTRY_LRU_CAP });
      for (const run of recent) {
        this.runs.set(run.id, run);
      }
    } catch {
      // In-memory fallback if DB not open yet
    }
  }

  addPending(run: SubAgentRun, controller?: AbortController): void {
    this.pruneIfNeeded();
    this.runs.set(run.id, run);
    if (controller) {
      this.activeControllers.set(run.id, controller);
    }
    try {
      insertSubAgentRun(run);
    } catch (err) {
      // Best-effort DB persistence
    }
  }

  update(id: string, transform: (existing: SubAgentRun) => SubAgentRun): SubAgentRun | null {
    const existing = this.runs.get(id) ?? getSubAgentRun(id);
    if (!existing) return null;
    const updated = transform(existing);
    this.runs.set(id, updated);
    try {
      updateSubAgentRun(updated);
    } catch {
      // Best-effort
    }
    return updated;
  }

  setJob(id: string, controller: AbortController): void {
    this.activeControllers.set(id, controller);
  }

  clearJob(id: string): void {
    this.activeControllers.delete(id);
  }

  get(id: string): SubAgentRun | null {
    return this.runs.get(id) ?? getSubAgentRun(id);
  }

  list(activeOnly: boolean = false): SubAgentRun[] {
    const all = Array.from(this.runs.values());
    if (activeOnly) {
      return all.filter((r) => r.status === "pending" || r.status === "running");
    }
    return all.sort((a, b) => b.startedAtMs - a.startedAtMs);
  }

  activeCountForAssistant(parentAssistantId: string): number {
    let count = 0;
    for (const run of this.runs.values()) {
      if (
        run.parentAssistantId === parentAssistantId &&
        (run.status === "pending" || run.status === "running")
      ) {
        count++;
      }
    }
    return count;
  }

  globalActiveCount(): number {
    let count = 0;
    for (const run of this.runs.values()) {
      if (run.status === "pending" || run.status === "running") {
        count++;
      }
    }
    return count;
  }

  requestCancel(id: string): boolean {
    const controller = this.activeControllers.get(id);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(id);
      return true;
    }
    return false;
  }

  cancelAllForParent(parentChatId: string): number {
    let count = 0;
    for (const run of this.runs.values()) {
      if (
        run.parentChatId === parentChatId &&
        (run.status === "pending" || run.status === "running")
      ) {
        if (this.requestCancel(run.id)) {
          count++;
        }
      }
    }
    return count;
  }

  private pruneIfNeeded(): void {
    if (this.runs.size < SubAgentDefaults.REGISTRY_LRU_CAP) return;
    const terminal = Array.from(this.runs.values())
      .filter((r) => r.status !== "pending" && r.status !== "running")
      .sort((a, b) => (a.finishedAtMs ?? a.startedAtMs) - (b.finishedAtMs ?? b.startedAtMs));

    if (terminal.length > 0) {
      const oldest = terminal[0];
      this.runs.delete(oldest.id);
    }
  }
}

export const subAgentRegistry = new SubAgentRegistry();
