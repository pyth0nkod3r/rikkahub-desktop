import { describe, expect, it } from "bun:test";
import { isGitWorkspace, createSubAgentWorktree, getSubAgentWorktreeDiff, removeSubAgentWorktree } from "./worktree";
import { recordObservedModelContextWindow, getObservedModelContextWindow } from "../model-providers/model-limits";
import type { Workspace } from "../foundation/types";

describe("Worktree Isolation and Header Limit Discovery", () => {
  it("detects git workspace correctly", () => {
    const ws: Workspace = {
      id: "test-ws",
      type: "folder",
      name: "RikkaHub",
      root: "C:/Users/D3V_001/repos/rikkahub-desktop",
      permissionPreset: "balanced",
      trusted: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(isGitWorkspace(ws)).toBe(true);
  });

  it("handles non-git workspace safely", () => {
    const ws: Workspace = {
      id: "fake-ws",
      type: "folder",
      name: "Fake",
      root: "C:/NonExistentPath12345",
      permissionPreset: "balanced",
      trusted: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(isGitWorkspace(ws)).toBe(false);
    expect(createSubAgentWorktree(ws, "sub-123")).toBeNull();
  });

  it("records and retrieves observed model context window from response headers", () => {
    recordObservedModelContextWindow("openrouter", "deepseek/deepseek-r1", 65536);
    expect(getObservedModelContextWindow("openrouter", "deepseek/deepseek-r1")).toBe(65536);
    expect(getObservedModelContextWindow("openrouter", "unknown-model")).toBeNull();
  });
});
