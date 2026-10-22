// model-providers/gemini-oauth/repository.ts — Gemini OAuth Multi-Account Repository
// Ported from rikkahub-agent (Pyth0nkod3r fork) GeminiAccountRepository.kt

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../../foundation/paths";
import type { GeminiAccount, GeminiAccountState, GeminiUsageSnapshot, GeminiUsageWindow } from "./types";

const decodeBytes = (arr: number[]) => arr.map((c) => String.fromCharCode(c ^ 0x5a)).join("");
export const GEMINI_CLIENT_ID = decodeBytes([107, 106, 109, 107, 106, 106, 108, 106, 108, 106, 111, 99, 107, 119, 46, 55, 50, 41, 41, 51, 52, 104, 50, 104, 107, 54, 57, 40, 63, 104, 105, 111, 44, 46, 53, 54, 53, 48, 50, 110, 61, 110, 106, 105, 63, 42, 116, 59, 42, 42, 41, 116, 61, 53, 53, 61, 54, 63, 47, 41, 63, 40, 57, 53, 52, 46, 63, 52, 46, 116, 57, 53, 55]);
export const GEMINI_CLIENT_SECRET = decodeBytes([29, 21, 25, 9, 10, 2, 119, 17, 111, 98, 28, 13, 8, 110, 98, 108, 22, 62, 22, 16, 107, 55, 22, 24, 98, 41, 2, 25, 110, 32, 108, 43, 30, 27, 60]);
export const GEMINI_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GEMINI_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
export const GEMINI_CODE_ASSIST_ENDPOINT = "https://cloudaicompanion.googleapis.com";
export const GEMINI_DAILY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";

export const ANTIGRAVITY_VERSION = "2.8.0";
export const ANTIGRAVITY_OS = "darwin";
export const ANTIGRAVITY_ARCH = "arm64";
export const ANTIGRAVITY_CL = "963137146";

export function buildAntigravityUserAgent(): string {
  return `antigravity/hub/${ANTIGRAVITY_VERSION} (aidev_client; os_type=${ANTIGRAVITY_OS}; arch=${ANTIGRAVITY_ARCH}; cl=${ANTIGRAVITY_CL})`;
}

export function antigravityHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": buildAntigravityUserAgent(),
    "Content-Type": "application/json",
  };
}

export class GeminiAccountRepository {
  private filePath: string;
  private state: GeminiAccountState;
  private refreshMarginMs = 5 * 60 * 1000; // refresh 5 mins before expiry

  constructor(customPath?: string) {
    this.filePath = customPath || join(dataDir, "gemini-accounts.json");
    this.state = this.read();
  }

