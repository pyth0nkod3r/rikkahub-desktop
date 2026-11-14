// subagents/dag.ts — Declarative DAG Task Scheduler for parallel Sub-Agent execution (adopted from Agent-2)

import type { SubAgentRun } from "./types";
import type { SubAgentEngine } from "./engine";

export interface DagTaskSpec {
  id: string;
  task: string;
  label?: string;
  dependsOn?: string[];
  depends_on?: string[];
  agent?: string;
  modelId?: string;
  tools?: string[];
  capabilities?: string[];
  runCondition?: "on_success" | "always";
  timeoutSeconds?: number;
  maxTrips?: number;
  isolateWorktree?: boolean;
}

export type DagTaskStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface DagTaskResult {
  id: string;
  label: string;
  status: DagTaskStatus;
  runId?: string;
  verificationVerdict?: string;
  verificationSummary?: string;
  result?: string;
  error?: string;
  skippedReason?: string;
  durationMs: number;
}

export interface DagRunResult {
  ok: boolean;
  tasks: DagTaskResult[];
  totalDurationMs: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
}

export function validateDagTasks(
  tasks: DagTaskSpec[],
): { ok: true; order: string[] } | { ok: false; error: string } {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { ok: false, error: "DAG requires at least one task." };
  }
  if (tasks.length > 20) {
    return { ok: false, error: "DAG supports at most 20 tasks per batch." };
  }

  const byId = new Map<string, DagTaskSpec>();
  for (const t of tasks) {
    const id = String(t?.id ?? "").trim();
    const task = String(t?.task ?? "").trim();
    if (!id) return { ok: false, error: "Every DAG task must have a non-empty id." };
    if (!task) return { ok: false, error: `DAG task '${id}' must have a non-empty task description.` };
    if (byId.has(id)) return { ok: false, error: `Duplicate DAG task id '${id}'.` };
    byId.set(id, { ...t, id, task });
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of byId.keys()) {
    inDegree.set(id, 0);
    dependents.set(id, []);
  }

  for (const [id, spec] of byId.entries()) {
    const rawList = spec.dependsOn ?? spec.depends_on;
    const deps = Array.isArray(rawList) ? rawList.map((d) => String(d).trim()).filter(Boolean) : [];
    const seenDeps = new Set<string>();
    for (const dep of deps) {
      if (dep === id) return { ok: false, error: `DAG task '${id}' cannot depend on itself.` };
      if (!byId.has(dep)) return { ok: false, error: `DAG task '${id}' references unknown dependency '${dep}'.` };
      if (seenDeps.has(dep)) continue;
      seenDeps.add(dep);
      dependents.get(dep)!.push(id);
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
    }
  }

  // Kahn's topological sort for cycle detection
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }
  const order: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const next of dependents.get(cur) ?? []) {
      const nextDeg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, nextDeg);
      if (nextDeg === 0) queue.push(next);
    }
  }

  if (order.length !== byId.size) {
    return { ok: false, error: "DAG contains a dependency cycle; cannot schedule." };
  }

  return { ok: true, order };
}

/**
 * Executes a validated DAG of sub-agent tasks in topological parallel waves up to maxParallel.
 */
