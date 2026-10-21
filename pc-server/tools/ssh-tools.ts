import {
  deleteSshHost,
  getSshHostByLabel,
  insertSshHost,
  listSshHosts,
} from "../ssh/db";
import { sftpDownload, sftpUpload, sshExec } from "../ssh/client";
import { id as newId } from "../foundation/utils";

export const SSH_EXEC_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "ssh_exec",
    description: "Execute a shell command on a remote machine via SSH.",
    parameters: {
      type: "object",
      properties: {
        host: { type: "string", description: "Remote hostname or IP" },
        port: { type: "number", description: "SSH port (default 22)" },
        user: { type: "string", description: "Remote username" },
        command: { type: "string", description: "Command to execute on the remote machine" },
        key_path: { type: "string", description: "Optional path to private key identity file" },
        timeout_seconds: { type: "number", description: "Timeout in seconds (default 60, max 300)" },
      },
      required: ["host", "user", "command"],
    },
  },
};

export const SSH_EXEC_SAVED_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "ssh_exec_saved",
    description: "Execute a command on a remote machine using a previously saved host label.",
    parameters: {
      type: "object",
      properties: {
        host_label: { type: "string", description: "Saved host label (from save_ssh_host)" },
        command: { type: "string", description: "Command to execute" },
        timeout_seconds: { type: "number", description: "Timeout in seconds (default 60)" },
      },
      required: ["host_label", "command"],
    },
  },
};

export const SSH_UPLOAD_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "ssh_upload",
    description: "Upload a local file to a remote server via SFTP/SCP.",
    parameters: {
      type: "object",
      properties: {
        host: { type: "string", description: "Remote hostname or IP" },
        port: { type: "number", description: "SSH port (default 22)" },
        user: { type: "string", description: "Remote username" },
        local_path: { type: "string", description: "Local source file path" },
        remote_path: { type: "string", description: "Remote destination file path" },
        key_path: { type: "string", description: "Optional path to private key" },
      },
      required: ["host", "user", "local_path", "remote_path"],
    },
  },
};

export const SSH_DOWNLOAD_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "ssh_download",
    description: "Download a file from a remote server to a local destination via SFTP/SCP.",
    parameters: {
      type: "object",
      properties: {
        host: { type: "string", description: "Remote hostname or IP" },
        port: { type: "number", description: "SSH port (default 22)" },
        user: { type: "string", description: "Remote username" },
        remote_path: { type: "string", description: "Remote source file path" },
        local_path: { type: "string", description: "Local destination file path" },
        key_path: { type: "string", description: "Optional path to private key" },
      },
      required: ["host", "user", "remote_path", "local_path"],
    },
  },
};

export const SAVE_SSH_HOST_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "save_ssh_host",
    description: "Save a remote host profile for fast future ssh_exec_saved access.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Human-readable unique label, e.g. 'vps', 'raspberry-pi'" },
        host: { type: "string", description: "Remote hostname or IP" },
        port: { type: "number", description: "SSH port (default 22)" },
        user: { type: "string", description: "Remote username" },
        key_path: { type: "string", description: "Optional path to private key" },
      },
      required: ["label", "host", "user"],
    },
  },
};

export const LIST_SSH_HOSTS_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "list_ssh_hosts",
    description: "List all saved SSH hosts.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export const DELETE_SSH_HOST_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "delete_ssh_host",
    description: "Delete a saved SSH host by its label.",
    parameters: {
      type: "object",
      properties: {
        label: { type: "string", description: "Host label to remove" },
      },
      required: ["label"],
    },
  },
};

export const SSH_TOOL_SCHEMAS = [
  SSH_EXEC_TOOL_SCHEMA,
  SSH_EXEC_SAVED_TOOL_SCHEMA,
  SSH_UPLOAD_TOOL_SCHEMA,
  SSH_DOWNLOAD_TOOL_SCHEMA,
  SAVE_SSH_HOST_TOOL_SCHEMA,
  LIST_SSH_HOSTS_TOOL_SCHEMA,
  DELETE_SSH_HOST_TOOL_SCHEMA,
];

