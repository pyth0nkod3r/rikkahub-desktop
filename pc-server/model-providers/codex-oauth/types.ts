// model-providers/codex-oauth/types.ts — ChatGPT / Codex OAuth Multi-Account Types
// Ported from rikkahub-agent (Pyth0nkod3r fork) CodexAccount.kt

export type CodexTokenStatus = "UNKNOWN" | "AVAILABLE" | "EXPIRED" | "INVALID" | "RATE_LIMITED";

export interface CodexUsageSnapshot {
  usedTokens?: number;
  totalTokens?: number;
  remainingPercent?: number;
  resetsAt?: number;
  updatedAt: number;
}

export interface CodexAccount {
  id: string;              // unique account id
  userId: string;
  name: string;
  email: string;
  chatgptAccountId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;       // epoch ms
  enabled: boolean;
  tokenStatus: CodexTokenStatus;
  usage: CodexUsageSnapshot | null;
}

export interface CodexAccountState {
  accounts: CodexAccount[];
  nextAccountIndex: number;
}
