// model-providers/gemini-oauth/manager.ts — Gemini OAuth Loopback Authentication Manager
// Ported from rikkahub-agent (Pyth0nkod3r fork) GeminiOAuthManager.kt

import { createServer, type Server } from "node:http";
import { parse as parseUrl } from "node:url";
import {
  GEMINI_CLIENT_ID,
  GEMINI_CLIENT_SECRET,
  GEMINI_TOKEN_URL,
  geminiAccountRepository,
} from "./repository";
import type { GeminiAccount } from "./types";

export interface GeminiOAuthStatus {
  phase: "idle" | "waiting" | "success" | "error";
  message?: string;
  accountId?: string;
}

const CALLBACK_PORT = 51121;
const CALLBACK_PATH = "/oauth-callback";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
].join(" ");

export class GeminiOAuthManager {
  private server: Server | null = null;
  private currentStatus: GeminiOAuthStatus = { phase: "idle" };
  private sessions = new Map<string, string>(); // state -> redirectUri

  getStatus(): GeminiOAuthStatus {
    return this.currentStatus;
  }

  async startLogin(): Promise<{ authUrl: string }> {
    const state = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    const redirectUri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
    this.sessions.set(state, redirectUri);
    this.currentStatus = { phase: "waiting" };

    await this.ensureCallbackServer();

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      new URLSearchParams({
        response_type: "code",
        client_id: GEMINI_CLIENT_ID,
        redirect_uri: redirectUri,
        scope: SCOPES,
        state,
        access_type: "offline",
        prompt: "consent",
      }).toString();

    return { authUrl };
  }

  cancelLogin(): void {
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

  private ensureCallbackServer(): Promise<void> {
    if (this.server) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        const parsed = parseUrl(req.url || "", true);
        if (parsed.pathname === CALLBACK_PATH) {
          const state = parsed.query.state as string;
          const code = parsed.query.code as string;
          const errorParam = parsed.query.error as string;

          const redirectUri = state ? this.sessions.get(state) : null;
          if (state) this.sessions.delete(state);

          if (!redirectUri || errorParam || !code) {
            const errMsg = errorParam || (!redirectUri ? "OAuth state mismatch" : "Missing authorization code");
            this.currentStatus = { phase: "error", message: errMsg };
            res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
            res.end(this.renderHtmlPage(false, errMsg));
            this.stopServer();
            return;
          }

          // Render success immediately to browser tab
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(this.renderHtmlPage(true, "Authentication successful! You can close this window."));

          // Exchange code in background
          try {
            const account = await this.exchangeCode(code, redirectUri);
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

      server.on("error", (err) => {
        this.currentStatus = { phase: "error", message: `Callback port ${CALLBACK_PORT} busy: ${err.message}` };
        reject(err);
      });

      server.listen(CALLBACK_PORT, "127.0.0.1", () => {
        this.server = server;
        resolve();
      });
    });
  }

  private async exchangeCode(code: string, redirectUri: string): Promise<GeminiAccount> {
    const params = new URLSearchParams({
      client_id: GEMINI_CLIENT_ID,
      client_secret: GEMINI_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    const res = await fetch(GEMINI_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }

    const tokenJson = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    return await geminiAccountRepository.saveLogin(tokenJson);
  }

  private renderHtmlPage(success: boolean, message: string): string {
    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Rikkahub AgentX - Gemini Authentication</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        background: #0f172a;
        color: #f8fafc;
      }
      .card {
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 2rem 2.5rem;
        max-width: 440px;
        text-align: center;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      }
      .icon {
        font-size: 2.5rem;
        margin-bottom: 1rem;
      }
      h2 { margin: 0 0 0.5rem 0; font-size: 1.25rem; }
      p { color: #94a3b8; font-size: 0.9rem; margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="icon">${success ? "✅" : "❌"}</div>
      <h2>${success ? "Google Sign-In Successful" : "Sign-In Failed"}</h2>
      <p>${message}</p>
      <p style="margin-top: 1rem; font-size: 0.8rem; color: #64748b;">You can return to Rikkahub AgentX Desktop.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 2500);
    </script>
  </body>
</html>`;
  }
}

export const geminiOAuthManager = new GeminiOAuthManager();
