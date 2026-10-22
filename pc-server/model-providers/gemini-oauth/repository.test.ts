// model-providers/gemini-oauth/repository.test.ts
import { describe, expect, it } from "bun:test";
import { parseGeminiQuota, selectGeminiAccountIndices } from "./repository";
import type { GeminiAccount } from "./types";

describe("GeminiAccountRepository", () => {
  it("selectGeminiAccountIndices rotates round-robin and skips disabled/invalid accounts", () => {
    const acc1: GeminiAccount = {
      id: "acc1@gmail.com",
      name: "Account 1",
      email: "acc1@gmail.com",
      projectId: "proj-1",
      accessToken: "token1",
      refreshToken: "ref1",
      expiresAt: Date.now() + 3600000,
      enabled: true,
      tokenStatus: "AVAILABLE",
      usage: null,
    };
    const acc2: GeminiAccount = {
      id: "acc2@gmail.com",
      name: "Account 2",
      email: "acc2@gmail.com",
      projectId: "proj-2",
      accessToken: "token2",
      refreshToken: "ref2",
      expiresAt: Date.now() + 3600000,
      enabled: false, // DISABLED
      tokenStatus: "AVAILABLE",
      usage: null,
    };
    const acc3: GeminiAccount = {
      id: "acc3@gmail.com",
      name: "Account 3",
      email: "acc3@gmail.com",
      projectId: "proj-3",
      accessToken: "token3",
      refreshToken: "ref3",
      expiresAt: Date.now() + 3600000,
      enabled: true,
      tokenStatus: "AVAILABLE",
      usage: null,
    };

    const accounts = [acc1, acc2, acc3];

    // Starting at 0: should return [0, 2] (skips 1 because disabled)
    const indicesFrom0 = selectGeminiAccountIndices(accounts, 0);
    expect(indicesFrom0).toEqual([0, 2]);

    // Starting at 1: should return [2, 0]
    const indicesFrom1 = selectGeminiAccountIndices(accounts, 1);
    expect(indicesFrom1).toEqual([2, 0]);

    // Starting at 2: should return [2, 0]
    const indicesFrom2 = selectGeminiAccountIndices(accounts, 2);
    expect(indicesFrom2).toEqual([2, 0]);
  });

  it("parseGeminiQuota extracts daily and weekly quota windows", () => {
    const quotaPayload = {
      models: {
        "gemini-2.5-flash": {
          quotaInfo: [
            { windowId: "daily-quota", remainingFraction: 0.85, resetTime: "2026-10-23T00:00:00Z" },
            { windowId: "weekly-quota", remainingFraction: 0.65, resetTime: "2026-10-28T00:00:00Z" },
          ],
        },
      },
    };

    const quota = parseGeminiQuota(quotaPayload);
    expect(quota).not.toBeNull();
    expect(quota?.daily?.remainingFraction).toBe(0.85);
    expect(quota?.weekly?.remainingFraction).toBe(0.65);
  });
});
