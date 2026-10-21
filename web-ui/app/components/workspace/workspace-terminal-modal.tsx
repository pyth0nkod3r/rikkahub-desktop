// components/workspace/workspace-terminal-modal.tsx — Interactive Manual Sandbox Shell / Terminal Modal
import * as React from "react";
import { Terminal, Play, Trash2, Copy, Check, CornerDownLeft, Loader2, Shield, Folder } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import api from "~/services/api";
import type { WorkspaceDto } from "~/types";

interface TerminalEntry {
  id: string;
  command: string;
  timestamp: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  elapsedMs: number;
}

interface WorkspaceTerminalModalProps {
  workspace: WorkspaceDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkspaceTerminalModal({
  workspace,
  open,
  onOpenChange,
}: WorkspaceTerminalModalProps) {
  const [entries, setEntries] = React.useState<TerminalEntry[]>([]);
  const [inputCommand, setInputCommand] = React.useState("");
  const [executing, setExecuting] = React.useState(false);
  const [history, setHistory] = React.useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState<number>(-1);

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Auto-scroll on new entries
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, executing]);

  // Focus input when opened
  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  const executeCommand = async (cmdToRun?: string) => {
    const raw = (cmdToRun ?? inputCommand).trim();
    if (!raw || executing) return;

    if (raw === "clear" || raw === "cls") {
      setEntries([]);
      setInputCommand("");
      return;
    }

    setExecuting(true);
    const start = Date.now();
    const entryId = Math.random().toString(36).slice(2);

    // Update history
    setHistory((prev) => {
      const next = prev.filter((item) => item !== raw);
      next.push(raw);
      return next;
    });
    setHistoryIndex(-1);
    setInputCommand("");

    try {
      const res = await api.post<{
        ok: boolean;
        exitCode: number;
        stdout: string;
        stderr: string;
        cwd: string;
      }>(`workspaces/${workspace.id}/terminal/exec`, {
        command: raw,
      });

      const entry: TerminalEntry = {
        id: entryId,
        command: raw,
        timestamp: Date.now(),
        stdout: res.stdout || "",
        stderr: res.stderr || "",
        exitCode: res.exitCode ?? 0,
        elapsedMs: Date.now() - start,
      };

      setEntries((prev) => [...prev, entry]);
    } catch (err) {
      const entry: TerminalEntry = {
        id: entryId,
        command: raw,
        timestamp: Date.now(),
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: 1,
        elapsedMs: Date.now() - start,
      };
      setEntries((prev) => [...prev, entry]);
    } finally {
      setExecuting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void executeCommand();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInputCommand(history[nextIndex]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === -1) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(-1);
        setInputCommand("");
      } else {
        setHistoryIndex(nextIndex);
        setInputCommand(history[nextIndex]);
      }
    }
  };

  const copyOutput = (text: string) => {
    void navigator.clipboard.writeText(text);
    toast.success("Output copied to clipboard");
  };

  const sandboxLabel =
    workspace.sandboxBackend === "wsl"
      ? `WSL2 (${workspace.sandboxImage || "default"})`
      : workspace.sandboxBackend === "docker"
      ? `Docker (${workspace.sandboxImage || "default"})`
      : "Local (MSYS2/Git-Bash)";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden bg-background border border-border shadow-2xl">
        <DialogHeader className="p-4 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Terminal className="size-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold flex items-center gap-2">
                <span>{workspace.name}</span>
                <Badge variant="outline" className="font-mono text-mini gap-1 py-0">
                  <Shield className="size-3 text-primary" />
                  {sandboxLabel}
                </Badge>
              </DialogTitle>
              <div className="text-mini text-muted-foreground truncate max-w-[550px] flex items-center gap-1.5 mt-0.5">
                <Folder className="size-3" />
                <span className="font-mono">{workspace.root || "Managed directory"}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mr-6">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEntries([])}
              className="h-7 text-mini px-2 gap-1"
              title="Clear Terminal Screen"
            >
              <Trash2 className="size-3" />
              Clear
            </Button>
          </div>
        </DialogHeader>

        {/* Terminal output area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-xs bg-card/40 space-y-3 select-text"
        >
          {entries.length === 0 && !executing ? (
            <div className="text-muted-foreground/60 p-4 text-center select-none">
              <div className="mb-2">AgentX Sandboxed Terminal initialized.</div>
              <div className="text-mini">
                Backend: <span className="text-foreground">{sandboxLabel}</span> | CWD:{" "}
                <span className="text-foreground">{workspace.root}</span>
              </div>
              <div className="mt-4 flex justify-center gap-2 flex-wrap">
                {["ls -la", "pwd", "git status", "whoami"].map((quick) => (
                  <button
                    key={quick}
                    type="button"
                    onClick={() => void executeCommand(quick)}
                    className="px-2 py-1 rounded bg-muted hover:bg-muted/80 text-foreground text-mini transition-colors"
                  >
                    {quick}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {entries.map((entry) => (
            <div key={entry.id} className="space-y-1 group">
              <div className="flex items-center justify-between text-mini text-muted-foreground border-b border-border/30 pb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-primary font-bold">$</span>
                  <span className="text-foreground font-semibold">{entry.command}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px]">{entry.elapsedMs}ms</span>
                  <Badge
                    variant={entry.exitCode === 0 ? "secondary" : "destructive"}
                    className="text-[10px] px-1 py-0 h-4"
                  >
                    exit {entry.exitCode}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => copyOutput(entry.stdout || entry.stderr)}
                    className="opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
                    title="Copy output"
                  >
                    <Copy className="size-3" />
                  </button>
                </div>
              </div>

              {entry.stdout ? (
                <pre className="whitespace-pre-wrap break-all text-foreground/90 pl-3 leading-relaxed">
                  {entry.stdout}
                </pre>
              ) : null}

              {entry.stderr ? (
                <pre className="whitespace-pre-wrap break-all text-destructive pl-3 leading-relaxed">
                  {entry.stderr}
                </pre>
              ) : null}
            </div>
          ))}

          {executing ? (
            <div className="flex items-center gap-2 text-muted-foreground pt-1 pl-3">
              <Loader2 className="size-3.5 animate-spin text-primary" />
              <span>Running command...</span>
            </div>
          ) : null}
        </div>

        {/* Quick buttons & Interactive Input Prompt */}
        <div className="border-t border-border bg-background p-3 space-y-2">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-mini text-muted-foreground">
            <span className="text-[11px] shrink-0 font-medium">Presets:</span>
            {["ls -la", "pwd", "git status", "env"].map((cmd) => (
              <button
                key={cmd}
                type="button"
                disabled={executing}
                onClick={() => void executeCommand(cmd)}
                className="px-2 py-0.5 rounded border border-border/60 bg-muted/50 hover:bg-muted text-foreground text-[11px] transition-colors shrink-0 disabled:opacity-50"
              >
                {cmd}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-1.5 focus-within:ring-1 focus-within:ring-ring">
            <span className="font-mono text-primary font-bold text-sm">$</span>
            <input
              ref={inputRef}
              type="text"
              value={inputCommand}
              onChange={(e) => setInputCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={executing}
              placeholder={executing ? "Command running..." : "Type a shell command (or use Up/Down for history)..."}
              className="flex-1 bg-transparent font-mono text-xs text-foreground focus:outline-none placeholder:text-muted-foreground/60"
            />
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={executing || !inputCommand.trim()}
              onClick={() => void executeCommand()}
              className="h-7 px-2.5 text-xs gap-1"
            >
              {executing ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <>
                  <Play className="size-3" />
                  Run
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
