// model-providers/codex-oauth/repository.ts — ChatGPT / Codex OAuth Multi-Account Repository
// Ported from rikkahub-agent (Pyth0nkod3r fork) CodexAccountRepository.kt

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../../foundation/paths";
import type { CodexAccount, CodexAccountState, CodexUsageSnapshot } from "./types";

export const CODEX_CLIENT_ID = "app-p98c627e776e";
export const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

export function parseJwtPayload(token: string): Record<string, any> {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return {};
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const jsonStr = Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(jsonStr) as Record<string, any>;
  } catch {
    return {};
  }
}

export function parseCodexIdentity(idToken: string): { userId: string; name: string; email: string; accountId: string } {
  const claims = parseJwtPayload(idToken);
  const authClaims = (claims["https://api.openai.com/auth"] || {}) as Record<string, any>;

  const userId = String(claims.sub || "");
  const name = String(claims.name || claims.nickname || "");
  const email = String(claims.email || "");
  const accountId = String(authClaims.chatgpt_account_id || authClaims.account_id || "");

  return { userId, name, email, accountId };
}

export class CodexAccountRepository {
  private filePath: string;
  private state: CodexAccountState;
  private refreshMarginMs = 5 * 60 * 1000;

  constructor(customPath?: string) {
    this.filePath = customPath || join(dataDir, "codex-accounts.json");
    this.state = this.read();
  }

  private read(): CodexAccountState {
    try {
      if (existsSync(this.filePath)) {
        const text = readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(text) as CodexAccountState;
        const now = Date.now();
        const accounts = (parsed.accounts || []).map((acc) => {
          if (acc.tokenStatus !== "INVALID" && acc.expiresAt <= now) {
            return { ...acc, tokenStatus: "EXPIRED" as const };
          }
          return acc;
        });
        return {
          accounts,
          nextAccountIndex: parsed.nextAccountIndex || 0,
        };
      }
    } catch {
      // Ignore
    }
    return { accounts: [], nextAccountIndex: 0 };
  }

  private write(): void {
    try {
      const dir = join(this.filePath, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
    } catch {
      // Ignore
    }
  }

  listAccounts(): CodexAccount[] {
    return [...this.state.accounts];
  }

  getAccount(id: string): CodexAccount | undefined {
    return this.state.accounts.find((a) => a.id === id);
  }

  async saveLogin(tokenJson: {
    id_token?: string;
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }): Promise<CodexAccount> {
    const accessToken = tokenJson.access_token;
    if (!accessToken) throw new Error("Missing access_token");

    const identity = tokenJson.id_token
      ? parseCodexIdentity(tokenJson.id_token)
      : { userId: "", name: "", email: "", accountId: "" };

    const expiresAt = Date.now() + (Number(tokenJson.expires_in) || 3600) * 1000;
    const id = identity.userId || identity.email || `chatgpt-${Date.now()}`;
    const existing = this.getAccount(id);

    const refreshToken = tokenJson.refresh_token || existing?.refreshToken;
    if (!refreshToken) {
      throw new Error("Missing refresh token. Please sign in again.");
    }

    const account: CodexAccount = {
      id,
      userId: identity.userId,
      name: identity.name || identity.email || "ChatGPT Account",
      email: identity.email,
      chatgptAccountId: identity.accountId || existing?.chatgptAccountId || "",
      accessToken,
      refreshToken,
      expiresAt,
      enabled: existing?.enabled ?? true,
      tokenStatus: "AVAILABLE",
      usage: existing?.usage || null,
    };

    this.state.accounts = this.state.accounts.filter((a) => a.id !== id).concat(account);
    this.write();

    void this.refreshUsage(account.id).catch(() => {});

    return account;
  }

  async ensureFresh(account: CodexAccount): Promise<CodexAccount> {
    const now = Date.now();
    if (account.tokenStatus !== "INVALID" && account.expiresAt - now > this.refreshMarginMs) {
      return account;
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CODEX_CLIENT_ID,
      refresh_token: account.refreshToken,
    });

    try {
      const res = await fetch(CODEX_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!res.ok) {
        if (res.status === 400 || res.status === 401) {
          const updated = { ...account, tokenStatus: "INVALID" as const };
          this.updateAccount(updated);
          return updated;
        }
        throw new Error(`Token refresh failed: ${res.status}`);
      }

      const json = (await res.json()) as Record<string, any>;
      const newAccess = json.access_token as string;
      const expiresIn = (Number(json.expires_in) || 3600) * 1000;

      const updated: CodexAccount = {
        ...account,
        accessToken: newAccess,
        expiresAt: Date.now() + expiresIn,
        tokenStatus: "AVAILABLE",
      };
      this.updateAccount(updated);
      return updated;
    } catch {
      if (account.expiresAt <= now) {
        const updated = { ...account, tokenStatus: "EXPIRED" as const };
        this.updateAccount(updated);
        return updated;
      }
      return account;
    }
  }

