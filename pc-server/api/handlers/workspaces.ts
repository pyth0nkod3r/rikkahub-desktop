// api/handlers/workspaces.ts — 工作区路由(agent 模式,§5.4)
// CRUD + 信任门确认。工具执行/文件面板路由随 M1-4/M3 加入。

import type { Workspace } from "../../foundation/types";
import type { WorkspaceDto } from "../../foundation/types/dto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { createWorkspace, deleteWorkspace, ensureDefaultChatWorkspace, getWorkspace, listWorkspaces, trustWorkspace, updateWorkspace, workspaceStatus } from "../../workspace";
import { assertInsideWorkspace } from "../../workspace/boundary";
import { deleteWorkspaceEntry, listWorkspaceDir, previewWorkspaceFile, searchWorkspaceFiles, readWorkspaceAgentsFile, renameWorkspaceEntry, revealWorkspaceEntry, writeWorkspaceAgentsFile } from "../../workspace/files";
import { listWorkspaceDiffs, revertWorkspaceDiff } from "../../workspace/diffs";
import { scanWorkspaceAndGenerateAgentsMd } from "../../workspace/project-scan";
import { searchWorkspaceIntelligence, type IntelSearchMode } from "../../workspace/file-intel";
import { mountedWorkspaceToolNames, refreshShellAvailability, shellAvailability } from "../../workspace/runtime";
import { error, json, readJson } from "../request";
import { getSandboxStatus } from "../../workspace/sandboxing/detect";
import { createSandboxedBashOperations } from "../../workspace/sandboxing/runners";

export function shellStatusPayload(): { available: boolean; error: string | null; mountedTools: string[] } {
  const shell = shellAvailability();
  return { available: shell.available, error: shell.error ?? null, mountedTools: [...mountedWorkspaceToolNames()] };
}

