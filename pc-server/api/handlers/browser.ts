// api/handlers/browser.ts — Browser Automation (CDP) API endpoints
import { json, error } from "../request";
import { findBrowserExecutable, BrowserDriver } from "../../browser/driver";

export async function handleBrowserRoutes(request: Request, _url: URL, path: string): Promise<Response | null> {
  if (path === "browser/status" && request.method === "GET") {
    const exe = findBrowserExecutable();
    return json({
      available: exe !== null,
      executablePath: exe,
      engine: exe ? (exe.toLowerCase().includes("edge") ? "Microsoft Edge (Chromium)" : "Google Chrome") : null,
      supportedTools: [
        "browser_open",
        "browser_screenshot",
        "browser_click",
        "browser_type",
        "browser_scroll",
        "browser_get_dom",
        "browser_get_text",
        "browser_eval_js",
        "browser_close",
      ],
    });
  }

  if (path === "browser/test" && request.method === "POST") {
    const exe = findBrowserExecutable();
    if (!exe) {
      return error("No Chromium-based browser (Microsoft Edge or Google Chrome) found on host system.", 400);
    }
    const driver = new BrowserDriver();
    const start = Date.now();
    try {
      await driver.ensureBrowser();
      const res = await driver.open("data:text/html,<html><head><title>AgentX CDP Test</title></head><body><h1>AgentX Headless Browser Ready</h1></body></html>");
      const elapsed = Date.now() - start;
      driver.close();
      return json({
        success: true,
        title: res.title,
        url: res.url,
        elapsedMs: elapsed,
        executablePath: exe,
      });
    } catch (err) {
      driver.close();
      return error(err instanceof Error ? err.message : "CDP browser test failed", 500);
    }
  }

  return null;
}
