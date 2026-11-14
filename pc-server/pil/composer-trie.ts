// pil/composer-trie.ts — Offline Personal Intelligence Layer (PIL) Autocomplete Trie
// Adopted from Agent-2 architecture (agent2/core/pil/)
// Fast, sub-millisecond local composer autocompletion with technical span preservation.

interface TrieNode {
  children: Map<string, TrieNode>;
  frequency: number;
  isWord: boolean;
  word?: string;
}

export class ComposerTrie {
  private root: TrieNode = {
    children: new Map(),
    frequency: 0,
    isWord: false,
  };

  constructor(initialWords?: string[]) {
    if (initialWords) {
      for (const w of initialWords) {
        this.insert(w);
      }
    }
  }

  insert(word: string, initialWeight = 1): void {
    if (!word || !word.trim()) return;
    const clean = word.trim();
    let current = this.root;

    for (const char of clean.toLowerCase()) {
      let next = current.children.get(char);
      if (!next) {
        next = {
          children: new Map(),
          frequency: 0,
          isWord: false,
        };
        current.children.set(char, next);
      }
      current = next;
    }

    current.isWord = true;
    current.word = clean;
    current.frequency = (current.frequency || 0) + initialWeight;
  }

  boost(word: string, delta = 1): void {
    this.insert(word, delta);
  }

  penalize(word: string, delta = 0.5): void {
    if (!word) return;
    let current = this.root;
    for (const char of word.trim().toLowerCase()) {
      const next = current.children.get(char);
      if (!next) return;
      current = next;
    }
    if (current.isWord) {
      current.frequency = Math.max(0, current.frequency - delta);
    }
  }

  searchPrefix(prefix: string, limit = 5): string[] {
    if (!prefix || !prefix.trim()) return [];
    const cleanPrefix = prefix.trim().toLowerCase();
    let current = this.root;

    for (const char of cleanPrefix) {
      const next = current.children.get(char);
      if (!next) return [];
      current = next;
    }

    const matches: Array<{ word: string; frequency: number }> = [];
    this.collectWords(current, matches);

    // Sort by frequency descending
    matches.sort((a, b) => b.frequency - a.frequency);
    return matches.slice(0, limit).map((m) => m.word);
  }

  private collectWords(node: TrieNode, out: Array<{ word: string; frequency: number }>): void {
    if (node.isWord && node.word) {
      out.push({ word: node.word, frequency: node.frequency });
    }
    for (const child of node.children.values()) {
      this.collectWords(child, out);
    }
  }
}

/** Pre-populated developer vocabulary for RikkaHub & coding tasks */
export const DEFAULT_DEVELOPER_TERMS = [
  "subagent_dispatch",
  "subagent_dag_run",
  "subagent_dag_plan",
  "subagent_reinject",
  "subagent_list",
  "subagent_get",
  "bun test",
  "bun run build",
  "git status",
  "git commit",
  "git push",
  "git diff",
  "AGENTS.md",
  "refactor",
  "architecture",
  "typescript",
  "orchestrator",
  "verification",
  "worktree",
  "workspace",
  "breakpoint",
  "compaction",
];

export const globalComposerTrie = new ComposerTrie(DEFAULT_DEVELOPER_TERMS);
