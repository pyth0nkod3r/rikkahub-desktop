import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import {
  deleteSshHost,
  ensureSshTables,
  getSshHostByLabel,
  insertSshHost,
  listSshHosts,
} from "./db";
import { getSshExecutable } from "./client";
import {
  isSshTool,
  openAiSshTools,
} from "../tools/ssh-tools";

describe("SSH Remote Module", () => {
  it("detects ssh executable correctly", () => {
    const exe = getSshExecutable();
    expect(exe).toBeDefined();
    expect(typeof exe).toBe("string");
  });

  it("creates tables and manages SSH host profiles in SQLite", () => {
    const db = new Database(":memory:");
    ensureSshTables(db);

    const now = Date.now();
    insertSshHost(
      {
        id: "ssh-1",
        label: "vps-staging",
        host: "192.168.1.100",
        port: 2222,
        user: "deploy",
        keyPath: "/home/user/.ssh/id_rsa",
        createdAt: now,
        updatedAt: now,
      },
      db,
    );

    const retrieved = getSshHostByLabel("vps-staging", db);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.host).toBe("192.168.1.100");
    expect(retrieved?.port).toBe(2222);
    expect(retrieved?.user).toBe("deploy");
    expect(retrieved?.keyPath).toBe("/home/user/.ssh/id_rsa");

    const all = listSshHosts(db);
    expect(all.length).toBe(1);

    const deleted = deleteSshHost("vps-staging", db);
    expect(deleted).toBe(true);

    const notFound = getSshHostByLabel("vps-staging", db);
    expect(notFound).toBeNull();
  });

  it("recognizes SSH tool schemas and discriminates tool names", () => {
    expect(isSshTool("ssh_exec")).toBe(true);
    expect(isSshTool("ssh_upload")).toBe(true);
    expect(isSshTool("save_ssh_host")).toBe(true);
    expect(isSshTool("other_tool")).toBe(false);

    const tools = openAiSshTools();
    expect(tools.length).toBeGreaterThan(3);
    const names = tools.map((t) => t.function.name);
    expect(names).toContain("ssh_exec");
    expect(names).toContain("ssh_upload");
    expect(names).toContain("ssh_download");
  });
});
