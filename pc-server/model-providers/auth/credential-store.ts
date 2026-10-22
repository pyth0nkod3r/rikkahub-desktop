// model-providers/auth/credential-store.ts — pi-ai CredentialStore 契约在宿主 state 上的实现。
// 纪律(方案 §2.4):
//   1. modify 是唯一写路径,pi Models.getAuth 的读-改-写(刷新窗口内锁内二次校验)跑在
//      这里的 per-provider 串行队列上——同一 provider 的并发请求不会双刷被轮换的 refresh token。
//   2. 写凭证 = 读 state → 生成新 providers 数组 → updateSettings 一次性原子落盘,
//      永远不做「先内存改、后落盘」的两步态(崩在窗口内不会留半写状态)。
//   3. mutate 回调可能做网络刷新(resolve.ts 在锁内跑 oauth.refresh),故队列是 async 的,
//      不锁 state 全局、只锁 (providerId) 粒度——不同供应商互不影响。
//
// 键值口径:pi 侧以「pi 内置 provider id」为键(resolveProviderAuth / Models.getAuth 传的
// 是 flow.piProviderId,如 openai-codex),宿主 state 以「宿主 provider id」(预置固定 UUID)
// 存行。两者经 findProvider 双向桥接:直查宿主 id → 兜底按 piProviderId→flow→已登录行 反查。
// 关键:写路径(commitCredential)锁的是「找到的那行的宿主 id」,不是传入的 pi id,
// 否则预置供应商(宿主 id ≠ pi id)的刷新回写会因 p.id !== providerId 全部失配而丢。

import type { OAuthCredential } from "../../../pi/packages/ai/src/auth/types.ts";
import { updateSettings } from "../../app-config";
import type { Provider } from "../../foundation/types";
import { reportError } from "../../observability/app-errors";
import { state } from "../../persistence/json-store";
import { OAUTH_FLOWS } from "./flows";
import { codexAccountRepository } from "../codex-oauth/repository";

export type Credential = OAuthCredential;

export interface CredentialStore {
  read(providerId: string, options?: { signal?: AbortSignal }): Promise<Credential | undefined>;
  list(): Promise<Array<{ providerId: string; type: "oauth" }>>;
  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: { signal?: AbortSignal },
  ): Promise<Credential | undefined>;
  delete(providerId: string, options?: { signal?: AbortSignal }): Promise<void>;
}

// per-provider 串行队列。Value 是队尾 promise;新任务链接其上,严格 FIFO。
// 键就用传入的 providerId。两条轨都用 pi 内置 id 作键(宿主聊天轨 resolve.ts 构造
// { id: flow.piProviderId };pi 轨 getAuth 传 model.provider,同为 pi 内置 id),故同一
// 供应商的并发读-改-写天然走同一条队列。宿主 UUID 只在登录 commit 时被 findProvider
// 直查命中,不参与并发收敛——不要依赖两种 id 各有一条队列来"隔离"。
const tails = new Map<string, Promise<void>>();