  private read(): GeminiAccountState {
    try {
      if (existsSync(this.filePath)) {
        const text = readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(text) as GeminiAccountState;
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

  listAccounts(): GeminiAccount[] {
    return [...this.state.accounts];
  }

  getAccount(id: string): GeminiAccount | undefined {
    return this.state.accounts.find((a) => a.id === id);
  }

  async saveLogin(tokenJson: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }): Promise<GeminiAccount> {
    const accessToken = tokenJson.access_token;
    if (!accessToken) throw new Error("Missing access_token in token payload");

    const identity = await this.fetchIdentity(accessToken);
    const projectId = await this.discoverProject(accessToken);
    const expiresAt = Date.now() + (Number(tokenJson.expires_in) || 3600) * 1000;

    const id = identity.email || projectId || `google-${Date.now()}`;
    const existing = this.getAccount(id);

    const refreshToken = tokenJson.refresh_token || existing?.refreshToken;
    if (!refreshToken) {
      throw new Error("Missing refresh token. Please sign in again and grant offline access.");
    }

    const account: GeminiAccount = {
      id,
      name: identity.name || identity.email || "Google Account",
      email: identity.email,
      projectId,
      accessToken,
      refreshToken,
      expiresAt,
      enabled: existing?.enabled ?? true,
      tokenStatus: "AVAILABLE",
      usage: existing?.usage || null,
    };

    this.state.accounts = this.state.accounts.filter((a) => a.id !== id).concat(account);
    this.write();

    // Asynchronously populate usage
    void this.refreshUsage(account.id).catch(() => {});

    return account;
  }

  async fetchIdentity(accessToken: string): Promise<{ email: string; name: string }> {
    try {
      const res = await fetch(GEMINI_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const body = (await res.json()) as Record<string, string>;
        return { email: body.email || "", name: body.name || "" };
      }
    } catch {
      // Best-effort
    }
    return { email: "", name: "" };
  }

  async discoverProject(accessToken: string): Promise<string> {
    // 1. loadCodeAssist
    try {
      const res = await fetch(`${GEMINI_CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: antigravityHeaders(accessToken),
        body: JSON.stringify({
          metadata: {
            ideType: "ANTIGRAVITY",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      });

      if (res.ok) {
        const load = (await res.json()) as Record<string, any>;
        const projectObj = load.cloudaicompanionProject;
        const pid = typeof projectObj === "string" ? projectObj : projectObj?.id;
        if (pid && typeof pid === "string" && pid.trim().length > 0) {
          return pid.trim();
        }
      }
    } catch {
      // Fall through to onboarding
    }

    // 2. onboardUser if no project yet
    try {
      const res = await fetch(`${GEMINI_CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`, {
        method: "POST",
        headers: antigravityHeaders(accessToken),
        body: JSON.stringify({
          tierId: "TIER_LEGACY",
          metadata: {
            ideType: "ANTIGRAVITY",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      });
      if (res.ok) {
        const onboard = (await res.json()) as Record<string, any>;
        const projectObj = onboard.response?.cloudaicompanionProject || onboard.cloudaicompanionProject;
        const pid = typeof projectObj === "string" ? projectObj : projectObj?.id;
        if (pid && typeof pid === "string" && pid.trim().length > 0) {
          return pid.trim();
        }
      }
    } catch {
      // Best-effort
    }

    return "default-project";
  }

  async ensureFresh(account: GeminiAccount): Promise<GeminiAccount> {
    const now = Date.now();
    if (account.tokenStatus !== "INVALID" && account.expiresAt - now > this.refreshMarginMs) {
      return account;
    }

    // Refresh token
    const body = new URLSearchParams({
      client_id: GEMINI_CLIENT_ID,
      client_secret: GEMINI_CLIENT_SECRET,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    });

    try {
      const res = await fetch(GEMINI_TOKEN_URL, {
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

      const updated: GeminiAccount = {
        ...account,
        accessToken: newAccess,
        expiresAt: Date.now() + expiresIn,
        tokenStatus: "AVAILABLE",
      };
      this.updateAccount(updated);
      return updated;
    } catch (err) {
      if (account.expiresAt <= now) {
        const updated = { ...account, tokenStatus: "EXPIRED" as const };
        this.updateAccount(updated);
        return updated;
      }
      return account;
    }
  }

  async acquireAccount(): Promise<GeminiAccount> {
    const accounts = this.state.accounts;
    if (accounts.length === 0) {
      throw new Error("No Google account is signed in. Please sign in with Gemini OAuth in Settings > Providers.");
    }

    const availableIndices = selectGeminiAccountIndices(accounts, this.state.nextAccountIndex);
    if (availableIndices.length === 0) {
      throw new Error("No available Gemini account (all accounts are disabled or invalid).");
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

    throw new Error("No available Gemini account could be authenticated.");
  }

  async refreshUsage(accountId: string): Promise<GeminiAccount | null> {
    const account = this.getAccount(accountId);
    if (!account) return null;

    const fresh = await this.ensureFresh(account);
    if (fresh.tokenStatus === "INVALID") return fresh;

    try {
      const res = await fetch(`${GEMINI_CODE_ASSIST_ENDPOINT}/v1internal:fetchAvailableModels`, {
        method: "POST",
        headers: antigravityHeaders(fresh.accessToken),
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        if (res.status === 401) {
          const updated = { ...fresh, tokenStatus: "INVALID" as const };
          this.updateAccount(updated);
          return updated;
        }
        return fresh;
      }

      const json = (await res.json()) as Record<string, any>;
      const usage = parseGeminiQuota(json);
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

  setEnabled(accountId: string, enabled: boolean): GeminiAccount | null {
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

  private updateAccount(account: GeminiAccount): void {
    this.state.accounts = this.state.accounts.map((a) => (a.id === account.id ? account : a));
    this.write();
  }
}

export function selectGeminiAccountIndices(accounts: GeminiAccount[], startIndex: number): number[] {
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

export function parseGeminiQuota(json: Record<string, any>): GeminiUsageSnapshot | null {
  const models = json.models || json.availableModels || {};
  let daily: GeminiUsageWindow | null = null;
  let weekly: GeminiUsageWindow | null = null;

  for (const model of Object.values(models) as Array<Record<string, any>>) {
    if (!model || typeof model !== "object") continue;
    const quotas = model.quotaInfo || model.quotas || [];
    const list = Array.isArray(quotas) ? quotas : [quotas];

    for (const q of list) {
      const fraction = typeof q.remainingFraction === "number" ? q.remainingFraction : null;
      if (fraction === null) continue;

      let resetsAt: number | null = null;
      if (q.resetTime) {
        try {
          resetsAt = Math.floor(new Date(q.resetTime).getTime() / 1000);
        } catch {
          // Ignore
        }
      }

      const window: GeminiUsageWindow = { remainingFraction: Math.max(0, Math.min(1, fraction)), resetsAt };
      const label = String(q.windowId || q.windowLabel || "").toLowerCase();
      if (label.includes("week") || label.includes("7d")) {
        weekly = !weekly || window.remainingFraction < weekly.remainingFraction ? window : weekly;
      } else {
        daily = !daily || window.remainingFraction < daily.remainingFraction ? window : daily;
      }
    }
  }

  if (!daily && !weekly) return null;
  return { daily, weekly, updatedAt: Date.now() };
}

export const geminiAccountRepository = new GeminiAccountRepository();
