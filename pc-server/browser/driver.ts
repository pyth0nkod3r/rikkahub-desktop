import { spawn, type Subprocess } from "bun";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { dataDir, filesDir } from "../foundation/paths";
import { state, saveState } from "../persistence/json-store";
import type { StoredFile } from "../foundation/types";

const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Users\\" + (process.env.USERNAME || "") + "\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
];

export function findBrowserExecutable(): string | null {
  if (process.env.BROWSER_PATH && existsSync(process.env.BROWSER_PATH)) {
    return process.env.BROWSER_PATH;
  }
  for (const p of EDGE_PATHS) {
    if (existsSync(p)) return p;
  }
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

export interface CdpResponse<T = any> {
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: string };
}

export class CdpSession {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();

  constructor(public readonly wsUrl: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("WebSocket CDP connection timeout"));
      }, 12000);

      ws.onopen = () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      };

      ws.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(`WebSocket CDP error: ${e}`));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as CdpResponse;
          if (data.id && this.pending.has(data.id)) {
            const { resolve, reject } = this.pending.get(data.id)!;
            this.pending.delete(data.id);
            if (data.error) {
              reject(new Error(data.error.message));
            } else {
              resolve(data.result);
            }
          }
        } catch {
          // Ignore unsolicited events
        }
      };

      ws.onclose = () => {
        this.ws = null;
        for (const { reject } of this.pending.values()) {
          reject(new Error("CDP session closed"));
        }
        this.pending.clear();
      };
    });
  }

  async send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("CDP session is not connected");
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(payload);
    });
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export class BrowserDriver {
  private process: Subprocess | null = null;
  private port = 9222;
  private session: CdpSession | null = null;
  private currentUrl = "about:blank";

  getCurrentUrl(): string {
    return this.currentUrl;
  }

  async ensureBrowser(): Promise<void> {
    if (this.session && this.process) return;

    const exe = findBrowserExecutable();
    if (!exe) {
      throw new Error("No Chromium-based browser (Microsoft Edge or Google Chrome) found on host.");
    }

    const profileDir = join(dataDir, "browser-profile");
    if (!existsSync(profileDir)) {
      mkdirSync(profileDir, { recursive: true });
    } else {
      // Remove stale Chromium lockfiles that cause startup failures
      for (const lock of ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
        try {
          const p = join(profileDir, lock);
          if (existsSync(p)) unlinkSync(p);
        } catch {
          // Ignore
        }
      }
    }

    // Pick random port between 9300-9800 to prevent collisions
    this.port = 9300 + Math.floor(Math.random() * 500);

    const args = [
      exe,
      `--remote-debugging-port=${this.port}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-allow-origins=*",
      `--user-data-dir=${profileDir}`,
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-sync",
      "about:blank",
    ];

    this.process = spawn({
      cmd: args,
      stdout: "ignore",
      stderr: "ignore",
    });

    // Wait for CDP endpoint to be ready
    let targetWsUrl: string | null = null;
    for (let i = 0; i < 100; i++) {
      if (this.process && this.process.exitCode !== null) {
        this.close();
        throw new Error(`Headless browser process exited prematurely with code ${this.process.exitCode}.`);
      }
      await new Promise((r) => setTimeout(r, 200));
      try {
        const resp = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (resp.ok) {
          const json = await resp.json();
          targetWsUrl = json.webSocketDebuggerUrl;
          break;
        }
      } catch {
        // Retry
      }
    }

    if (!targetWsUrl) {
      this.close();
      throw new Error("Failed to connect to headless browser CDP within 20 seconds.");
    }

    // Get active page target
    const pagesResp = await fetch(`http://127.0.0.1:${this.port}/json/list`);
    const pages = await pagesResp.json();
    const pageTarget = pages.find((p: any) => p.type === "page") || pages[0];
    const pageWsUrl = pageTarget?.webSocketDebuggerUrl || targetWsUrl;

    this.session = new CdpSession(pageWsUrl);
    await this.session.connect();
    await this.session.send("Page.enable");
    await this.session.send("Runtime.enable");
    await this.session.send("DOM.enable");
  }

  async open(url: string): Promise<{ url: string; title: string }> {
    await this.ensureBrowser();
    let target = url.trim();
    if (!/^https?:\/\//i.test(target) && target !== "about:blank") {
      target = "https://" + target;
    }

    await this.session!.send("Page.navigate", { url: target });
    // Wait for navigation / load
    await new Promise((r) => setTimeout(r, 1500));
    this.currentUrl = target;

    const titleRes = await this.session!.send("Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    });

    return {
      url: target,
      title: String(titleRes?.result?.value || ""),
    };
  }

  async getText(maxChars = 20000): Promise<string> {
    await this.ensureBrowser();
    const res = await this.session!.send("Runtime.evaluate", {
      expression: "document.body ? document.body.innerText : ''",
      returnByValue: true,
    });
    const text = String(res?.result?.value || "").trim();
    return text.slice(0, maxChars);
  }

  async getDom(selector?: string): Promise<string> {
    await this.ensureBrowser();
    const expr = selector
      ? `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.outerHTML : 'Element not found'; })()`
      : "document.documentElement ? document.documentElement.outerHTML : ''";
    const res = await this.session!.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
    });
    return String(res?.result?.value || "");
  }

  async evalJs(script: string): Promise<any> {
    await this.ensureBrowser();
    const res = await this.session!.send("Runtime.evaluate", {
      expression: script,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res?.exceptionDetails) {
      throw new Error(`JavaScript evaluation error: ${res.exceptionDetails.text || "Execution failed"}`);
    }
    return res?.result?.value;
  }

  async click(selector?: string, x?: number, y?: number): Promise<boolean> {
    await this.ensureBrowser();
    if (selector) {
      const clicked = await this.session!.send("Runtime.evaluate", {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          el.click();
          return true;
        })()`,
        returnByValue: true,
      });
      return Boolean(clicked?.result?.value);
    }

    if (typeof x === "number" && typeof y === "number") {
      await this.session!.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      await this.session!.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
      });
      return true;
    }

    throw new Error("Must provide either 'selector' or both 'x' and 'y' coordinates.");
  }

  async type(selector: string, text: string, clear = false): Promise<boolean> {
    await this.ensureBrowser();
    const focused = await this.session!.send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.focus();
        if (${clear}) {
          if ('value' in el) el.value = '';
          else el.textContent = '';
        }
        return true;
      })()`,
      returnByValue: true,
    });

    if (!focused?.result?.value) return false;

    // Dispatch characters
    for (const char of text) {
      await this.session!.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        text: char,
        unmodifiedText: char,
      });
      await this.session!.send("Input.dispatchKeyEvent", {
        type: "keyUp",
      });
    }

    // Trigger input event
    await this.session!.send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`,
    });

    return true;
  }

  async scroll(direction: "up" | "down", amount = 500): Promise<void> {
    await this.ensureBrowser();
    const delta = direction === "down" ? amount : -amount;
    await this.session!.send("Runtime.evaluate", {
      expression: `window.scrollBy({ top: ${delta}, behavior: 'instant' })`,
    });
  }

  async screenshot(): Promise<{ fileUrl: string; base64: string }> {
    await this.ensureBrowser();
    const snap = await this.session!.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
    });

    const fileId = state.nextFileId++;
    const fileName = `browser-${Date.now()}-${fileId}.png`;
    const target = join(filesDir, fileName);

    await Bun.write(target, Buffer.from(snap.data, "base64"));
    const fileEntry: StoredFile = {
      id: fileId,
      path: target,
      fileName,
      mime: "image/png",
      size: Buffer.from(snap.data, "base64").length,
    };
    state.files.push(fileEntry);
    saveState();

    return {
      fileUrl: `/api/files/${fileId}/content`,
      base64: snap.data,
    };
  }

  close(): void {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // Ignore
      }
      this.process = null;
    }
  }
}

export const browserDriver = new BrowserDriver();
