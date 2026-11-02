// workspace/worktree.ts ? Git Worktree Isolation for Concurrent Sub-Agents
// Benchmark: Claude Code / OpenHands isolated worktrees.
// Prevents file collisions when multiple subagents operate on the same repository concurrently.

import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Workspace } from "../foundation/types";
import { reportError } from "../observability/app-errors";

export interface SubAgentWorktree {
  path: string;
  branch: string;
  originalRoot: string;
}

export function isGitWorkspace(workspace: Workspace): boolean {
  if (!workspace || !workspace.root || !existsSync(workspace.root)) return false;
  try {
    const res = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: workspace.root,
      encoding: "utf8",
      windowsHide: true,
    });
    return res.status === 0 && res.stdout.trim() === "true";
  } catch {
    return false;
  }
}

export function createSubAgentWorktree(workspace: Workspace, subConvId: string): SubAgentWorktree | null {
  if (!isGitWorkspace(workspace)) return null;

  const branchName = `subagent/${subConvId.slice(0, 12)}`;
  const worktreeBase = join(workspace.root, ".rikkahub-worktrees");
  try {
    mkdirSync(worktreeBase, { recursive: true });
  } catch {
    // ignore
  }
  const worktreePath = join(worktreeBase, subConvId);

  try {
    const addRes = spawnSync("git", ["worktree", "add", "-B", branchName, worktreePath, "HEAD"], {
      cwd: workspace.root,
      encoding: "utf8",
      windowsHide: true,
    });
    if (addRes.status !== 0) {
      reportError("workspace", "warn", `Failed to create subagent worktree: ${addRes.stderr || addRes.stdout}`);
      return null;
    }
    return {
      path: worktreePath,
      branch: branchName,
      originalRoot: workspace.root,
    };
  } catch (err) {
    reportError("workspace", "warn", "Error creating subagent git worktree", err);
    return null;
  }
}

export function getSubAgentWorktreeDiff(worktreePath: string): string {
  if (!existsSync(worktreePath)) return "";
  try {
    const diffRes = spawnSync("git", ["diff", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf8",
      windowsHide: true,
    });
    return diffRes.status === 0 ? diffRes.stdout : "";
  } catch {
    return "";
  }
}

export function removeSubAgentWorktree(worktree: SubAgentWorktree): void {
  try {
    spawnSync("git", ["worktree", "remove", "--force", worktree.path], {
      cwd: worktree.originalRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    spawnSync("git", ["branch", "-D", worktree.branch], {
      cwd: worktree.originalRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    if (existsSync(worktree.path)) {
      rmSync(worktree.path, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}
