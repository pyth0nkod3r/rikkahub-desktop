import * as React from "react";
import { Hammer, ClipboardList, Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import api from "~/services/api";
import { useConversationStore } from "~/stores/conversation-store";

export interface AgentModePickerProps {
  conversationId?: string | null;
  agentMode?: "build" | "plan";
  onModeChange?: (mode: "build" | "plan") => void;
  className?: string;
  disabled?: boolean;
}

export function AgentModePicker({
  conversationId,
  agentMode: propMode,
  onModeChange,
  className,
  disabled = false,
}: AgentModePickerProps) {
  // Read from store if not provided via prop
  const storeMode = useConversationStore((state) =>
    conversationId ? state.entries[conversationId]?.detail?.agentMode : undefined,
  );

  const [localMode, setLocalMode] = React.useState<"build" | "plan">(propMode ?? storeMode ?? "build");

  // Keep synced
  React.useEffect(() => {
    if (propMode) {
      setLocalMode(propMode);
    } else if (storeMode) {
      setLocalMode(storeMode);
    }
  }, [propMode, storeMode]);

  const currentMode = localMode;
  const isPlan = currentMode === "plan";

  const handleSelect = async (mode: "build" | "plan") => {
    if (mode === currentMode) return;
    setLocalMode(mode);
    onModeChange?.(mode);

    if (conversationId) {
      try {
        await api.post(`conversations/${conversationId}/agent-mode`, { mode });
        toast.success(
          mode === "plan"
            ? "Switched to Plan Mode 📋 (Read-only analysis & proposal)"
            : "Switched to Build Mode 🔨 (Full execution unlocked)",
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to switch agent mode");
      }
    } else {
      toast.info(mode === "plan" ? "Plan Mode 📋 selected" : "Build Mode 🔨 selected");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-8 gap-1.5 px-2.5 text-xs font-medium rounded-full transition-all border",
            isPlan
              ? "bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25"
              : "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20",
            className,
          )}
          title={isPlan ? "Current: Plan Mode (Read-only)" : "Current: Build Mode (Full Execution)"}
        >
          {isPlan ? (
            <>
              <ClipboardList className="size-3.5 shrink-0 text-amber-500 animate-pulse" />
              <span>Plan Mode</span>
            </>
          ) : (
            <>
              <Hammer className="size-3.5 shrink-0 text-emerald-500" />
              <span>Build Mode</span>
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-1.5">
        <DropdownMenuLabel className="px-2 py-1 text-xs font-semibold text-muted-foreground">
          Interactive Agent Mode
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuItem
          className={cn(
            "flex items-start gap-2.5 p-2 rounded-md cursor-pointer",
            !isPlan && "bg-accent/60 text-accent-foreground",
          )}
          onClick={() => void handleSelect("build")}
        >
          <Hammer className="size-4 shrink-0 text-emerald-500 mt-0.5" />
          <div className="flex-1 space-y-0.5">
            <div className="flex items-center justify-between text-xs font-medium">
              <span>Build Mode</span>
              {!isPlan && <Check className="size-3.5 text-emerald-500" />}
            </div>
            <div className="text-mini text-muted-foreground leading-normal">
              Full tool execution. Agent can execute bash, edit files, and make workspace modifications.
            </div>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem
          className={cn(
            "flex items-start gap-2.5 p-2 rounded-md cursor-pointer mt-1",
            isPlan && "bg-accent/60 text-accent-foreground",
          )}
          onClick={() => void handleSelect("plan")}
        >
          <ClipboardList className="size-4 shrink-0 text-amber-500 mt-0.5" />
          <div className="flex-1 space-y-0.5">
            <div className="flex items-center justify-between text-xs font-medium">
              <span>Plan Mode</span>
              {isPlan && <Check className="size-3.5 text-amber-500" />}
            </div>
            <div className="text-mini text-muted-foreground leading-normal">
              Safe read-only analysis. Agent gathers facts and proposes a structured plan for your approval.
            </div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AgentPlanModeBanner({ conversationId }: { conversationId?: string | null }) {
  const storeMode = useConversationStore((state) =>
    conversationId ? state.entries[conversationId]?.detail?.agentMode : undefined,
  );

  if (storeMode !== "plan") return null;

  const switchToBuild = async () => {
    if (!conversationId) return;
    try {
      await api.post(`conversations/${conversationId}/agent-mode`, { mode: "build" });
      toast.success("Switched to Build Mode 🔨 (Full execution unlocked)");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to switch mode");
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300 animate-in fade-in-0 duration-200">
      <div className="flex items-center gap-1.5 font-medium truncate">
        <ClipboardList className="size-3.5 shrink-0 text-amber-500" />
        <span className="truncate">Plan Mode Active — Agent will inspect and propose a plan for approval before modifying anything.</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void switchToBuild()}
        className="h-6 shrink-0 gap-1 px-2 text-mini font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-500/20"
      >
        <Hammer className="size-3" />
        <span>Switch to Build</span>
      </Button>
    </div>
  );
}