export async function executeSubAgentDag(params: {
  tasks: DagTaskSpec[];
  parentAssistantId: string;
  parentChatId: string | null;
  maxParallel?: number;
  engine: Pick<SubAgentEngine, "dispatch">;
}): Promise<DagRunResult> {
  const startAll = Date.now();
  const validation = validateDagTasks(params.tasks);
  if (!validation.ok) {
    throw new Error(`[subagent_dag_run validation_error] ${validation.error}`);
  }

  const maxParallel = Math.max(1, Math.min(6, Math.trunc(params.maxParallel ?? 3)));
  const specs = new Map<string, DagTaskSpec>();
  const results = new Map<string, DagTaskResult>();
  for (const raw of params.tasks) {
    const id = raw.id.trim();
    specs.set(id, {
      ...raw,
      id,
      task: raw.task.trim(),
      label: raw.label?.trim() || id,
      dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.map((d) => String(d).trim()).filter(Boolean) : [],
    });
    results.set(id, {
      id,
      label: raw.label?.trim() || id,
      status: "pending",
      durationMs: 0,
    });
  }

  const isTerminal = (st: DagTaskStatus) => st === "succeeded" || st === "failed" || st === "skipped";

  while (true) {
    // Cascade skips for any pending task whose dependencies are all terminal but block execution
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const [id, spec] of specs.entries()) {
        const cur = results.get(id)!;
        if (cur.status !== "pending") continue;
        const deps = spec.dependsOn ?? [];
        const allTerminal = deps.every((d) => isTerminal(results.get(d)!.status));
        if (!allTerminal) continue;
        if (spec.runCondition !== "always") {
          const blocking = deps.find((d) => results.get(d)!.status !== "succeeded");
          if (blocking) {
            cur.status = "skipped";
            cur.skippedReason = `Upstream task '${blocking}' ended with status '${results.get(blocking)!.status}'.`;
            progressed = true;
          }
        }
      }
    }

    const readyIds: string[] = [];
    for (const [id, spec] of specs.entries()) {
      if (results.get(id)!.status !== "pending") continue;
      const deps = spec.dependsOn ?? [];
      if (deps.every((d) => isTerminal(results.get(d)!.status))) {
        readyIds.push(id);
      }
    }

    if (readyIds.length === 0) break;

    const batch = readyIds.slice(0, maxParallel);
    await Promise.all(
      batch.map(async (id) => {
        const spec = specs.get(id)!;
        const entry = results.get(id)!;
        entry.status = "running";
        const t0 = Date.now();

        const upstreamSnippets = (spec.dependsOn ?? [])
          .map((depId) => {
            const depRes = results.get(depId)!;
            const summary = depRes.result || depRes.error || depRes.skippedReason || "";
            return `[Upstream '${depId}' (${depRes.status})]:\n${summary.slice(0, 1200)}`;
          })
          .filter(Boolean);
        const promptTask =
          upstreamSnippets.length > 0
            ? `${spec.task}\n\n---\nUpstream DAG Task Results:\n${upstreamSnippets.join("\n\n")}`
            : spec.task;

        try {
          const dispatchRes = await params.engine.dispatch(params.parentAssistantId, params.parentChatId, {
            task: promptTask,
            label: spec.label,
            agentName: spec.agent,
            modelId: spec.modelId,
            tools: spec.tools,
            capabilities: spec.capabilities,
            runInBackground: false,
            timeoutSeconds: spec.timeoutSeconds,
            maxTrips: spec.maxTrips,
            isolateWorktree: spec.isolateWorktree,
          });
          entry.durationMs = Date.now() - t0;

          if (!dispatchRes.ok) {
            entry.status = "failed";
            entry.error = `[${dispatchRes.error}] ${dispatchRes.detail}`;
            return;
          }

          const run: SubAgentRun = dispatchRes.run;
          entry.runId = run.id;
          entry.verificationVerdict = run.verificationVerdict;
          entry.verificationSummary = run.verificationSummary ?? undefined;
          if (run.status === "succeeded") {
            entry.status = "succeeded";
            entry.result = run.result ?? undefined;
          } else {
            entry.status = "failed";
            entry.error = run.error ?? `Sub-agent ended with status '${run.status}'`;
            if (run.result) entry.result = run.result;
          }
        } catch (err) {
          entry.durationMs = Date.now() - t0;
          entry.status = "failed";
          entry.error = err instanceof Error ? err.message : String(err);
        }
      }),
    );
  }

  const orderedResults = validation.order.map((id) => results.get(id)!);
  const succeededCount = orderedResults.filter((r) => r.status === "succeeded").length;
  const failedCount = orderedResults.filter((r) => r.status === "failed").length;
  const skippedCount = orderedResults.filter((r) => r.status === "skipped").length;

  return {
    ok: failedCount === 0,
    tasks: orderedResults,
    totalDurationMs: Date.now() - startAll,
    succeededCount,
    failedCount,
    skippedCount,
  };
}
