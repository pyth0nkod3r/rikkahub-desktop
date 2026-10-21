import { browserDriver } from "../browser/driver";

export const BROWSER_OPEN_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "browser_open",
    description: "Open a web page in the headless browser or navigate the active session to a URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full URL or web address to load" },
      },
      required: ["url"],
    },
  },
};

export const BROWSER_GET_TEXT_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "browser_get_text",
    description: "Extract readable text content from the currently open browser page.",
    parameters: {
      type: "object",
      properties: {
        max_chars: { type: "number", description: "Max characters to extract (default 20,000)" },
      },
    },
  },
};

export const BROWSER_GET_DOM_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "browser_get_dom",
    description: "Extract the rendered HTML / DOM of the current page or a specific CSS selector.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Optional CSS selector to narrow down" },
      },
    },
  },
};

export const BROWSER_CLICK_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "browser_click",
    description: "Click an element by CSS selector, or click specific (x, y) coordinates on the page.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the element to click" },
        x: { type: "number", description: "X coordinate" },
        y: { type: "number", description: "Y coordinate" },
      },
    },
  },
};

export const BROWSER_TYPE_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "browser_type",
    description: "Type text into an input field or textarea identified by CSS selector.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the input field" },
        text: { type: "string", description: "Text to type into the field" },
        clear: { type: "boolean", description: "Whether to clear existing text before typing (default false)" },
      },
      required: ["selector", "text"],
    },
  },
};

export const BROWSER_SCROLL_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "browser_scroll",
    description: "Scroll the page up or down.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
        amount: { type: "number", description: "Pixels to scroll (default 500)" },
      },
      required: ["direction"],
    },
  },
};

export const BROWSER_SCREENSHOT_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "browser_screenshot",
    description: "Capture a screenshot of the current page viewport and return it.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export const BROWSER_EVAL_JS_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "browser_eval_js",
    description: "Evaluate a JavaScript expression inside the browser page context and return the result.",
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "JavaScript code or expression to evaluate" },
      },
      required: ["script"],
    },
  },
};

export const BROWSER_CLOSE_TOOL_SCHEMA = {
  type: "function" as const,
  function: {
    name: "browser_close",
    description: "Close the active browser session and release process resources.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export const BROWSER_TOOL_SCHEMAS = [
  BROWSER_OPEN_TOOL_SCHEMA,
  BROWSER_GET_TEXT_TOOL_SCHEMA,
  BROWSER_GET_DOM_TOOL_SCHEMA,
  BROWSER_CLICK_TOOL_SCHEMA,
  BROWSER_TYPE_TOOL_SCHEMA,
  BROWSER_SCROLL_TOOL_SCHEMA,
  BROWSER_SCREENSHOT_TOOL_SCHEMA,
  BROWSER_EVAL_JS_TOOL_SCHEMA,
  BROWSER_CLOSE_TOOL_SCHEMA,
];

export function openAiBrowserTools() {
  return BROWSER_TOOL_SCHEMAS;
}

export function isBrowserTool(name: string): boolean {
  return name.startsWith("browser_");
}

export async function executeBrowserTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "browser_open": {
      const url = String(args.url || "").trim();
      if (!url) throw new Error("Missing required argument: url");
      const res = await browserDriver.open(url);
      return JSON.stringify({ ok: true, url: res.url, title: res.title });
    }

    case "browser_get_text": {
      const maxChars = typeof args.max_chars === "number" ? args.max_chars : 20000;
      const text = await browserDriver.getText(maxChars);
      return text || "(Empty page text)";
    }

    case "browser_get_dom": {
      const selector = args.selector ? String(args.selector) : undefined;
      const dom = await browserDriver.getDom(selector);
      return dom;
    }

    case "browser_click": {
      const selector = args.selector ? String(args.selector) : undefined;
      const x = typeof args.x === "number" ? args.x : undefined;
      const y = typeof args.y === "number" ? args.y : undefined;
      const success = await browserDriver.click(selector, x, y);
      return JSON.stringify({ ok: success });
    }

    case "browser_type": {
      const selector = String(args.selector || "").trim();
      const text = String(args.text || "");
      const clear = Boolean(args.clear);
      if (!selector) throw new Error("Missing required argument: selector");
      const success = await browserDriver.type(selector, text, clear);
      return JSON.stringify({ ok: success });
    }

    case "browser_scroll": {
      const direction = String(args.direction || "down") as "up" | "down";
      const amount = typeof args.amount === "number" ? args.amount : 500;
      await browserDriver.scroll(direction, amount);
      return JSON.stringify({ ok: true, scrolled: direction, amount });
    }

    case "browser_screenshot": {
      const snap = await browserDriver.screenshot();
      return {
        output: [
          {
            type: "image",
            url: snap.fileUrl,
            metadata: { source: "browser", mime: "image/png" },
          },
          {
            type: "text",
            text: `Screenshot captured: ${snap.fileUrl}`,
          },
        ],
      };
    }

    case "browser_eval_js": {
      const script = String(args.script || "").trim();
      if (!script) throw new Error("Missing required argument: script");
      const res = await browserDriver.evalJs(script);
      return typeof res === "string" ? res : JSON.stringify(res);
    }

    case "browser_close": {
      browserDriver.close();
      return JSON.stringify({ ok: true, closed: true });
    }

    default:
      throw new Error(`Unknown browser tool: ${name}`);
  }
}
