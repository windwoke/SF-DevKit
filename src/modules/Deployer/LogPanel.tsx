import { useEffect, useRef, useMemo, memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useDeployStore, type DeployError } from "./store";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function groupErrorsByFile(errors: DeployError[]): Map<string, DeployError[]> {
  const groups = new Map<string, DeployError[]>();
  for (const err of errors) {
    const key = err.fileName || err.fullName;
    const existing = groups.get(key);
    if (existing) {
      existing.push(err);
    } else {
      groups.set(key, [err]);
    }
  }
  return groups;
}

const MAX_VISIBLE_LINES = 300;

const FormattedView = memo(function FormattedView() {
  const { t } = useTranslation();
  const result = useDeployStore((s) => s.lastDeployResult);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, []);

  const banner = useMemo(() => {
    if (!result) return null;
    const time = formatDuration(result.durationMs);
    const isValidate = result.mode === "validate_only";
    const bannerKey = result.success
      ? isValidate ? "deployer.validateSucceeded" : "deployer.deploySucceeded"
      : isValidate ? "deployer.validateFailed" : "deployer.deployFailed";
    return {
      key: bannerKey,
      text: result.success
        ? t(bannerKey, { count: result.componentCount, time })
        : t(bannerKey, { errors: result.errorCount, count: result.componentCount, time }),
      success: result.success,
    };
  }, [result, t]);

  const grouped = useMemo(
    () => result ? groupErrorsByFile(result.errors) : new Map<string, DeployError[]>(),
    [result],
  );

  if (!result || !banner) return null;

  return (
    <div ref={ref} style={{ flex: 1, overflow: "auto", margin: "0 12px 8px" }}>
      <div className={`deployer-result-banner ${banner.success ? "success" : "failure"}`}>
        {banner.text}
      </div>

      {grouped.size > 0 &&
        Array.from(grouped.entries()).map(([file, errs]) => (
          <ErrorGroup key={file} file={file} errors={errs} />
        ))}
    </div>
  );
});

const ErrorGroup = memo(function ErrorGroup({
  file,
  errors,
}: {
  file: string;
  errors: DeployError[];
}) {
  const typeLabel = errors[0]?.componentType && errors[0].componentType !== "unknown"
    ? ` (${errors[0].componentType})`
    : "";
  return (
    <div className="deployer-error-group">
      <div className="deployer-error-group-header">{file}{typeLabel}</div>
      {errors.map((e, i) => (
        <div key={i} className="deployer-error-line">
          <span className="deployer-error-loc">
            {e.lineNumber != null
              ? `L${e.lineNumber}${e.columnNumber != null ? `:${e.columnNumber}` : ""}`
              : ""}
          </span>
          <span className="deployer-error-msg">{e.message}</span>
        </div>
      ))}
    </div>
  );
});

export function LogPanel() {
  const { t } = useTranslation();
  const logs = useDeployStore((s) => s.logs);
  const isDeploying = useDeployStore((s) => s.isDeploying);
  const lastDeployResult = useDeployStore((s) => s.lastDeployResult);
  const logView = useDeployStore((s) => s.logView);
  const setLogView = useDeployStore((s) => s.setLogView);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // Only render the tail of the log for streaming performance
  const visibleLogs = useMemo(() => {
    if (logs.length <= MAX_VISIBLE_LINES) return logs;
    return logs.slice(-MAX_VISIBLE_LINES);
  }, [logs]);

  const scrollToBottom = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    if (isDeploying) scrollToBottom();
  }, [logs, isDeploying, scrollToBottom]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const showToggle = !!lastDeployResult && !isDeploying;
  const showFormatted = showToggle && logView === "formatted";
  const trimmed = logs.length > MAX_VISIBLE_LINES;

  return (
    <div className="deployer-log-panel-wrap">
      <div className="deployer-log-header">
        <span>
          {t("deployer.logTitle")}
          {isDeploying && trimmed && (
            <span className="deployer-log-trim-hint">
              {" "}{t("deployer.logTrimHint", { total: logs.length })}
            </span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isDeploying && (
            <span className="deployer-running-badge">{t("deployer.running")}</span>
          )}
          {showToggle && (
            <div className="deployer-view-toggle">
              <button
                className={logView === "formatted" ? "active" : ""}
                onClick={() => setLogView("formatted")}
              >
                {t("deployer.viewFormatted")}
              </button>
              <button
                className={logView === "raw" ? "active" : ""}
                onClick={() => setLogView("raw")}
              >
                {t("deployer.viewRaw")}
              </button>
            </div>
          )}
        </span>
      </div>

      {showFormatted ? (
        <FormattedView />
      ) : (
        <div className="deployer-log-panel" ref={scrollRef}>
          {logs.length === 0 ? (
            <div className="metadata-muted">{t("deployer.logEmpty")}</div>
          ) : (
            visibleLogs.map((line, i) => (
              <div key={i} className="metadata-log-line">{line}</div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
