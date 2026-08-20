import { useMutation } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { tauriApi } from "../../lib/tauri";
import { useMetadataStore } from "../../store/metadata";
import { useOrgStore } from "../../store/org";
import { useUiStore } from "../../store/ui";
import { useWorkspaceStore } from "../../store/workspace";
import { useApexTestRunnerStore } from "../ApexTestRunner/store";

interface LogLine {
  type: "start" | "stdout" | "stderr" | "exit" | "info";
  text: string;
}

export function RetrievePanel() {
  const { t } = useTranslation();
  const { currentOrg, orgs } = useOrgStore();
  const currentOrgInfo = orgs.find((o) => o.id === currentOrg);
  const orgAlias = currentOrgInfo?.alias ?? currentOrg ?? "";
  const {
    selectedCount,
    toSelectionList,
    clearSelection,
    outputDir,
    setOutputDir,
    outputMode,
    setOutputMode,
    apiVersion,
    setApiVersion,
  } = useMetadataStore();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [lastOutputPath, setLastOutputPath] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const eventIdRef = useRef("");
  const unlistenRef = useRef<null | (() => void)>(null);
  const logPanelRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);

  // Auto-scroll to bottom when new logs appear
  useEffect(() => {
    if (logPanelRef.current) {
      logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
    }
  }, [logs]);

  // Auto-dismiss success banner after 15 seconds (long enough to read the
  // output path and decide whether to jump into Apex tests)
  useEffect(() => {
    if (!showSuccess) return;
    const timer = setTimeout(() => setShowSuccess(false), 15000);
    return () => clearTimeout(timer);
  }, [showSuccess]);

  const doRetrieve = useCallback(async () => {
    if (runningRef.current) throw new Error("Already running");
    runningRef.current = true;

    try {
      if (!currentOrg) throw new Error(String(i18n.t("metadataBrowser.retrieve.errors.needOrg")));
      if (!outputDir) throw new Error(String(i18n.t("metadataBrowser.retrieve.errors.needOutputDir")));
      const selections = toSelectionList();
      if (selections.length === 0) throw new Error(String(i18n.t("metadataBrowser.retrieve.errors.needSelection")));

      const eventId = `metadata-retrieve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      eventIdRef.current = eventId;
      setLogs([]);
      setLastOutputPath("");
      setShowSuccess(false);

      const unlisten = await listen<{ event_type: LogLine["type"]; data: string }>(eventId, ({ payload }) => {
        setLogs((prev) => [...prev, { type: payload.event_type, text: payload.data }]);
      });
      unlistenRef.current = unlisten;

      const result = await tauriApi.retrieveMetadata({
        orgId: currentOrg,
        orgAlias,
        selections,
        outputDir,
        outputMode,
        apiVersion,
        eventId,
      });
      return result;
    } finally {
      runningRef.current = false;
    }
  }, [currentOrg, orgAlias, outputDir, outputMode, apiVersion, toSelectionList]);

  const retrieveMutation = useMutation({
    mutationFn: doRetrieve,
    onSuccess: (result) => {
      setLastOutputPath(result.output_path);
      setShowSuccess(true);
      useWorkspaceStore.getState().setLastRetrieve(result.output_path, currentOrg ?? "");
      setLogs((prev) => [
        ...prev,
        {
          type: "info",
          text: String(i18n.t("metadataBrowser.retrieve.logDone", { seconds: (result.duration_ms / 1000).toFixed(1) })),
        },
      ]);
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      setLogs((prev) => [...prev, { type: "stderr", text: message }]);
    },
    onSettled: () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => tauriApi.cancelRetrieve(eventIdRef.current),
    onSuccess: () =>
      setLogs((prev) => [...prev, { type: "info", text: String(i18n.t("metadataBrowser.retrieve.logCancelRequested")) }]),
  });

  const chooseDir = async () => {
    const picked = await tauriApi.pickProjectDirectory();
    if (picked) setOutputDir(picked);
  };

  const isRunning = retrieveMutation.isPending;
  const selectedComponentCount = selectedCount();

  return (
    <section className="metadata-pane metadata-retrieve-pane">
      <header className="metadata-pane-header">
        <h3>{t("metadataBrowser.retrieve.title")}</h3>
      </header>

      {showSuccess ? (
        <div className="metadata-success-banner">
          {t("metadataBrowser.retrieve.successMessage")}
          {lastOutputPath ? <span className="metadata-success-path">{lastOutputPath}</span> : null}
          <button
            type="button"
            className="metadata-success-action"
            onClick={() => {
              useApexTestRunnerStore.getState().openRetrievePackage(lastOutputPath);
              useUiStore.getState().setActiveModule("apex_tests");
            }}
          >
            {t("metadataBrowser.retrieve.runApexTests")}
          </button>
        </div>
      ) : null}

      <div className="metadata-field">
        <label>{t("metadataBrowser.retrieve.outputDir")}</label>
        <div className="metadata-output-row">
          <input readOnly value={outputDir} placeholder={t("metadataBrowser.retrieve.outputDirPlaceholder")} />
          <button type="button" onClick={() => void chooseDir()}>
            {t("metadataBrowser.retrieve.chooseDir")}
          </button>
        </div>
      </div>

      <div className="metadata-field">
        <label>{t("metadataBrowser.retrieve.outputFormat")}</label>
        <div className="metadata-radio-row">
          <label>
            <input type="radio" checked={outputMode === "extract"} onChange={() => setOutputMode("extract")} />{" "}
            {t("metadataBrowser.retrieve.extract")}
          </label>
          <label>
            <input type="radio" checked={outputMode === "zip"} onChange={() => setOutputMode("zip")} />{" "}
            {t("metadataBrowser.retrieve.keepZip")}
          </label>
        </div>
      </div>

      <div className="metadata-field">
        <label>{t("metadataBrowser.retrieve.apiVersion")}</label>
        <select value={apiVersion} onChange={(e) => setApiVersion(e.target.value)}>
          {["62.0", "61.0", "60.0", "59.0", "58.0"].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div className="metadata-summary-row">
        <span>{t("metadataBrowser.retrieve.selectedComponents", { count: selectedComponentCount })}</span>
        <button type="button" onClick={clearSelection} disabled={selectedComponentCount === 0}>
          {t("metadataBrowser.retrieve.clear")}
        </button>
      </div>

      <div className="metadata-action-row">
        <button
          type="button"
          className="metadata-primary-btn"
          onClick={() => void retrieveMutation.mutateAsync()}
          disabled={isRunning || !currentOrg}
        >
          {isRunning ? t("metadataBrowser.retrieve.downloading") : t("metadataBrowser.retrieve.download")}
        </button>
        <button type="button" onClick={() => cancelMutation.mutate()} disabled={!isRunning}>
          {t("metadataBrowser.retrieve.cancel")}
        </button>
        <button type="button" onClick={() => tauriApi.revealInFinder(lastOutputPath)} disabled={!lastOutputPath}>
          {t("metadataBrowser.retrieve.openFolder")}
        </button>
      </div>

      {isRunning ? (
        <div className="metadata-progress-bar-track">
          <div className="metadata-progress-bar-indeterminate" />
          <span className="metadata-progress-label">
            {t("metadataBrowser.retrieve.running", { count: selectedComponentCount })}
          </span>
        </div>
      ) : null}

      <div className="metadata-log-panel" ref={logPanelRef}>
        {logs.length === 0 ? <div className="metadata-muted">{t("metadataBrowser.retrieve.logEmpty")}</div> : null}
        {logs.map((line, idx) => (
          <div key={`${line.type}-${idx}`} className={`metadata-log-line metadata-log-${line.type}`}>
            {line.text}
          </div>
        ))}
      </div>
    </section>
  );
}
