// workspace/sandboxing/runners.ts — WSL2 and Docker Sandboxed Bash Operations
// Ported from rikkahub-for-desktop (Lyrecoul) DesktopAgent.kt & rikkahub-agent PRoot architecture

import { spawn, type ChildProcess } from "node:child_process";
import type { BashOperations } from "../tools/bash";
import { createLocalBashOperations } from "../tools/bash";
import { detectWsl, detectDocker } from "./detect";
import type { SandboxBackend, SandboxExecutionOptions } from "./types";

export function windowsToWslPath(winPath: string): string {
  const match = winPath.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (!match) return winPath.replace(/\\/g, "/");
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, "/");
  return `/mnt/${drive}/${rest}`;
}

/**
 * Tier 2: WSL2 Rootfs / Distro Runner (Full Linux PRoot Parity on Windows)
 */
export function createWslBashOperations(options?: { distro?: string }): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      if (signal?.aborted) {
        throw new Error("aborted");
      }

      const wslStatus = detectWsl();
      if (!wslStatus.available) {
        throw new Error(
          "WSL2 is not installed or has no active distros. Please install WSL2 or switch to Local sandbox backend.",
        );
      }

      const distro = options?.distro || wslStatus.defaultDistro || "kali-linux";
      const wslCwd = windowsToWslPath(cwd);

      const args = ["-d", distro, "--cd", wslCwd, "sh", "-c", command];

      return new Promise<{ exitCode: number | null }>((resolve, reject) => {
        let child: ChildProcess | null = null;
        let timer: NodeJS.Timeout | null = null;

        if (timeout && timeout > 0) {
          timer = setTimeout(() => {
            if (child) {
              child.kill("SIGKILL");
            }
          }, timeout * 1000);
        }

        try {
          child = spawn("wsl.exe", args, {
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (err) {
          if (timer) clearTimeout(timer);
          reject(err);
          return;
        }

        const onAbort = () => {
          if (child) {
            child.kill("SIGKILL");
          }
        };

        if (signal) {
          signal.addEventListener("abort", onAbort, { once: true });
        }

        child.stdout?.on("data", (chunk: Buffer) => onData(chunk));
        child.stderr?.on("data", (chunk: Buffer) => onData(chunk));

        child.on("error", (err) => {
          if (timer) clearTimeout(timer);
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(err);
        });

        child.on("close", (code) => {
          if (timer) clearTimeout(timer);
          if (signal) signal.removeEventListener("abort", onAbort);
          resolve({ exitCode: code });
        });
      });
    },
  };
}

/**
 * Tier 3: Docker Container Sandbox Runner
 */
export function createDockerBashOperations(options?: { image?: string }): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout }) => {
      if (signal?.aborted) {
        throw new Error("aborted");
      }

      const dockerStatus = detectDocker();
      if (!dockerStatus.available || !dockerStatus.daemonRunning) {
        throw new Error(
          "Docker Desktop / daemon is not running. Please start Docker or switch to Local or WSL2 sandbox backend.",
        );
      }

      const image = options?.image?.trim() || "alpine:latest";
      // Normalize Windows path for Docker volume mounting: C:\Users\... -> //c/Users/... or C:/Users/...
      const dockerMountPath = cwd.replace(/\\/g, "/");

      const args = [
        "run",
        "--rm",
        "-i",
        "-v",
        `${dockerMountPath}:/workspace`,
        "-w",
        "/workspace",
        image,
        "sh",
        "-c",
        command,
      ];

      return new Promise<{ exitCode: number | null }>((resolve, reject) => {
        let child: ChildProcess | null = null;
        let timer: NodeJS.Timeout | null = null;

        if (timeout && timeout > 0) {
          timer = setTimeout(() => {
            if (child) {
              child.kill("SIGKILL");
            }
          }, timeout * 1000);
        }

        try {
          child = spawn("docker", args, {
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (err) {
          if (timer) clearTimeout(timer);
          reject(err);
          return;
        }

        const onAbort = () => {
          if (child) {
            child.kill("SIGKILL");
          }
        };

        if (signal) {
          signal.addEventListener("abort", onAbort, { once: true });
        }

        child.stdout?.on("data", (chunk: Buffer) => onData(chunk));
        child.stderr?.on("data", (chunk: Buffer) => onData(chunk));

        child.on("error", (err) => {
          if (timer) clearTimeout(timer);
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(err);
        });

        child.on("close", (code) => {
          if (timer) clearTimeout(timer);
          if (signal) signal.removeEventListener("abort", onAbort);
          resolve({ exitCode: code });
        });
      });
    },
  };
}

/**
 * Sandboxed Bash Operations Dispatcher
 */
export function createSandboxedBashOperations(
  backend: SandboxBackend = "local",
  options?: SandboxExecutionOptions,
): BashOperations {
  if (backend === "wsl") {
    return createWslBashOperations({ distro: options?.wslDistro });
  }
  if (backend === "docker") {
    return createDockerBashOperations({ image: options?.dockerImage });
  }
  return createLocalBashOperations({ shellPath: options?.shellPath });
}
