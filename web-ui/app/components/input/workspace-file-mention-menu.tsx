import * as React from "react";
import { File, FileCode, FileText, Folder } from "lucide-react";
import { cn } from "~/lib/utils";

export interface WorkspaceFileMatch {
  path: string;
  name: string;
  type: "file" | "dir";
}

export interface WorkspaceFileMentionMenuProps {
  id: string;
  matches: readonly WorkspaceFileMatch[];
  selectedIndex: number;
  query: string;
  onHover: (index: number) => void;
  onPick: (match: WorkspaceFileMatch) => void;
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const start = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (start < 0) return <span>{text}</span>;
  const end = start + query.length;
  return (
    <span>
      {text.slice(0, start)}
      <span className="font-semibold text-primary underline underline-offset-2">{text.slice(start, end)}</span>
      {text.slice(end)}
    </span>
  );
}

function getFileIcon(match: WorkspaceFileMatch) {
  if (match.type === "dir") {
    return <Folder className="size-4 shrink-0 text-amber-500/80" />;
  }
  const ext = match.name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "json", "yaml", "yml"].includes(ext)) {
    return <FileCode className="size-4 shrink-0 text-blue-500/80" />;
  }
  if (["md", "txt", "doc", "pdf"].includes(ext)) {
    return <FileText className="size-4 shrink-0 text-emerald-500/80" />;
  }
  return <File className="size-4 shrink-0 text-muted-foreground" />;
}

export function WorkspaceFileMentionMenu({
  id,
  matches,
  selectedIndex,
  query,
  onHover,
  onPick,
}: WorkspaceFileMentionMenuProps) {
  if (matches.length === 0) return null;

  return (
    <div
      id={id}
      role="listbox"
      aria-label="Workspace Files"
      className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-[420px] overflow-hidden rounded-xl border border-border/80 bg-popover/95 backdrop-blur text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95"
    >
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5 text-[11px] font-medium text-muted-foreground bg-muted/40">
        <span>Mention workspace file (@)</span>
        <span className="text-[10px] opacity-70">?? to navigate ? Enter to select</span>
      </div>
      <div className="max-h-[260px] overflow-y-auto p-1 styled-scrollbar">
        {matches.map((match, index) => {
          const active = index === selectedIndex;
          const dirParts = match.path.split("/");
          const dir = dirParts.length > 1 ? dirParts.slice(0, -1).join("/") : "";

          return (
            <button
              key={match.path}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={active}
              type="button"
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors outline-none",
                active ? "bg-accent text-accent-foreground font-medium" : "hover:bg-accent/50 text-foreground",
              )}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(match);
              }}
            >
              {getFileIcon(match)}
              <div className="min-w-0 flex-1 flex flex-col">
                <span className="truncate">
                  <HighlightMatch text={match.name} query={query} />
                </span>
                {dir && (
                  <span className="truncate text-[10px] text-muted-foreground/75 leading-tight">
                    {dir}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