function enqueue<T>(providerId: string, run: () => Promise<T>): Promise<T> {
  const prev = tails.get(providerId) ?? Promise.resolve();
  const next = prev.then(run, run); // 前序失败不阻断后续
  tails.set(
    providerId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

function isCodexProviderId(providerId: string): boolean {
  return (
    providerId === "openai-codex" ||
    providerId === "7ce7e322-b995-4b0c-9d48-42e08dcfcdda" ||
    providerId === "98d0557b-0700-41e5-b1d6-ee875a53ae5a"
  );
}

function findProvider(providerId: string): Provider | undefined {
  // state 可能未初始化(pi 引擎测试 / 纯工具调用场景)——安全回落 undefined。
  const providers = state?.settings?.providers;
  if (!providers) return undefined;
  // 直查宿主 id(登录 commit、宿主侧 logout/delete 走这条)。
  const direct = providers.find((p) => p.id === providerId);
  if (direct) return direct;
  // 反查:传入的是 pi 内置 provider id → 经 flow 登记表 → 找已登录该 flow 的行。
  const flowEntry = Object.values(OAUTH_FLOWS).find((f) => f.piProviderId === providerId);
  if (!flowEntry) return undefined;
  return providers.find((p) => p.oauth?.flow === flowEntry.id);
}

function readCredential(providerId: string): Credential | undefined {
  const provider = findProvider(providerId);
  if (provider?.oauth) return provider.oauth.credential as unknown as Credential;
  if (isCodexProviderId(providerId)) {
    const acc =
      codexAccountRepository.listAccounts().find((a) => a.enabled && a.tokenStatus !== "INVALID") ??
      codexAccountRepository.listAccounts().find((a) => a.enabled);
    if (acc) {
      return {
        type: "oauth",
        access: acc.accessToken,
        refresh: acc.refreshToken,
        expires: acc.expiresAt,
        accountId: acc.chatgptAccountId || acc.id,
      };
    }
  }
  return undefined;
}

/** CAS 落盘:mutate 期间 provider 行可能已被别处改写(登录/注销/POST 保存),refresh
 *  指纹相验——若行内 refresh 已不是我们 mutate 时的起点,说明有并发写赢了,本次写丢弃。
 *  返回是否真正落盘。锁定行用 findProvider 解析出的宿主 id,与传入的 pi id 解耦。 */
function commitCredential(providerId: string, expectRefresh: string | undefined, next: Credential | undefined): boolean {
  const target =
    findProvider(providerId) ??
    (isCodexProviderId(providerId)
      ? state?.settings?.providers?.find(
          (p) => isCodexProviderId(p.id) || p.oauth?.flow === "openai-codex",
        )
      : undefined);
  if (!target) return false;
  const currentRefresh = target.oauth?.credential?.refresh;
  if (currentRefresh !== expectRefresh) return false;
  const providers = state.settings.providers.map((p): Provider => {
    if (p.id !== target.id) return p;
    if (next === undefined) {
      // 删凭证 = 登出(refresh 被拒等 terminal 路径)。authMode 保持 "oauth"——订阅供应商是
      // OAuth-only 形态,与 login.ts logoutProvider 同一口径;拨成 apiKey 会让前端认不出
      // 订阅卡片、startLogin 拒绝再登录。enabled 由调用方决定,这里不动。
      const rest = { ...p };
      delete rest.oauth;
      return rest;
    }
    return {
      ...p,
      authMode: "oauth" as const,
      enabled: true,
      oauth: {
        // flow 已在行上(登录时写入),这里只换凭证;理论上 p.oauth 必存在(readCredential 读过)。
        flow: p.oauth?.flow ?? target.oauth?.flow ?? "openai-codex",
        credential: next as unknown as Record<string, import("../../foundation/types").JsonValue>,
        signedInAt: p.oauth?.signedInAt ?? Date.now(),
      },
    };
  });
  updateSettings({ ...state.settings, providers });
  return true;
}

export function createPiCredentialStore(): CredentialStore {
  const store: CredentialStore = {
    async read(providerId, options) {
      options?.signal?.throwIfAborted();
      if (isCodexProviderId(providerId)) {
        try {
          if (codexAccountRepository.listAccounts().length > 0) {
            const acc = await codexAccountRepository.acquireAccount();
            return {
              type: "oauth",
              access: acc.accessToken,
              refresh: acc.refreshToken,
              expires: acc.expiresAt,
              accountId: acc.chatgptAccountId || acc.id,
            };
          }
        } catch {
          // fall back to synchronous read
        }
      }
      return readCredential(providerId);
    },

    async list() {
      // pi 消费方(ModelRuntime storedProviders / getProviderAuthStatus)以 pi 内置 id 为键,
      // 与 read/modify 的键口径一致——报宿主 UUID 会让 pi 认为「有凭证但不知道是谁的」。
      const list = (state?.settings?.providers ?? [])
        .filter((p) => p.oauth != null)
        .map((p) => ({ providerId: OAUTH_FLOWS[p.oauth!.flow]?.piProviderId ?? p.id, type: "oauth" as const }));
      if (
        codexAccountRepository.listAccounts().length > 0 &&
        !list.some((item) => item.providerId === "openai-codex")
      ) {
        list.push({ providerId: "openai-codex", type: "oauth" });
      }
      return list;
    },

    async modify(providerId, fn, options) {
      options?.signal?.throwIfAborted();
      return enqueue(providerId, async () => {
        options?.signal?.throwIfAborted();
        const before = await store.read(providerId);
        const expectRefresh = before?.refresh;
        let next: Credential | undefined;
        try {
          next = await fn(before);
        } catch (error) {
          reportError("provider", "warn", `OAuth credential modify failed for ${providerId}`, error, "oauth_modify_failed", { providerId });
          throw error;
        }
        // 回调返回 undefined = 不改动(另一次请求已刷新/已注销),直接返回当前。
        if (next === undefined) return store.read(providerId);
        if (isCodexProviderId(providerId) && next) {
          const accounts = codexAccountRepository.listAccounts();
          const target = accounts.find((a) => a.refreshToken === expectRefresh) || accounts[0];
          if (target) {
            codexAccountRepository.updateAccount({
              ...target,
              accessToken: next.access,
              refreshToken: next.refresh,
              expiresAt: next.expires,
              tokenStatus: "AVAILABLE",
            });
          }
        }
        const ok = commitCredential(providerId, expectRefresh, next);
        if (!ok) {
          // CAS 失败:行已被并发写改写。返回当前实际凭证,让调用方基于新事实再决策。
          return store.read(providerId);
        }
        return next;
      });
    },

    async delete(providerId, options) {
      options?.signal?.throwIfAborted();
      return enqueue(providerId, async () => {
        if (isCodexProviderId(providerId)) {
          const accounts = codexAccountRepository.listAccounts();
          for (const acc of accounts) {
            codexAccountRepository.deleteAccount(acc.id);
          }
        }
        commitCredential(providerId, (await store.read(providerId))?.refresh, undefined);
      });
    },
  };
  return store;
}
