import { spawn } from "bun";
import { existsSync } from "node:fs";

export interface SshExecOptions {
  host: string;
  port?: number;
  user: string;
  command: string;
  keyPath?: string;
  timeoutSeconds?: number;
}

export interface SshTransferOptions {
  host: string;
  port?: number;
  user: string;
  localPath: string;
  remotePath: string;
  keyPath?: string;
  timeoutSeconds?: number;
}

const SSH_EXE = "C:\\WINDOWS\\System32\\OpenSSH\\ssh.exe";
const SCP_EXE = "C:\\WINDOWS\\System32\\OpenSSH\\scp.exe";

export function getSshExecutable(): string {
  if (existsSync(SSH_EXE)) return SSH_EXE;
  return "ssh";
}

export function getScpExecutable(): string {
  if (existsSync(SCP_EXE)) return SCP_EXE;
  return "scp";
}

export async function sshExec(opts: SshExecOptions): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const exe = getSshExecutable();
  const port = opts.port || 22;
  const timeoutMs = Math.min(opts.timeoutSeconds || 60, 300) * 1000;

  const args: string[] = [
    "-p",
    String(port),
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
  ];

  if (opts.keyPath) {
    args.push("-i", opts.keyPath);
  }

  args.push(`${opts.user}@${opts.host}`, opts.command);

  const proc = spawn({
    cmd: [exe, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });

  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<{ stdout: string; stderr: string; exitCode: number }>((_, reject) => {
    timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Ignore
      }
      reject(new Error(`SSH execution timed out after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
  });

  const execPromise = (async () => {
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  })();

  try {
    return await Promise.race([execPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sftpUpload(opts: SshTransferOptions): Promise<{ success: boolean; output: string }> {
  const exe = getScpExecutable();
  const port = opts.port || 22;
  const timeoutMs = Math.min(opts.timeoutSeconds || 120, 300) * 1000;

  const args: string[] = [
    "-P",
    String(port),
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
  ];

  if (opts.keyPath) {
    args.push("-i", opts.keyPath);
  }

  args.push(opts.localPath, `${opts.user}@${opts.host}:${opts.remotePath}`);

  const proc = spawn({
    cmd: [exe, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });

  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<{ success: boolean; output: string }>((_, reject) => {
    timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Ignore
      }
      reject(new Error(`SFTP upload timed out after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
  });

  const uploadPromise = (async () => {
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`SFTP upload failed (code ${exitCode}): ${stderr || stdout}`);
    }

    return { success: true, output: stdout || "Upload complete" };
  })();

  try {
    return await Promise.race([uploadPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sftpDownload(opts: SshTransferOptions): Promise<{ success: boolean; output: string }> {
  const exe = getScpExecutable();
  const port = opts.port || 22;
  const timeoutMs = Math.min(opts.timeoutSeconds || 120, 300) * 1000;

  const args: string[] = [
    "-P",
    String(port),
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=10",
  ];

  if (opts.keyPath) {
    args.push("-i", opts.keyPath);
  }

  args.push(`${opts.user}@${opts.host}:${opts.remotePath}`, opts.localPath);

  const proc = spawn({
    cmd: [exe, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });

  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<{ success: boolean; output: string }>((_, reject) => {
    timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Ignore
      }
      reject(new Error(`SFTP download timed out after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
  });

  const downloadPromise = (async () => {
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`SFTP download failed (code ${exitCode}): ${stderr || stdout}`);
    }

    return { success: true, output: stdout || "Download complete" };
  })();

  try {
    return await Promise.race([downloadPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
