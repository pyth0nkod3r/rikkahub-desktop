// workspace/file-intel.ts — File inspection & intelligent workspace search modes (adopted from Agent-2)

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { Workspace } from "../foundation/types";
import { assertInsideWorkspace } from "./boundary";

export type IntelSearchMode = "content" | "filename" | "recent" | "secrets" | "duplicates";

export interface FileIntelReport {
  relPath: string;
  size: number;
  modifiedAt: number;
  extension: string;
  isBinary: boolean;
  lineCount: number;
  sha256: string;
  outline: string[];
}

export interface IntelSearchHit {
  mode: IntelSearchMode;
  path: string;
  line?: number;
  preview?: string;
  modifiedAt?: number;
  size?: number;
  hash?: string;
  duplicatePaths?: string[];
  rule?: string;
}

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".cache",
  ".turbo",
  "target",
  "vendor",
  ".venv",
  "venv",
  ".rikkahub-worktrees",
]);

const MAX_SCAN_FILES = 1500;
const MAX_READ_BYTES = 512 * 1024;

const SECRET_RULES: Array<{ name: string; re: RegExp }> = [
  { name: "AWS Access Key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "OpenAI / Stripe Secret Key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "GitHub Token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "Google API Key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Private Key Block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
];

function isProbablyBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}

function maskSecretLine(line: string, match: RegExpExecArray): string {
  const raw = match[0];
  const masked = raw.length <= 8 ? "***" : `${raw.slice(0, 4)}***${raw.slice(-2)}`;
  return line.replace(raw, masked).trim().slice(0, 140);
}

function extractOutline(text: string): string[] {
  const outline: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    if (outline.length >= 40) break;
    const line = raw.trim();
    if (
      /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const\s+[A-Z0-9_]+)\s+[A-Za-z0-9_]+/.test(line) ||
      /^(?:def|class)\s+[A-Za-z0-9_]+/.test(line) ||
      /^#{1,3}\s+.+/.test(line)
    ) {
      outline.push(line.slice(0, 100));
    }
  }
  return outline;
}

function collectWorkspaceFiles(rootDir: string): Array<{ abs: string; rel: string; size: number; modifiedAt: number }> {
  const out: Array<{ abs: string; rel: string; size: number; modifiedAt: number }> = [];
  const walk = (dir: string): void => {
    if (out.length >= MAX_SCAN_FILES) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= MAX_SCAN_FILES) break;
      if (IGNORED_DIRS.has(name)) continue;
      const abs = join(dir, name);
      try {
        const st = statSync(abs);
        if (st.isDirectory()) {
          walk(abs);
        } else if (st.isFile()) {
          const rel = relative(rootDir, abs).replace(/\\/g, "/");
          out.push({ abs, rel, size: st.size, modifiedAt: st.mtimeMs });
        }
      } catch {
        // skip unreadable entries
      }
    }
  };
  walk(rootDir);
  return out;
}

export function inspectWorkspaceFile(workspace: Workspace, relPath: string): FileIntelReport {
  const abs = assertInsideWorkspace(join(workspace.root, relPath), workspace.root);
  const st = statSync(abs);
  const buf = st.size <= MAX_READ_BYTES ? readFileSync(abs) : Buffer.alloc(0);
  const binary = st.size > MAX_READ_BYTES ? false : isProbablyBinary(buf);
  const text = !binary && buf.length > 0 ? buf.toString("utf8") : "";
  const sha256 = buf.length > 0 ? createHash("sha256").update(buf).digest("hex") : "";
  return {
    relPath: relative(workspace.root, abs).replace(/\\/g, "/"),
    size: st.size,
    modifiedAt: st.mtimeMs,
    extension: extname(abs).toLowerCase(),
    isBinary: binary,
    lineCount: text ? text.split(/\r?\n/).length : 0,
    sha256,
    outline: text ? extractOutline(text) : [],
  };
}

export function searchWorkspaceIntelligence(
  workspace: Workspace,
  options: { mode: IntelSearchMode; query?: string; limit?: number },
): IntelSearchHit[] {
  const mode = options.mode;
  const query = (options.query ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(100, Math.trunc(options.limit ?? 30)));
  const files = collectWorkspaceFiles(workspace.root);

  if (mode === "filename") {
    return files
      .filter((f) => !query || f.rel.toLowerCase().includes(query))
      .slice(0, limit)
      .map((f) => ({
        mode,
        path: f.rel,
        size: f.size,
        modifiedAt: f.modifiedAt,
      }));
  }

  if (mode === "recent") {
    return files
      .filter((f) => !query || f.rel.toLowerCase().includes(query))
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
      .slice(0, limit)
      .map((f) => ({
        mode,
        path: f.rel,
        size: f.size,
        modifiedAt: f.modifiedAt,
      }));
  }

  if (mode === "duplicates") {
    const byHash = new Map<string, { size: number; paths: string[] }>();
    for (const f of files) {
      if (f.size === 0 || f.size > MAX_READ_BYTES) continue;
      try {
        const hash = createHash("sha256").update(readFileSync(f.abs)).digest("hex");
        const bucket = byHash.get(hash) ?? { size: f.size, paths: [] };
        bucket.paths.push(f.rel);
        byHash.set(hash, bucket);
      } catch {
        // skip
      }
    }
    const hits: IntelSearchHit[] = [];
    for (const [hash, bucket] of byHash.entries()) {
      if (bucket.paths.length < 2) continue;
      hits.push({
        mode,
        path: bucket.paths[0],
        hash,
        size: bucket.size,
        duplicatePaths: bucket.paths,
        preview: `${bucket.paths.length} identical copies (${bucket.size} bytes)`,
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  if (mode === "secrets") {
    const hits: IntelSearchHit[] = [];
    for (const f of files) {
      if (hits.length >= limit) break;
      if (f.size === 0 || f.size > MAX_READ_BYTES) continue;
      try {
        const buf = readFileSync(f.abs);
        if (isProbablyBinary(buf)) continue;
        const lines = buf.toString("utf8").split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (hits.length >= limit) break;
          for (const rule of SECRET_RULES) {
            const m = rule.re.exec(lines[i]);
            if (m) {
              hits.push({
                mode,
                path: f.rel,
                line: i + 1,
                rule: rule.name,
                preview: maskSecretLine(lines[i], m),
              });
              break;
            }
          }
        }
      } catch {
        // skip
      }
    }
    return hits;
  }

  // Default: content search
  if (!query) return [];
  const hits: IntelSearchHit[] = [];
  for (const f of files) {
    if (hits.length >= limit) break;
    if (f.size === 0 || f.size > MAX_READ_BYTES) continue;
    try {
      const buf = readFileSync(f.abs);
      if (isProbablyBinary(buf)) continue;
      const lines = buf.toString("utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (hits.length >= limit) break;
        if (lines[i].toLowerCase().includes(query)) {
          hits.push({
            mode: "content",
            path: f.rel,
            line: i + 1,
            preview: lines[i].trim().slice(0, 160),
          });
        }
      }
    } catch {
      // skip
    }
  }
  return hits;
}
