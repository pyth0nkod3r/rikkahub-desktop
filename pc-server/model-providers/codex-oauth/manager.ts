// model-providers/codex-oauth/manager.ts — ChatGPT / Codex OAuth Authentication Manager
// Supports loopback callback server with automatic fallback to Device Code Auth (when ports are unavailable or on Windows)
import { createServer, type Server } from "node:http";
import { parse as parseUrl } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import {
  CODEX_CLIENT_ID,
  CODEX_AUTHORIZE_URL,
  CODEX_TOKEN_URL,
  codexAccountRepository,
} from "./repository";
import type { CodexAccount } from "./types";
import { updateSettings } from "../../app-config";
import { state } from "../../persistence/json-store";

export interface CodexOAuthStatus {
  phase: "idle" | "waiting" | "success" | "error";
  message?: string;
  accountId?: string;
  userCode?: string;
  verificationUrl?: string;
}

const CALLBACK_PORTS = [1455, 1457];
const CALLBACK_PATH = "/auth/callback";
const SCOPES = "openid profile email offline_access";

const DEVICE_USER_CODE_URL = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL = "https://auth.openai.com/api/accounts/deviceauth/token";
const DEVICE_VERIFICATION_URI = "https://auth.openai.com/codex/device";
const DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class CodexOAuthManager {
  private server: Server | null = null;
  private currentStatus: CodexOAuthStatus = { phase: "idle" };
  private sessions = new Map<string, { verifier: string; redirectUri: string }>();
  private activeDevicePollingAbort: AbortController | null = null;
  private lastSessionVerifier: string | null = null;

  getStatus(): CodexOAuthStatus {
    return this.currentStatus;
  }

  async startLogin(): Promise<{ authUrl: string; userCode?: string; verificationUrl?: string }> {
    this.cancelLogin();

    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const state = base64Url(randomBytes(16));
    this.lastSessionVerifier = verifier;

    // 1. Try loopback server first
    try {
      const port = await this.ensureCallbackServer();
      const redirectUri = `http://localhost:${port}${CALLBACK_PATH}`;
      this.sessions.set(state, { verifier, redirectUri });
      this.currentStatus = { phase: "waiting" };

      const authUrl =
        `${CODEX_AUTHORIZE_URL}?` +
        new URLSearchParams({
          response_type: "code",
          client_id: CODEX_CLIENT_ID,
          redirect_uri: redirectUri,
          scope: SCOPES,
          state,
          code_challenge: challenge,
          code_challenge_method: "S256",
          id_token_add_organizations: "true",
          codex_cli_simplified_flow: "true",
          originator: "codex_cli_rs",
        }).toString();

      return { authUrl };
    } catch {
      // Loopback port unavailable (e.g. Windows Hyper-V port exclusion) -> Fallback to Device Code flow
      return await this.startDeviceCodeLogin();
    }
  }

  async startDeviceCodeLogin(): Promise<{ authUrl: string; userCode: string; verificationUrl: string }> {
    this.stopServer();
    const abort = new AbortController();
    this.activeDevicePollingAbort = abort;

    const res = await fetch(DEVICE_USER_CODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
      signal: abort.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI Device Code request failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      device_auth_id?: string;
      user_code?: string;
      interval?: number | string;
    };

    if (!data?.device_auth_id || !data?.user_code) {
      throw new Error("Invalid response from OpenAI Device Code endpoint");
    }

    const userCode = data.user_code;
    const deviceAuthId = data.device_auth_id;
    const intervalSeconds = Math.max(2, Number(data.interval) || 5);

    this.currentStatus = {
      phase: "waiting",
      userCode,
      verificationUrl: DEVICE_VERIFICATION_URI,
    };

    // Start background polling
    void this.pollDeviceCodeAuth(deviceAuthId, userCode, intervalSeconds, abort.signal);

    return {
      authUrl: DEVICE_VERIFICATION_URI,
      userCode,
      verificationUrl: DEVICE_VERIFICATION_URI,
    };
  }

  private async pollDeviceCodeAuth(
    deviceAuthId: string,
    userCode: string,
    intervalSeconds: number,
    signal: AbortSignal,
  ): Promise<void> {
    const timeoutAt = Date.now() + 15 * 60 * 1000; // 15 mins timeout

    while (Date.now() < timeoutAt) {
      if (signal.aborted) return;
      await new Promise((r) => setTimeout(r, intervalSeconds * 1000));
      if (signal.aborted) return;

      try {
        const res = await fetch(DEVICE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_auth_id: deviceAuthId,
            user_code: userCode,
          }),
          signal,
        });

        if (res.ok) {
          const json = (await res.json()) as {
            authorization_code?: string;
            code_verifier?: string;
          };

          if (json.authorization_code && json.code_verifier) {
            const account = await this.exchangeCode(
              json.authorization_code,
              json.code_verifier,
              DEVICE_REDIRECT_URI,
            );
            this.currentStatus = { phase: "success", accountId: account.id };
            return;
          }
        }

        if (res.status === 403 || res.status === 404) {
          // still pending
          continue;
        }

        const body = await res.text().catch(() => "");
        let errCode = "";
        try {
          const parsed = JSON.parse(body) as any;
          errCode = parsed?.error?.code || parsed?.error;
        } catch {
          // Ignore
        }

        if (errCode === "deviceauth_authorization_pending" || errCode === "authorization_pending") {
          continue;
        }
        if (errCode === "slow_down") {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        if (res.status >= 400 && errCode !== "deviceauth_authorization_pending") {
          this.currentStatus = {
            phase: "error",
            message: `OpenAI device authentication failed (${res.status}): ${body}`,
          };
          return;
        }
      } catch {
        if (signal.aborted) return;
        // Network blip, retry next tick
      }
    }

    if (!signal.aborted) {
      this.currentStatus = { phase: "error", message: "Device code authentication timed out" };
    }
  }

  async submitManualCode(input: string): Promise<CodexAccount> {
    const trimmed = input.trim();
    let code = trimmed;
    let state: string | undefined;

    try {
      const url = new URL(trimmed);
      code = url.searchParams.get("code") || code;
      state = url.searchParams.get("state") || undefined;
    } catch {
      // not a full URL
      if (trimmed.includes("code=")) {
        const params = new URLSearchParams(trimmed.includes("?") ? trimmed.split("?")[1] : trimmed);
        code = params.get("code") || code;
        state = params.get("state") || undefined;
      }
    }

    let verifier = this.lastSessionVerifier;
    let redirectUri = "http://localhost:1455/auth/callback";

    if (state && this.sessions.has(state)) {
      const s = this.sessions.get(state)!;
      verifier = s.verifier;
      redirectUri = s.redirectUri;
    }

    if (!verifier) {
      throw new Error("No active login session found for verification. Please start login again.");
    }

    try {
      const account = await this.exchangeCode(code, verifier, redirectUri);
      this.currentStatus = { phase: "success", accountId: account.id };
      this.cancelLogin();
      return account;
    } catch (err) {
      this.currentStatus = {
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
      };
      throw err;
    }
  }

  cancelLogin(): void {
    if (this.activeDevicePollingAbort) {
      this.activeDevicePollingAbort.abort();
      this.activeDevicePollingAbort = null;
    }
    this.currentStatus = { phase: "idle" };
    this.stopServer();
  }

  private stopServer(): void {
    if (this.server) {
      try {
        this.server.close();
      } catch {
        // Ignore
      }
      this.server = null;
    }
  }

  private ensureCallbackServer(): Promise<number> {
    if (this.server) {
      const addr = this.server.address();
      if (addr && typeof addr === "object") return Promise.resolve(addr.port);
    }

    return new Promise((resolve, reject) => {
      let portIdx = 0;

      const tryListen = () => {
        if (portIdx >= CALLBACK_PORTS.length) {
          reject(new Error("OAuth callback ports (1455, 1457) are unavailable"));
          return;
        }
        const port = CALLBACK_PORTS[portIdx++];

        const server = createServer(async (req, res) => {
          const parsed = parseUrl(req.url || "", true);
          if (parsed.pathname === CALLBACK_PATH) {
            const state = parsed.query.state as string;
            const code = parsed.query.code as string;
            const errorParam = parsed.query.error as string;

            const session = state ? this.sessions.get(state) : null;
            if (state) this.sessions.delete(state);

            if (!session || errorParam || !code) {
              const errMsg = errorParam || (!session ? "OAuth state mismatch" : "Missing authorization code");
              this.currentStatus = { phase: "error", message: errMsg };
              res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
              res.end(this.renderHtmlPage(false, errMsg));
              this.stopServer();
              return;
            }

            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(this.renderHtmlPage(true, "Authentication successful! You can close this window and return to RikkaHub."));

            try {
              const account = await this.exchangeCode(code, session.verifier, session.redirectUri);
              this.currentStatus = { phase: "success", accountId: account.id };
            } catch (err) {
              this.currentStatus = {
                phase: "error",
                message: err instanceof Error ? err.message : String(err),
              };
            } finally {
              this.stopServer();
            }
          } else {
            res.writeHead(404);
            res.end("Not Found");
          }
        });

        server.on("error", () => {
          try {
            server.close();
          } catch {
            // Ignore
          }
          tryListen();
        });

        try {
          server.listen(port, "127.0.0.1", () => {
            this.server = server;
            resolve(port);
          });
        } catch {
          tryListen();
        }
      };

      tryListen();
    });
  }

  private async exchangeCode(code: string, verifier: string, redirectUri: string): Promise<CodexAccount> {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CODEX_CLIENT_ID,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });

    const res = await fetch(CODEX_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }

    const tokenJson = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
    };
    const account = await codexAccountRepository.saveLogin(tokenJson);
    try {
      const codexProvider = state?.settings?.providers?.find(
        (p) =>
          p.id === "7ce7e322-b995-4b0c-9d48-42e08dcfcdda" ||
          p.id === "98d0557b-0700-41e5-b1d6-ee875a53ae5a" ||
          p.oauth?.flow === "openai-codex",
      );
      if (codexProvider && state?.settings) {
        const providers = state.settings.providers.map((p) => {
          if (p.id !== codexProvider.id) return p;
          return {
            ...p,
            authMode: "oauth" as const,
            enabled: true,
            oauth: {
              flow: "openai-codex" as const,
              signedInAt: Date.now(),
              credential: {
                type: "oauth",
                access: account.accessToken,
                refresh: account.refreshToken,
                expires: account.expiresAt,
                accountId: account.chatgptAccountId || account.id,
              },
            },
          };
        });
        updateSettings({ ...state.settings, providers });
      }
    } catch {
      // non-blocking
    }
    return account;
  }

  private renderHtmlPage(success: boolean, message: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>ChatGPT Login</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fff; }
    .card { background: #171717; border: 1px solid #262626; border-radius: 12px; padding: 32px; max-width: 400px; text-align: center; }
    h2 { margin: 0 0 12px; color: ${success ? "#10b981" : "#ef4444"}; font-size: 20px; }
    p { margin: 0; color: #a3a3a3; font-size: 14px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${success ? "Authentication Successful" : "Authentication Failed"}</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
  }
}

export const codexOAuthManager = new CodexOAuthManager();
