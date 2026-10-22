// model-providers/gemini-oauth/types.ts — Gemini OAuth Multi-Account Types
// Ported from rikkahub-agent (Pyth0nkod3r fork) GeminiAccount.kt

export type GeminiTokenStatus = "UNKNOWN" | "AVAILABLE" | "EXPIRED" | "INVALID" | "RATE_LIMITED";

export interface GeminiUsageWindow {
  remainingFraction: number; // 0.0 to 1.0
  resetsAt: number | null;   // epoch seconds
}

export interface GeminiUsageSnapshot {
  daily: GeminiUsageWindow | null;
  weekly: GeminiUsageWindow | null;
  updatedAt: number;
}

export interface GeminiAccount {
  id: string;              // email or project id
  name: string;
  email: string;
  projectId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;       // epoch ms
  enabled: boolean;
  tokenStatus: GeminiTokenStatus;
  usage: GeminiUsageSnapshot | null;
}

export interface GeminiAccountState {
  accounts: GeminiAccount[];
  nextAccountIndex: number;
}