export function openAiSshTools() {
  return SSH_TOOL_SCHEMAS;
}

export function isSshTool(name: string): boolean {
  return (
    name.startsWith("ssh_") ||
    name === "save_ssh_host" ||
    name === "list_ssh_hosts" ||
    name === "delete_ssh_host"
  );
}

export async function executeSshTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "ssh_exec": {
      const host = String(args.host || "").trim();
      const user = String(args.user || "").trim();
      const command = String(args.command || "");
      if (!host || !user || !command) throw new Error("host, user, and command are required");
      const res = await sshExec({
        host,
        port: typeof args.port === "number" ? args.port : 22,
        user,
        command,
        keyPath: args.key_path ? String(args.key_path) : undefined,
        timeoutSeconds: typeof args.timeout_seconds === "number" ? args.timeout_seconds : undefined,
      });
      return JSON.stringify(res);
    }

    case "ssh_exec_saved": {
      const label = String(args.host_label || "").trim();
      const command = String(args.command || "");
      if (!label || !command) throw new Error("host_label and command are required");
      const hostProfile = getSshHostByLabel(label);
      if (!hostProfile) throw new Error(`Saved SSH host '${label}' not found.`);
      const res = await sshExec({
        host: hostProfile.host,
        port: hostProfile.port,
        user: hostProfile.user,
        command,
        keyPath: hostProfile.keyPath,
        timeoutSeconds: typeof args.timeout_seconds === "number" ? args.timeout_seconds : undefined,
      });
      return JSON.stringify(res);
    }

    case "ssh_upload": {
      const host = String(args.host || "").trim();
      const user = String(args.user || "").trim();
      const localPath = String(args.local_path || "").trim();
      const remotePath = String(args.remote_path || "").trim();
      if (!host || !user || !localPath || !remotePath) {
        throw new Error("host, user, local_path, and remote_path are required");
      }
      const res = await sftpUpload({
        host,
        port: typeof args.port === "number" ? args.port : 22,
        user,
        localPath,
        remotePath,
        keyPath: args.key_path ? String(args.key_path) : undefined,
      });
      return JSON.stringify(res);
    }

    case "ssh_download": {
      const host = String(args.host || "").trim();
      const user = String(args.user || "").trim();
      const remotePath = String(args.remote_path || "").trim();
      const localPath = String(args.local_path || "").trim();
      if (!host || !user || !remotePath || !localPath) {
        throw new Error("host, user, remote_path, and local_path are required");
      }
      const res = await sftpDownload({
        host,
        port: typeof args.port === "number" ? args.port : 22,
        user,
        remotePath,
        localPath,
        keyPath: args.key_path ? String(args.key_path) : undefined,
      });
      return JSON.stringify(res);
    }

    case "save_ssh_host": {
      const label = String(args.label || "").trim();
      const host = String(args.host || "").trim();
      const user = String(args.user || "").trim();
      if (!label || !host || !user) throw new Error("label, host, and user are required");
      const now = Date.now();
      insertSshHost({
        id: newId(),
        label,
        host,
        port: typeof args.port === "number" ? args.port : 22,
        user,
        keyPath: args.key_path ? String(args.key_path) : undefined,
        createdAt: now,
        updatedAt: now,
      });
      return JSON.stringify({ ok: true, saved: label });
    }

    case "list_ssh_hosts": {
      const hosts = listSshHosts();
      return JSON.stringify({ ok: true, hosts });
    }

    case "delete_ssh_host": {
      const label = String(args.label || "").trim();
      if (!label) throw new Error("label is required");
      const ok = deleteSshHost(label);
      return JSON.stringify({ ok, label });
    }

    default:
      throw new Error(`Unknown SSH tool: ${name}`);
  }
}
