// api/handlers/provider-accounts.ts — Multi-Account Provider OAuth & Round-Robin Endpoints
import { error, json, readJson } from "../request";
import { geminiAccountRepository } from "../../model-providers/gemini-oauth/repository";
import { geminiOAuthManager } from "../../model-providers/gemini-oauth/manager";
import { codexAccountRepository } from "../../model-providers/codex-oauth/repository";
import { codexOAuthManager } from "../../model-providers/codex-oauth/manager";

export async function handleProviderAccountRoutes(
  request: Request,
  url: URL,
  path: string,
): Promise<Response | null> {
  const type = url.searchParams.get("type") || "gemini";

  // 1. List accounts
  if (path === "settings/providers/accounts" && request.method === "GET") {
    if (type === "gemini") {
      return json({ accounts: geminiAccountRepository.listAccounts() });
    }
    if (type === "chatgpt" || type === "codex") {
      return json({ accounts: codexAccountRepository.listAccounts() });
    }
    return json({ accounts: [] });
  }

  // 2. Start OAuth login
  if (path === "settings/providers/accounts/login" && request.method === "POST") {
    if (type === "gemini") {
      try {
        const { authUrl } = await geminiOAuthManager.startLogin();
        return json({ authUrl });
      } catch (err) {
        return error(err instanceof Error ? err.message : "Failed to start Gemini login", 500);
      }
    }
    if (type === "chatgpt" || type === "codex") {
      try {
        const loginRes = await codexOAuthManager.startLogin();
        return json(loginRes);
      } catch (err) {
        return error(err instanceof Error ? err.message : "Failed to start Codex login", 500);
      }
    }
    return error("Unsupported provider type for interactive login", 400);
  }

  // 3. Login status
  if (path === "settings/providers/accounts/status" && request.method === "GET") {
    if (type === "gemini") {
      return json({ status: geminiOAuthManager.getStatus() });
    }
    if (type === "chatgpt" || type === "codex") {
      return json({ status: codexOAuthManager.getStatus() });
    }
    return json({ status: { phase: "idle" } });
  }

  // 4. Submit manual code / callback URL
  if (path === "settings/providers/accounts/submit-code" && request.method === "POST") {
    if (type === "chatgpt" || type === "codex") {
      try {
        const body = await readJson<{ code?: string }>(request);
        if (!body.code?.trim()) return error("Code or redirect URL is required", 400);
        const account = await codexOAuthManager.submitManualCode(body.code.trim());
        return json({ success: true, account });
      } catch (err) {
        return error(err instanceof Error ? err.message : "Failed to submit code", 500);
      }
    }
    return error("Manual code submission not supported for this provider", 400);
  }

  // 5. Cancel login
  if (path === "settings/providers/accounts/cancel" && request.method === "POST") {
    if (type === "gemini") {
      geminiOAuthManager.cancelLogin();
      return json({ ok: true });
    }
    if (type === "chatgpt" || type === "codex") {
      codexOAuthManager.cancelLogin();
      return json({ ok: true });
    }
    return json({ ok: true });
  }

  // 6. Account operations on specific account ID: /settings/providers/accounts/:id
  const match = path.match(/^settings\/providers\/accounts\/([^/]+)(?:\/(.*))?$/);
  if (!match) return null;

  const accountId = decodeURIComponent(match[1]);
  const sub = match[2] || "";

  // Refresh account status / usage
  if (sub === "refresh" && request.method === "POST") {
    if (type === "gemini") {
      const updated = await geminiAccountRepository.refreshUsage(accountId);
      return json({ account: updated });
    }
    if (type === "chatgpt" || type === "codex") {
      const updated = await codexAccountRepository.refreshUsage(accountId);
      return json({ account: updated });
    }
    return error("Unsupported type", 400);
  }

  // Toggle enabled
  if (!sub && request.method === "PATCH") {
    const body = await readJson<{ enabled?: boolean }>(request);
    const enabled = Boolean(body.enabled);
    if (type === "gemini") {
      const updated = geminiAccountRepository.setEnabled(accountId, enabled);
      return json({ account: updated });
    }
    if (type === "chatgpt" || type === "codex") {
      const updated = codexAccountRepository.setEnabled(accountId, enabled);
      return json({ account: updated });
    }
    return error("Unsupported type", 400);
  }

  // Delete account
  if (!sub && request.method === "DELETE") {
    if (type === "gemini") {
      const ok = geminiAccountRepository.deleteAccount(accountId);
      return json({ ok });
    }
    if (type === "chatgpt" || type === "codex") {
      const ok = codexAccountRepository.deleteAccount(accountId);
      return json({ ok });
    }
    return error("Unsupported type", 400);
  }

  return null;
}
