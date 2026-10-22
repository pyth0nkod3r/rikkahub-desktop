// model-providers/codex-oauth/manager.ts — ChatGPT / Codex OAuth Loopback Authentication Manager
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

export interface CodexOAuthStatus {
  phase: "idle" | "waiting" | "success" | "error";
  message?: string;
  accountId?: string;
}

const CALLBACK_PORTS = [1455, 1457];
const CALLBACK_PATH = "/auth/callback";
const SCOPES = "openid profile email offline_access";

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class CodexOAuthManager {
  private server: Server | null = null;
  private currentStatus: CodexOAuthStatus = { phase: "idle" };
  private sessions = new Map<string, { verifier: string; redirectUri: string }>();

  getStatus(): CodexOAuthStatus {
    return this.currentStatus;
  }

  async startLogin(): Promise<{ authUrl: string }> {
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const state = base64Url(randomBytes(16));

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
          server.close();
          tryListen();
        });

        server.listen(port, "127.0.0.1", () => {
          this.server = server;
          resolve(port);
        });
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
    return await codexAccountRepository.saveLogin(tokenJson);
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
