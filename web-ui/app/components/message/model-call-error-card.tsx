import * as React from "react";
import { ChevronDown, Copy, RefreshCw, Settings2, Sparkles, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsLink } from "~/components/settings/settings-link";
import { copyTextToClipboard } from "~/lib/clipboard";
import { cn } from "~/lib/utils";
import type { UIMessageAnnotation } from "~/types";

// ??????????????? + ????/??????? + ?? + ?????

/** ???????????????,??????? */
const ERROR_PREVIEW_LENGTH = 200;

export function ModelCallErrorCard({
  annotations,
  settingsSearch,
  onRegenerate,
  onCompress,
}: {
  annotations: UIMessageAnnotation[] | undefined;
  /** ???????(?????????????)? */
  settingsSearch: string;
  onRegenerate?: () => void | Promise<void>;
  onCompress?: () => void | Promise<void>;
}) {
  const { t } = useTranslation("message");
  const errorMessage =
    (annotations ?? []).find((annotation) => annotation.type === "model_call_error")?.message ??
    null;
  const [expanded, setExpanded] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [retrying, setRetrying] = React.useState(false);
  const copyTimerRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  if (!errorMessage) return null;

  const isContextOverflow =
    /context|token|overflow|upstream_request_rejected|bad_response_status_code|maximum context length/i.test(
      errorMessage,
    );

  const collapsible = errorMessage.length > ERROR_PREVIEW_LENGTH;
  const shownMessage =
    expanded || !collapsible ? errorMessage : `${errorMessage.slice(0, ERROR_PREVIEW_LENGTH)}...`;

  const handleCopy = async () => {
    try {
      await copyTextToClipboard(errorMessage);
      setCopied(true);
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // ?????????????????
    }
  };

  const handleRetry = async () => {
    if (!onRegenerate || retrying) return;
    try {
      setRetrying(true);
      await onRegenerate();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="mx-1 max-w-2xl rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-destructive">
      <div className="flex items-center gap-2">
        <TriangleAlert className="size-4 shrink-0" />
        <span className="text-sm font-medium">{t("chat_message.generation_failed")}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-destructive/90">
        {shownMessage}
      </p>
      {collapsible ? (
        <button
          className="mt-1 inline-flex items-center gap-1 text-xs text-destructive/80 underline-offset-2 transition hover:text-destructive hover:underline"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          {expanded ? t("chat_message.collapse_error") : t("chat_message.expand_error")}
        </button>
      ) : null}

      {isContextOverflow ? (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-500 dark:text-amber-400">
          <div className="font-semibold flex items-center gap-1.5">
            <span>Context Limit Exceeded</span>
          </div>
          <p className="mt-0.5 text-[11px] leading-4 opacity-90">
            The conversation history exceeded the model token capacity. Compacting history will summarize older messages and free up tokens.
          </p>
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {onRegenerate ? (
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/20 hover:bg-destructive/30 text-destructive font-medium px-2.5 py-1 text-xs transition"
            type="button"
            onClick={() => void handleRetry()}
            disabled={retrying}
          >
            <RefreshCw className={cn("size-3", retrying && "animate-spin")} />
            <span>{retrying ? "Retrying..." : "Retry / Regenerate"}</span>
          </button>
        ) : null}

        {isContextOverflow && onCompress ? (
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 text-amber-600 dark:text-amber-400 font-medium px-2.5 py-1 text-xs transition"
            type="button"
            onClick={() => void onCompress()}
          >
            <Sparkles className="size-3" />
            <span>Compact & Retry</span>
          </button>
        ) : null}

        <button
          className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-card/60 px-2 py-1 text-xs transition hover:bg-accent"
          type="button"
          onClick={() => void handleCopy()}
        >
          <Copy className="size-3" />
          {copied ? t("chat_message.copied") : t("chat_message.copy_error")}
        </button>
        <SettingsLink
          className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-card/60 px-2 py-1 text-xs transition hover:bg-accent"
          search={settingsSearch}
        >
          <Settings2 className="size-3" />
          {t("chat_message.open_model_settings")}
        </SettingsLink>
      </div>
    </div>
  );
}
