import * as React from "react";
import api from "~/services/api";
import type { WorkspaceFileMatch } from "~/components/input/workspace-file-mention-menu";

export interface UseFileMentionOptions {
  text: string;
  workspaceId?: string | null;
  enabled?: boolean;
  onCompleteText: (text: string) => void;
}

export function useFileMention({ text, workspaceId, enabled = true, onCompleteText }: UseFileMentionOptions) {
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [matches, setMatches] = React.useState<WorkspaceFileMatch[]>([]);
  const [dismissedQuery, setDismissedQuery] = React.useState<string | null>(null);

  // Match @filename at the end of input or before cursor
  const mentionMatch = enabled ? text.match(/(?:^|\s)@([^\s]*)$/) : null;
  const query = mentionMatch ? mentionMatch[1] : null;

  React.useEffect(() => {
    if (!enabled || !workspaceId || query === null) {
      setMatches([]);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ matches: WorkspaceFileMatch[] }>(
          `workspaces/${encodeURIComponent(workspaceId)}/files/search?q=${encodeURIComponent(query)}`
        );
        if (active && res && Array.isArray(res.matches)) {
          setMatches(res.matches);
        }
      } catch {
        if (active) setMatches([]);
      }
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [enabled, workspaceId, query]);

  const menuOpen = query !== null && matches.length > 0 && dismissedQuery !== query;

  React.useEffect(() => {
    setSelectedIndex(0);
  }, [query, matches.length]);

  React.useEffect(() => {
    if (dismissedQuery !== null && dismissedQuery !== query) {
      setDismissedQuery(null);
    }
  }, [dismissedQuery, query]);

  const pickMatch = React.useCallback(
    (match: WorkspaceFileMatch) => {
      if (query === null) return;
      // Replace the @query suffix with @path
      const replaced = text.replace(
        /(?:^|\s)@([^\s]*)$/,
        (prefix) => (prefix.startsWith(" ") ? ` @${match.path} ` : `@${match.path} `),
      );
      onCompleteText(replaced);
      setMatches([]);
      setDismissedQuery(null);
    },
    [onCompleteText, query, text],
  );

  const handleMenuKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!menuOpen) return false;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((i) => (i + 1) % matches.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((i) => (i - 1 + matches.length) % matches.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = matches[selectedIndex];
        if (selected) pickMatch(selected);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedQuery(query);
        return true;
      }
      return false;
    },
    [matches, menuOpen, pickMatch, query, selectedIndex],
  );

  return {
    menuOpen,
    matches,
    selectedIndex,
    query: query ?? "",
    setSelectedIndex,
    pickMatch,
    handleMenuKeyDown,
  };
}