  async acquireAccount(): Promise<CodexAccount> {
    const accounts = this.state.accounts;
    if (accounts.length === 0) {
      throw new Error("No ChatGPT account is signed in. Please sign in with ChatGPT OAuth in Settings > Providers.");
    }

    const availableIndices = selectCodexAccountIndices(accounts, this.state.nextAccountIndex);
    if (availableIndices.length === 0) {
      throw new Error("No available ChatGPT account (all accounts are disabled or invalid).");
    }

    for (const idx of availableIndices) {
      const candidate = accounts[idx];
      this.state.nextAccountIndex = (idx + 1) % accounts.length;
      this.write();

      try {
        const fresh = await this.ensureFresh(candidate);
        if (fresh.tokenStatus === "AVAILABLE") {
          return fresh;
        }
      } catch {
        continue;
      }
    }

    throw new Error("No available ChatGPT account could be authenticated.");
  }

  async refreshUsage(accountId: string): Promise<CodexAccount | null> {
    const account = this.getAccount(accountId);
    if (!account) return null;

    const fresh = await this.ensureFresh(account);
    if (fresh.tokenStatus === "INVALID") return fresh;

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${fresh.accessToken}`,
        originator: "codex_cli_rs",
        Accept: "application/json",
      };
      if (fresh.chatgptAccountId) {
        headers["ChatGPT-Account-Id"] = fresh.chatgptAccountId;
      }

      const res = await fetch(`${CODEX_BASE_URL}/wham/usage`, { headers });
      if (!res.ok) {
        if (res.status === 401) {
          const updated = { ...fresh, tokenStatus: "INVALID" as const };
          this.updateAccount(updated);
          return updated;
        }
        return fresh;
      }

      const json = (await res.json()) as Record<string, any>;
      const usage = parseCodexUsage(json);
      if (usage) {
        const updated = { ...fresh, usage, tokenStatus: "AVAILABLE" as const };
        this.updateAccount(updated);
        return updated;
      }
    } catch {
      // Best-effort
    }

    return fresh;
  }

  setEnabled(accountId: string, enabled: boolean): CodexAccount | null {
    const account = this.getAccount(accountId);
    if (!account) return null;
    const updated = { ...account, enabled };
    this.updateAccount(updated);
    return updated;
  }

  deleteAccount(accountId: string): boolean {
    const prevLen = this.state.accounts.length;
    this.state.accounts = this.state.accounts.filter((a) => a.id !== accountId);
    if (this.state.accounts.length !== prevLen) {
      this.write();
      return true;
    }
    return false;
  }

  private updateAccount(account: CodexAccount): void {
    this.state.accounts = this.state.accounts.map((a) => (a.id === account.id ? account : a));
    this.write();
  }
}

export function selectCodexAccountIndices(accounts: CodexAccount[], startIndex: number): number[] {
  const result: number[] = [];
  if (accounts.length === 0) return result;
  for (let offset = 0; offset < accounts.length; offset++) {
    const idx = (startIndex + offset) % accounts.length;
    const acc = accounts[idx];
    if (acc.enabled && acc.tokenStatus !== "INVALID") {
      result.push(idx);
    }
  }
  return result;
}

export function parseCodexUsage(json: Record<string, any>): CodexUsageSnapshot | null {
  const limit = json.rate_limit || json.rateLimit || json;
  const remaining = typeof limit.remaining === "number" ? limit.remaining : null;
  const total = typeof limit.limit === "number" ? limit.limit : null;
  const resetsAt = typeof limit.reset_at === "number" ? limit.reset_at : null;

  let remainingPercent: number | undefined;
  if (remaining !== null && total !== null && total > 0) {
    remainingPercent = Math.round((remaining / total) * 100);
  }

  return {
    usedTokens: total && remaining !== null ? total - remaining : undefined,
    totalTokens: total ?? undefined,
    remainingPercent,
    resetsAt: resetsAt ?? undefined,
    updatedAt: Date.now(),
  };
}

export const codexAccountRepository = new CodexAccountRepository();
