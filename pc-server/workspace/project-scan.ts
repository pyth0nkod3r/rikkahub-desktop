// workspace/project-scan.ts — Split-ownership /init project scanner for AGENTS.md (adopted from Agent-2)

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Workspace } from "../foundation/types";
import { readWorkspaceAgentsFile, writeWorkspaceAgentsFile } from "./files";

export const GENERATED_SECTION_START = "<!-- rikkahub:generated:start -->";
export const GENERATED_SECTION_END = "<!-- rikkahub:generated:end -->";

export interface ProjectScanSummary {
  stacks: string[];
  commands: Array<{ label: string; command: string }>;
  directories: string[];
  manifestFiles: string[];
}

export interface InitScanResult {
  content: string;
  generatedSection: string;
  summary: ProjectScanSummary;
  created: boolean;
  updated: boolean;
}

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".rikkahub-worktrees",
]);

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readTextSafe(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

export function scanWorkspaceProject(rootDir: string): ProjectScanSummary {
  const stacks: string[] = [];
  const commands: Array<{ label: string; command: string }> = [];
  const directories: string[] = [];
  const manifestFiles: string[] = [];

  let entries: string[] = [];
  try {
    entries = readdirSync(rootDir).sort();
  } catch {
    entries = [];
  }

  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    try {
      const full = join(rootDir, name);
      if (statSync(full).isDirectory()) {
        directories.push(`${name}/`);
      }
    } catch {
      // ignore stat errors
    }
  }

  const pkgPath = join(rootDir, "package.json");
  if (existsSync(pkgPath)) {
    manifestFiles.push("package.json");
    const hasBunLock = existsSync(join(rootDir, "bun.lock")) || existsSync(join(rootDir, "bun.lockb"));
    const hasPnpm = existsSync(join(rootDir, "pnpm-lock.yaml"));
    const hasYarn = existsSync(join(rootDir, "yarn.lock"));
    const pm = hasBunLock ? "bun" : hasPnpm ? "pnpm" : hasYarn ? "yarn" : "npm";
    stacks.push(hasBunLock ? "Bun / TypeScript / Node.js" : "Node.js / TypeScript");

    const pkg = readJsonSafe(pkgPath);
    const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? (pkg.scripts as Record<string, unknown>) : {};
    for (const key of ["dev", "test", "build", "lint", "typecheck", "check"]) {
      if (typeof scripts[key] === "string" && scripts[key]) {
        const prefix = pm === "bun" || pm === "pnpm" ? `${pm}${key === "test" ? "" : " run"}` : `${pm} run`;
        commands.push({ label: key, command: `${prefix} ${key}`.replace(/\s+/g, " ") });
      }
    }
  }

  if (existsSync(join(rootDir, "Cargo.toml"))) {
    manifestFiles.push("Cargo.toml");
    stacks.push("Rust (Cargo)");
    commands.push({ label: "cargo check", command: "cargo check" });
    commands.push({ label: "cargo test", command: "cargo test" });
  }

  if (existsSync(join(rootDir, "pyproject.toml"))) {
    manifestFiles.push("pyproject.toml");
    stacks.push("Python (uv / pyproject)");
    const py = readTextSafe(join(rootDir, "pyproject.toml"));
    commands.push({ label: "sync", command: "uv sync" });
    if (/pytest/i.test(py) || existsSync(join(rootDir, "tests"))) {
      commands.push({ label: "test", command: "uv run pytest" });
    }
  } else if (existsSync(join(rootDir, "requirements.txt"))) {
    manifestFiles.push("requirements.txt");
    stacks.push("Python");
  }

  if (existsSync(join(rootDir, "go.mod"))) {
    manifestFiles.push("go.mod");
    stacks.push("Go");
    commands.push({ label: "test", command: "go test ./..." });
    commands.push({ label: "build", command: "go build ./..." });
  }

  if (existsSync(join(rootDir, "Dockerfile")) || existsSync(join(rootDir, "docker-compose.yml"))) {
    if (existsSync(join(rootDir, "Dockerfile"))) manifestFiles.push("Dockerfile");
    if (existsSync(join(rootDir, "docker-compose.yml"))) manifestFiles.push("docker-compose.yml");
    stacks.push("Docker");
  }

  return {
    stacks: Array.from(new Set(stacks)),
    commands: commands.slice(0, 12),
    directories: directories.slice(0, 24),
    manifestFiles,
  };
}

export function formatGeneratedAgentsBlock(summary: ProjectScanSummary): string {
  const lines: string[] = [
    GENERATED_SECTION_START,
    "## Workspace Architecture (Auto-Scanned)",
    "",
    `- **Detected Stack**: ${summary.stacks.length > 0 ? summary.stacks.join(", ") : "General repository"}`,
  ];

  if (summary.manifestFiles.length > 0) {
    lines.push(`- **Manifests**: ${summary.manifestFiles.map((m) => `\`${m}\``).join(", ")}`);
  }

  if (summary.directories.length > 0) {
    lines.push(`- **Top-Level Directories**: ${summary.directories.map((d) => `\`${d}\``).join(", ")}`);
  }

  if (summary.commands.length > 0) {
    lines.push("", "### Key Commands", "");
    for (const c of summary.commands) {
      lines.push(`- **${c.label}**: \`${c.command}\``);
    }
  }

  lines.push(GENERATED_SECTION_END);
  return lines.join("\n");
}

/**
 * Merges the generated block into existing AGENTS.md content using split-ownership markers.
 * Content outside the generated markers is preserved verbatim.
 */
export function mergeAgentsMarkdown(existingContent: string | null | undefined, generatedBlock: string): string {
  const existing = (existingContent ?? "").replace(/\r\n/g, "\n");
  if (!existing.trim()) {
    return [
      "# AGENTS.md",
      "",
      generatedBlock,
      "",
      "## Custom Project Notes",
      "<!-- Write custom instructions outside the generated markers; /init preserves this section. -->",
      "",
    ].join("\n");
  }

  const startIdx = existing.indexOf(GENERATED_SECTION_START);
  const endIdx = existing.indexOf(GENERATED_SECTION_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existing.slice(0, startIdx).replace(/\s+$/, "");
    const after = existing.slice(endIdx + GENERATED_SECTION_END.length).replace(/^\s+/, "");
    const parts = [before, generatedBlock, after].filter((p) => p.length > 0);
    return parts.join("\n\n") + "\n";
  }

  return `${existing.replace(/\s+$/, "")}\n\n${generatedBlock}\n`;
}

export function scanWorkspaceAndGenerateAgentsMd(workspace: Workspace): InitScanResult {
  const summary = scanWorkspaceProject(workspace.root);
  const generatedSection = formatGeneratedAgentsBlock(summary);
  const existingInfo = readWorkspaceAgentsFile(workspace);
  const merged = mergeAgentsMarkdown(existingInfo.exists ? existingInfo.content : null, generatedSection);
  writeWorkspaceAgentsFile(workspace, merged);
  return {
    content: merged,
    generatedSection,
    summary,
    created: !existingInfo.exists,
    updated: existingInfo.exists,
  };
}
