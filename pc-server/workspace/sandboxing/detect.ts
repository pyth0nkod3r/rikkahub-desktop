// workspace/sandboxing/detect.ts — Detection of Host Sandboxing Tiers (Local, WSL2, Docker)

import { getShellConfig } from "../tools/shell";
import type { SandboxStatus } from "./types";

export function detectLocalBash(): { available: boolean; shellPath?: string } {
  try {
    const config = getShellConfig();
    return { available: true, shellPath: config.shell };
  } catch {
    return { available: false };
  }
}

export function detectWsl(): { available: boolean; distros: string[]; defaultDistro?: string } {
  if (process.platform !== "win32") {
    return { available: false, distros: [] };
  }
  try {
    const proc = Bun.spawnSync(["wsl.exe", "-l", "-q"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      return { available: false, distros: [] };
    }
    // Windows wsl.exe outputs UTF-16LE text
    const text = proc.stdout.toString("utf16le");
    const distros = text
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\0/g, ""))
      .filter(Boolean);

    return {
      available: distros.length > 0,
      distros,
      defaultDistro: distros[0],
    };
  } catch {
    return { available: false, distros: [] };
  }
}

export function detectDocker(): { available: boolean; version?: string; daemonRunning?: boolean } {
  try {
    const versionProc = Bun.spawnSync(["docker", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (versionProc.exitCode !== 0) {
      return { available: false };
    }
    const version = versionProc.stdout.toString().trim();

    // Check daemon
    const infoProc = Bun.spawnSync(["docker", "info", "--format", "{{.ServerVersion}}"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const daemonRunning = infoProc.exitCode === 0 && infoProc.stdout.toString().trim().length > 0;

    return {
      available: true,
      version,
      daemonRunning,
    };
  } catch {
    return { available: false };
  }
}

let cachedStatus: { timestamp: number; status: SandboxStatus } | null = null;
const CACHE_TTL_MS = 15_000;

export function getSandboxStatus(forceFresh = false): SandboxStatus {
  const now = Date.now();
  if (!forceFresh && cachedStatus && now - cachedStatus.timestamp < CACHE_TTL_MS) {
    return cachedStatus.status;
  }
  const status: SandboxStatus = {
    local: detectLocalBash(),
    wsl: detectWsl(),
    docker: detectDocker(),
  };
  cachedStatus = { timestamp: now, status };
  return status;
}