function launchExternalTerminal(targetDir: string): void {
  if (process.platform === "win32") {
    const child = spawn("wt.exe", ["-d", targetDir], { detached: true, stdio: "ignore" });
    child.on("error", () => {
      const fallback = spawn(
        "cmd.exe",
        ["/c", "start", "", "/D", targetDir, "powershell.exe", "-NoExit"],
        { detached: true, stdio: "ignore" },
      );
      fallback.on("error", () => {});
      fallback.unref();
    });
    child.unref();
    return;
  }
  if (process.platform === "darwin") {
    const child = spawn("open", ["-a", "Terminal", targetDir], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return;
  }
  const candidates: Array<[string, string[]]> = [
    ["x-terminal-emulator", [`--working-directory=${targetDir}`]],
    ["gnome-terminal", [`--working-directory=${targetDir}`]],
    ["konsole", ["--workdir", targetDir]],
    ["xfce4-terminal", [`--working-directory=${targetDir}`]],
    ["kitty", ["--directory", targetDir]],
    ["alacritty", ["--working-directory", targetDir]],
    ["xterm", ["-e", "sh", "-c", `cd "${targetDir.replace(/"/g, '\\"')}" && exec "\${SHELL:-sh}"`]],
  ];
  const tryNext = (index: number): void => {
    if (index >= candidates.length) return;
    const [cmd, args] = candidates[index];
    const child = spawn(cmd, args, { cwd: targetDir, detached: true, stdio: "ignore" });
    child.on("error", () => tryNext(index + 1));
    child.unref();
  };
  tryNext(0);
}

function toDto(workspace: Workspace): WorkspaceDto {
  return { ...workspace, status: workspaceStatus(workspace) };
}

export async function handleWorkspaceRoutes(request: Request, _url: URL, path: string): Promise<Response | null> {
  if (path === "workspaces" && request.method === "GET") {
    return json({ workspaces: listWorkspaces().map(toDto) });
  }

  if (path === "workspaces/sandbox-backends" && request.method === "GET") {
    return json(getSandboxStatus());
  }

  if (path === "workspaces" && request.method === "POST") {
    const body = await readJson<{ type?: string; name?: string; root?: string; sandboxBackend?: import("../../foundation/types").SandboxBackend; sandboxImage?: string }>(request);
    const type = String(body.type ?? "");
    if (type !== "managed" && type !== "folder") return error("type must be managed or folder", 400);
    try {
      return json({ workspace: toDto(createWorkspace({ type, name: body.name, root: body.root, sandboxBackend: body.sandboxBackend, sandboxImage: body.sandboxImage })) });
    } catch (err) {
      return error(err instanceof Error ? err.message : "创建工作区失败", 400);
    }
  }

  // ---- shell 探测状态(K3):bash 不可用时前端引导安装 Git;装完后可触发重探 ----
  // 注意置于 :id 正则之前,否则 shell-status 会被吞成工作区 id。
  if (path === "workspaces/shell-status" && request.method === "GET") {
    return json({ shell: shellStatusPayload() });
  }
  if (path === "workspaces/shell-status/refresh" && request.method === "POST") {
    refreshShellAvailability();
    return json({ shell: shellStatusPayload() });
  }

  if (path === "workspaces/default" && request.method === "POST") {
    const workspace = ensureDefaultChatWorkspace();
    return json({ workspace: toDto(workspace) });
  }

  const workspaceRoute = path.match(/^workspaces\/([^/]+)(?:\/(.*))?$/);
  if (!workspaceRoute) return null;
  const workspaceId = decodeURIComponent(workspaceRoute[1]);
  const sub = workspaceRoute[2] ?? "";

  if (!sub && request.method === "GET") {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return error("Workspace not found", 404);
    return json({ workspace: toDto(workspace) });
  }

  if (!sub && request.method === "PATCH") {
    // B6-①b:root 仅 folder 型可重绑(校验+信任门重置在领域层),managed 型传 root 会抛错。
    const body = await readJson<{ name?: string; permissionPreset?: string; root?: string; sandboxBackend?: string; sandboxImage?: string }>(request);
    try {
      const updated = updateWorkspace(workspaceId, body);
      if (!updated) return error("Workspace not found", 404);
      return json({ workspace: toDto(updated) });
    } catch (err) {
      return error(err instanceof Error ? err.message : "更新工作区失败", 400);
    }
  }

  // ---- 文件面板路由(M3-5,§4.4):path 参数为相对 root 的路径,边界断言在领域层 ----
  if (sub === "files" || sub.startsWith("files/")) {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return error("Workspace not found", 404);
    const relPath = _url.searchParams.get("path") ?? "";
    try {
      if (sub === "files/search" && request.method === "GET") {
        const q = _url.searchParams.get("q") ?? _url.searchParams.get("query") ?? "";
        return json({ matches: searchWorkspaceFiles(workspace, q, 30) });
      }
      if (sub === "files" && request.method === "GET") {
        return json({ entries: listWorkspaceDir(workspace, relPath) });
      }
      if (sub === "files/content" && request.method === "GET") {
        return json({ preview: await previewWorkspaceFile(workspace, relPath) });
      }
      if (sub === "files/rename" && request.method === "POST") {
        const body = await readJson<{ path?: string; newName?: string }>(request);
        renameWorkspaceEntry(workspace, String(body.path ?? ""), String(body.newName ?? ""));
        return new Response(null, { status: 204 });
      }
      if (sub === "files" && request.method === "DELETE") {
        deleteWorkspaceEntry(workspace, relPath);
        return new Response(null, { status: 204 });
      }
      if (sub === "files/reveal" && request.method === "POST") {
        const body = await readJson<{ path?: string }>(request);
        revealWorkspaceEntry(workspace, String(body.path ?? ""));
        return new Response(null, { status: 204 });
      }
      return null;
    } catch (err) {
      return error(err instanceof Error ? err.message : "文件操作失败", 400);
    }
  }

  // ---- AGENTS.md 编辑入口(P4,§3.3):读写 pi 实际加载的项目上下文文件 ----
  if (sub === "agents-file") {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return error("Workspace not found", 404);
    try {
      if (request.method === "GET") {
        return json({ agentsFile: readWorkspaceAgentsFile(workspace) });
      }
      if (request.method === "PUT") {
        const body = await readJson<{ content?: string }>(request);
        return json({ agentsFile: writeWorkspaceAgentsFile(workspace, String(body.content ?? "")) });
      }
      return null;
    } catch (err) {
      return error(err instanceof Error ? err.message : "AGENTS.md 操作失败", 400);
    }
  }

  // ---- 交互式终端执行接口:在指定工作区的沙箱环境内运行命令 ----
  // ---- Workspace Diffs (Agent-2 Ledger) ----
  if (sub === "diffs" && request.method === "GET") {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return error("Workspace not found", 404);
    const limit = Number(_url.searchParams.get("limit") ?? "50");
    return json({ diffs: listWorkspaceDiffs(workspaceId, limit) });
  }

  const revertMatch = sub.match(/^diffs\/([^/]+)\/revert$/);
  if (revertMatch && request.method === "POST") {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return error("Workspace not found", 404);
    const diffId = decodeURIComponent(revertMatch[1]);
    const res = revertWorkspaceDiff(workspace, diffId);
    if (!res.ok) return error(res.error, res.status);
    return json({ ok: true, diff: res.record });
  }

  // ---- /init Project Scanner (Agent-2 Split-Ownership) ----
  if (sub === "init-scan" && request.method === "POST") {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return error("Workspace not found", 404);
    try {
      const scanRes = scanWorkspaceAndGenerateAgentsMd(workspace);
      return json({ ok: true, ...scanRes });
    } catch (err) {
      return error(err instanceof Error ? err.message : "Project scan failed", 400);
    }
  }

  // ---- Workspace Intelligence & Specialized Search (Agent-2) ----
  if (sub === "intel-search" && request.method === "GET") {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return error("Workspace not found", 404);
    const mode = (_url.searchParams.get("mode") ?? "content") as IntelSearchMode;
    const q = _url.searchParams.get("q") ?? _url.searchParams.get("query") ?? "";
    const limit = Number(_url.searchParams.get("limit") ?? "30");
    const hits = searchWorkspaceIntelligence(workspace, { mode, query: q, limit });
    return json({ hits });
  }

  if (sub === "terminal/exec" && request.method === "POST") {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return error("Workspace not found", 404);
    const body = await readJson<{ command?: string; cwd?: string }>(request);
    const command = String(body.command ?? "").trim();
    if (!command) return error("Command cannot be empty", 400);

    const execCwd = body.cwd?.trim() || workspace.root;
    const ops = createSandboxedBashOperations(workspace.sandboxBackend || "local", {
      wslDistro: workspace.sandboxImage ?? undefined,
      dockerImage: workspace.sandboxImage ?? undefined,
    });

    let stdout = "";
    let stderr = "";
    try {
      const res = await ops.exec(command, execCwd, {
        onData: (chunk) => {
          stdout += chunk.toString("utf8");
        },
        timeout: 60,
      });
      return json({
        ok: (res.exitCode ?? 0) === 0,
        exitCode: res.exitCode ?? 0,
        stdout,
        stderr,
        cwd: execCwd,
      });
    } catch (err) {
      return json({
        ok: false,
        exitCode: -1,
        stdout,
        stderr: err instanceof Error ? err.message : String(err),
        cwd: execCwd,
      });
    }
  }

  // ---- Launch an interactive OS terminal window directly inside the workspace ----
  if (sub === "terminal/open-external" && request.method === "POST") {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) return error("Workspace not found", 404);
    const body = await readJson<{ cwd?: string }>(request).catch(() => ({} as { cwd?: string }));
    let targetDir = workspace.root;
    const requestedCwd = typeof body?.cwd === "string" ? body.cwd.trim() : "";
    if (requestedCwd) {
      try {
        const candidate = isAbsolute(requestedCwd) ? requestedCwd : resolve(workspace.root, requestedCwd);
        targetDir = assertInsideWorkspace(candidate, workspace.root);
      } catch (err) {
        return error(err instanceof Error ? err.message : "Invalid terminal working directory", 400);
      }
    }
    if (!existsSync(targetDir)) return error("Workspace directory does not exist", 404);
    launchExternalTerminal(targetDir);
    return json({ ok: true, cwd: targetDir });
  }

  if (sub === "trust" && request.method === "POST") {
    const trusted = trustWorkspace(workspaceId);
    if (!trusted) return error("Workspace not found", 404);
    return json({ workspace: toDto(trusted) });
  }

  if (!sub && request.method === "DELETE") {
    if (!deleteWorkspace(workspaceId)) return error("Workspace not found", 404);
    return new Response(null, { status: 204 });
  }

  return null;
}
