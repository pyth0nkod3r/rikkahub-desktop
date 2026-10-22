// model-providers/codex-oauth/repository.test.ts
import { describe, expect, it } from "bun:test";
import { selectCodexAccountIndices, parseCodexUsage } from "./repository";
import type { CodexAccount } from "./types";

describe("CodexAccountRepository", () => {
  it("selectCodexAccountIndices cycles round-robin and skips disabled accounts", () => {
    const acc1: CodexAccount = {
      id: "acc1",
      userId: "u1",
      name: "User 1",
      email: "u1@example.com",
      chatgptAccountId: "org-1",
      accessToken: "t1",
      refreshToken: "r1",
      expiresAt: Date.now() + 3600000,
      enabled: true,
      tokenStatus: "AVAILABLE",
      usage: null,
    };
    const acc2: CodexAccount = {
      id: "acc2",
      userId: "u2",
      name: "User 2",
      email: "u2@example.com",
      chatgptAccountId: "org-2",
      accessToken: "t2",
      refreshToken: "r2",
      expiresAt: Date.now() + 3600000,
      enabled: false,
      tokenStatus: "AVAILABLE",
      usage: null,
    };
    const acc3: CodexAccount = {
      id: "acc3",
      userId: "u3",
      name: "User 3",
      email: "u3@example.com",
      chatgptAccountId: "org-3",
      accessToken: "t3",
      refreshToken: "r3",
      expiresAt: Date.now() + 3600000,
      enabled: true,
      tokenStatus: "AVAILABLE",
      usage: null,
    };

    const accounts = [acc1, acc2, acc3];

    expect(selectCodexAccountIndices(accounts, 0)).toEqual([0, 2]);
    expect(selectCodexAccountIndices(accounts, 1)).toEqual([2, 0]);
    expect(selectCodexAccountIndices(accounts, 2)).toEqual([2, 0]);
  });

  it("parseCodexUsage calculates remaining percentage", () => {
    const payload = {
      rate_limit: {
        limit: 100,
        remaining: 75,
        reset_at: 1730000000,
      },
    };
    const usage = parseCodexUsage(payload);
    expect(usage).not.toBeNull();
    expect(usage?.remainingPercent).toBe(75);
    expect(usage?.totalTokens).toBe(100);
    expect(usage?.usedTokens).toBe(25);
  });
});
