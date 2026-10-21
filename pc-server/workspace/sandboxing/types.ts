// workspace/sandboxing/types.ts — Multi-tier Sandboxing Backend Types
// Ported to provide Linux PRoot parity on Windows

export type SandboxBackend = "local" | "wsl" | "docker";

export interface SandboxStatus {
  local: {
    available: boolean;
    shellPath?: string;
  };
  wsl: {
    available: boolean;
    distros: string[];
    defaultDistro?: string;
  };
  docker: {
    available: boolean;
    version?: string;
    daemonRunning?: boolean;
  };
}

export interface SandboxExecutionOptions {
  shellPath?: string;
  wslDistro?: string;
  dockerImage?: string;
}
