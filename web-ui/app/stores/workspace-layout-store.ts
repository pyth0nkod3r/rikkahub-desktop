import { create } from "zustand";

export type ChatWidthMode = "compact" | "comfortable" | "expanded" | "full";
export type SidecarTab = "subagents" | "files" | "context" | "diff";

export interface ActiveDiffItem {
  file: string;
  diff: string;
}

interface WorkspaceLayoutState {
  widthMode: ChatWidthMode;
  sidecarOpen: boolean;
  sidecarTab: SidecarTab;
  activeDiff: ActiveDiffItem | null;

  setWidthMode: (mode: ChatWidthMode) => void;
  toggleWidthMode: () => void;
  setSidecarOpen: (open: boolean) => void;
  toggleSidecar: () => void;
  setSidecarTab: (tab: SidecarTab) => void;
  openDiff: (diff: ActiveDiffItem) => void;
  closeDiff: () => void;
}

const STORAGE_WIDTH_KEY = "rikkahub.chat_width_mode";
const STORAGE_SIDECAR_KEY = "rikkahub.sidecar_open";
const STORAGE_TAB_KEY = "rikkahub.sidecar_tab";

function getInitialWidth(): ChatWidthMode {
  if (typeof window === "undefined") return "comfortable";
  const stored = localStorage.getItem(STORAGE_WIDTH_KEY);
  if (stored === "compact" || stored === "comfortable" || stored === "expanded" || stored === "full") {
    return stored;
  }
  return "comfortable";
}

function getInitialSidecarOpen(): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem(STORAGE_SIDECAR_KEY);
  if (stored !== null) return stored === "true";
  return false;
}

function getInitialTab(): SidecarTab {
  if (typeof window === "undefined") return "subagents";
  const stored = localStorage.getItem(STORAGE_TAB_KEY);
  if (stored === "subagents" || stored === "files" || stored === "context" || stored === "diff") {
    return stored;
  }
  return "subagents";
}

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>((set, get) => ({
  widthMode: getInitialWidth(),
  sidecarOpen: getInitialSidecarOpen(),
  sidecarTab: getInitialTab(),
  activeDiff: null,

  setWidthMode: (mode) => {
    localStorage.setItem(STORAGE_WIDTH_KEY, mode);
    set({ widthMode: mode });
  },

  toggleWidthMode: () => {
    const current = get().widthMode;
    const cycle: Record<ChatWidthMode, ChatWidthMode> = {
      compact: "comfortable",
      comfortable: "expanded",
      expanded: "full",
      full: "compact",
    };
    const next = cycle[current];
    localStorage.setItem(STORAGE_WIDTH_KEY, next);
    set({ widthMode: next });
  },

  setSidecarOpen: (open) => {
    localStorage.setItem(STORAGE_SIDECAR_KEY, String(open));
    set({ sidecarOpen: open });
  },

  toggleSidecar: () => {
    const next = !get().sidecarOpen;
    localStorage.setItem(STORAGE_SIDECAR_KEY, String(next));
    set({ sidecarOpen: next });
  },

  setSidecarTab: (tab) => {
    localStorage.setItem(STORAGE_TAB_KEY, tab);
    set({ sidecarTab: tab, sidecarOpen: true });
  },

  openDiff: (diff) => {
    set({ activeDiff: diff, sidecarTab: "diff", sidecarOpen: true });
  },

  closeDiff: () => {
    set({ activeDiff: null, sidecarTab: "files" });
  },
}));

export function getChatWidthClass(widthMode: ChatWidthMode): string {
  switch (widthMode) {
    case "compact":
      return "max-w-3xl"; // 768px (Default classic clamp)
    case "comfortable":
      return "max-w-5xl"; // 1024px (Spacious and balanced)
    case "expanded":
      return "max-w-7xl"; // 1280px (Ultra-wide screen utilization)
    case "full":
      return "max-w-[96vw]"; // Near edge-to-edge
    default:
      return "max-w-5xl";
  }
}
