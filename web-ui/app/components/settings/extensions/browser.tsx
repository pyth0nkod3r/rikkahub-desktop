// components/settings/extensions/browser.tsx — Settings > Extensions > Browser Automation
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Globe,
  CheckCircle2,
  AlertCircle,
  Play,
  Camera,
  MousePointer,
  Code2,
  FileText,
  Eye,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import api from "~/services/api";
import { SettingsField, SettingsGroup } from "~/components/settings/shared";
import type { SettingsSectionProps } from "../settings-registry";

interface BrowserStatus {
  available: boolean;
  executablePath: string | null;
  engine: string | null;
  supportedTools: string[];
}

interface TestResult {
  success: boolean;
  title: string;
  url: string;
  elapsedMs: number;
  executablePath: string;
}

export function BrowserSection(_props: SettingsSectionProps) {
  const { t } = useTranslation();

  const [status, setStatus] = React.useState<BrowserStatus | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [lastTest, setLastTest] = React.useState<TestResult | null>(null);

  const loadStatus = React.useCallback(async () => {
    try {
      const res = await api.get<BrowserStatus>("browser/status");
      setStatus(res);
    } catch (err) {
      console.error("Failed to load browser status:", err);
    }
  }, []);

  React.useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleTestBrowser = async () => {
    setTesting(true);
    setLastTest(null);
    try {
      const res = await api.post<TestResult>("browser/test", {});
      setLastTest(res);
      toast.success(`Headless browser verified in ${res.elapsedMs}ms! (${res.title})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "CDP browser test failed");
    } finally {
      setTesting(false);
    }
  };

  const tools = [
    { name: "browser_open", desc: "Navigate to any HTTP/HTTPS URL or HTML content", icon: Globe },
    { name: "browser_screenshot", desc: "Capture high-resolution viewport or element image", icon: Camera },
    { name: "browser_click", desc: "Click links, buttons, and interactive selectors", icon: MousePointer },
    { name: "browser_type", desc: "Input text into form fields, search boxes, and inputs", icon: FileText },
    { name: "browser_get_text", desc: "Extract clean, readable text from page content", icon: Eye },
    { name: "browser_get_dom", desc: "Retrieve structured HTML/DOM tree for inspection", icon: Code2 },
    { name: "browser_eval_js", desc: "Execute custom JavaScript expression in page context", icon: Sparkles },
    { name: "browser_scroll", desc: "Scroll down/up to reveal dynamic content and infinite lists", icon: Play },
  ];

  return (
    <div className="space-y-6">
      {/* 1. Driver Status */}
      <SettingsGroup
        title="CDP Headless Web Driver"
        description="Enables autonomous browser navigation, web scraping, and visual screenshot capture via Chrome DevTools Protocol."
      >
        <div className="rounded-xl border bg-card/60 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <Globe className="size-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">
                    {status?.engine || "Chromium Engine"}
                  </span>
                  {status?.available ? (
                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-mini gap-1">
                      <CheckCircle2 className="size-3" />
                      Ready
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-mini gap-1">
                      <AlertCircle className="size-3" />
                      Not Found
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[500px]">
                  {status?.executablePath || "No Chrome or Edge installation detected on host."}
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={testing || !status?.available}
              onClick={() => void handleTestBrowser()}
              className="gap-1.5"
            >
              {testing ? <RefreshCw className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              <span>{testing ? "Testing..." : "Test Launch"}</span>
            </Button>
          </div>

          {lastTest ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs space-y-1 animate-in fade-in-0 duration-200">
              <div className="font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" />
                <span>CDP Session Verified Successfully</span>
              </div>
              <div className="text-muted-foreground">
                Loaded test document in <span className="font-mono font-medium text-foreground">{lastTest.elapsedMs}ms</span>. Headless CDP pipeline is operational.
              </div>
            </div>
          ) : null}

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            Headless browser sessions are launched on-demand on isolated ports and automatically reaped when tasks conclude. Profile data is kept isolated from your personal browser cookies.
          </div>
        </div>
      </SettingsGroup>

      {/* 2. Tools Matrix */}
      <SettingsGroup
        title="Agent Browser Tools"
        description="Tools exposed to the agent model when browser automation is invoked."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <div key={tool.name} className="flex items-start gap-3 rounded-xl border bg-card/60 p-3.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                  <Icon className="size-4" />
                </div>
                <div className="space-y-0.5 min-w-0">
                  <div className="font-mono text-xs font-semibold text-foreground truncate">
                    {tool.name}
                  </div>
                  <div className="text-xs text-muted-foreground leading-normal">
                    {tool.desc}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </SettingsGroup>
    </div>
  );
}
