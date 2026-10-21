// workspace/sandboxing/sandboxing.test.ts — Unit tests for Multi-tier Sandboxing Backend
import { describe, expect, it } from "bun:test";
import { windowsToWslPath, createSandboxedBashOperations } from "./runners";
import { detectLocalBash, detectWsl, detectDocker, getSandboxStatus } from "./detect";

describe("windowsToWslPath", () => {
  it("converts Windows drive paths to WSL mount paths", () => {
    expect(windowsToWslPath("C:\\Users\\D3V_001\\repos")).toBe("/mnt/c/Users/D3V_001/repos");
    expect(windowsToWslPath("D:/repos/project")).toBe("/mnt/d/repos/project");
    expect(windowsToWslPath("e:\\data")).toBe("/mnt/e/data");
  });

  it("preserves Linux-style paths", () => {
    expect(windowsToWslPath("/workspace/project")).toBe("/workspace/project");
  });
});

describe("Sandbox Detection", () => {
  it("detects local bash", () => {
    const res = detectLocalBash();
    expect(res.available).toBe(true);
    expect(res.shellPath).toBeDefined();
  });

  it("detects WSL2 on Windows", () => {
    const res = detectWsl();
    expect(typeof res.available).toBe("boolean");
    expect(Array.isArray(res.distros)).toBe(true);
  });

  it("detects Docker on Windows", () => {
    const res = detectDocker();
    expect(typeof res.available).toBe("boolean");
  });

  it("returns cached or fresh SandboxStatus", () => {
    const status = getSandboxStatus();
    expect(status.local).toBeDefined();
    expect(status.wsl).toBeDefined();
    expect(status.docker).toBeDefined();
  });
});

describe("Sandboxed Operations Factory", () => {
  it("creates local operations by default", () => {
    const ops = createSandboxedBashOperations("local");
    expect(typeof ops.exec).toBe("function");
  });

  it("creates wsl operations when requested", () => {
    const ops = createSandboxedBashOperations("wsl", { wslDistro: "test-distro" });
    expect(typeof ops.exec).toBe("function");
  });

  it("creates docker operations when requested", () => {
    const ops = createSandboxedBashOperations("docker", { dockerImage: "alpine:latest" });
    expect(typeof ops.exec).toBe("function");
  });
});
