import Editor, { loader } from "@monaco-editor/react";
import { useMutation } from "@tanstack/react-query";
import type { editor } from "monaco-editor";
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { dateLocaleFromI18n } from "../../lib/locale";
import { useOrgStore } from "../../store/org";
import { useApexRunnerStore, type ApexRunStatus } from "./store";

loader.config({ monaco });

interface CompileProblem {
  message: string;
  line: number | null;
  column: number | null;
}

interface ApexRunResult {
  success: boolean;
  compiled: boolean;
  compile_problem: CompileProblem | null;
  exception_message: string | null;
  exception_stack_trace: string | null;
  logs: string | null;
  exit_code: number;
  raw_stdout: string;
}

interface LogEntry {
  id: number;
  level: "info" | "error";
  time: string;
  message: string;
}

export function ApexRunner() {
  const { t, i18n: i18nInstance } = useTranslation();
  const { currentOrg } = useOrgStore();
  const { draft, setDraft, history, pushHistory, clearHistory } = useApexRunnerStore();
  const [result, setResult] = useState<ApexRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logCounter, setLogCounter] = useState(0);
  const [mountedEditor, setMountedEditor] = useState<editor.IStandaloneCodeEditor | null>(null);
  const startedAtRef = useRef<number>(0);

  const pushLog = useCallback(
    (level: LogEntry["level"], message: string) => {
      setLogCounter((prev) => {
        const id = prev + 1;
        const locale = dateLocaleFromI18n(i18nInstance.language);
        const time = new Date().toLocaleTimeString(locale, { hour12: false });
        setLogs((old) => {
          const last = old[old.length - 1];
          if (last && last.level === level && last.message === message) {
            return old;
          }
          const next = [...old, { id, level, time, message }];
          return next.length > 200 ? next.slice(next.length - 200) : next;
        });
        return id;
      });
    },
    [i18nInstance.language],
  );

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error(t("soqlEditor.errors.needOrg"));
      startedAtRef.current = performance.now();
      pushLog("info", t("apexRunner.log.runStart", { org: currentOrg }));
      return invoke<ApexRunResult>("run_apex", { orgId: currentOrg, code: draft });
    },
    onSuccess: (data) => {
      setError(null);
      setResult(data);
      const durationMs = Math.max(0, Math.round(performance.now() - startedAtRef.current));

      let status: ApexRunStatus;
      if (data.success && data.compiled) {
        status = "success";
      } else if (!data.compiled) {
        status = "compile_error";
      } else {
        status = "runtime_exception";
      }

      pushHistory({
        code: draft.trim(),
        status,
        logOutput: data.logs,
        errorMessage: data.compile_problem?.message ?? data.exception_message ?? null,
        durationMs,
        executedAt: new Date().toISOString(),
        orgId: currentOrg ?? "",
      });

      pushLog("info", t("apexRunner.log.runSuccess", { ms: durationMs }));
    },
    onError: (e) => {
      setResult(null);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      pushLog("error", t("apexRunner.log.runFail", { message: msg }));
    },
  });

  const editorOptions = useMemo(
    () => ({
      minimap: { enabled: false },
      fontSize: 13,
      wordWrap: "on" as const,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
    }),
    [],
  );

  // Register Cmd+Enter action
  useEffect(() => {
    if (!mountedEditor) return;
    const disposable = mountedEditor.addAction({
      id: "sfdevkit.apex.run",
      label: t("apexRunner.monacoRunAction"),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        if (runMutation.isPending || !currentOrg) return;
        runMutation.mutate();
      },
    });
    return () => disposable.dispose();
  }, [mountedEditor, currentOrg, runMutation.isPending, t]);

  // Jump to line for compile errors
  const jumpToLine = useCallback(
    (line: number) => {
      if (!mountedEditor) return;
      mountedEditor.revealLineInCenter(line);
      mountedEditor.setPosition({ lineNumber: line, column: 1 });
      mountedEditor.focus();
    },
    [mountedEditor],
  );

  const handleOpenInEditor = useCallback(async () => {
    const text = buildResultText();
    if (!text) return;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");
    const orgTag = currentOrg ? `-${currentOrg.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20)}` : '';
    await invoke("open_in_editor", {
      defaultName: `apex-run-${ts}${orgTag}.log`,
      content: text,
    });
  }, [result, error, currentOrg]);

  const buildResultText = useCallback(() => {
    if (result) {
      return JSON.stringify(result, null, 2);
    }
    if (error) {
      return `Error:\n${error}`;
    }
    return "";
  }, [result, error]);

  const hasSaveableResult = Boolean(result || error);

  return (
    <section className="module apex-module">
      <div className="module-header">
        <h2>{t("modules.apex")}</h2>
        {!currentOrg ? <span className="apex-hint">{t("logViewer.noOrgHint")}</span> : null}
      </div>
      <div className="apex-layout">
        {/* LEFT half: Editor + Log */}
        <div className="apex-layout-left">
          <div className="apex-editor-wrap">
            <div className="apex-history-row">
              <span className="apex-history-label">{t("apexRunner.historyLabel")}</span>
              <select
                className="apex-history-select"
                value=""
                onChange={(e) => {
                  const id = Number(e.target.value);
                  const entry = history.find((h) => h.id === id);
                  if (entry) setDraft(entry.code);
                  e.currentTarget.value = "";
                }}
                disabled={history.length === 0}
              >
                <option value="">
                  {history.length === 0 ? t("apexRunner.historyOptionEmpty") : t("apexRunner.historyOptionPick")}
                </option>
                {history.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    [{statusShort(entry.status)}] {entry.code.replace(/\s+/g, " ").slice(0, 100)}
                  </option>
                ))}
              </select>
              <button type="button" onClick={clearHistory} disabled={history.length === 0}>
                {t("apexRunner.clearHistory")}
              </button>
            </div>

            <Editor
              height="320px"
              defaultLanguage="apex"
              theme="vs-dark"
              value={draft}
              onChange={(v) => setDraft(v ?? "")}
              options={editorOptions}
              onMount={(editor) => setMountedEditor(editor)}
            />

            <div className="apex-toolbar">
              <button
                type="button"
                className={`apex-run-btn${runMutation.isPending ? " apex-run-btn--busy" : ""}`}
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending || !currentOrg}
              >
                {runMutation.isPending ? t("apexRunner.running") : t("apexRunner.run")}
              </button>
              <span className="apex-shortcut-hint">Cmd+Enter</span>
            </div>
          </div>

          {/* Log panel */}
          <div className="apex-log-panel">
            <div className="apex-log-header">
              <h3>{t("apexRunner.execLogTitle")}</h3>
              <button type="button" onClick={() => setLogs([])} disabled={logs.length === 0}>
                {t("apexRunner.clearLog")}
              </button>
            </div>
            {logs.length === 0 ? (
              <div className="empty-state">{t("apexRunner.logPanelEmpty")}</div>
            ) : (
              <div className="apex-log-list">
                {logs.map((log) => (
                  <div key={log.id} className={log.level === "error" ? "apex-log-item error" : "apex-log-item"}>
                    <span className="apex-log-time">[{log.time}]</span> {log.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT half: Results */}
        <div className="apex-layout-right">
          {hasSaveableResult ? (
            <div className="apex-results-header">
              <button type="button" className="apex-save-btn" onClick={handleOpenInEditor}>
                {t("apexRunner.openInEditor")}
              </button>
            </div>
          ) : null}

          <div className="apex-results">
            {result && result.success && result.compiled ? (
              <div className="apex-success-card">
                <h3 className="apex-result-title">{t("apexRunner.executionSuccess")}</h3>
                {result.logs && <pre className="apex-log-output">{result.logs}</pre>}
              </div>
            ) : null}

            {result && !result.compiled && result.compile_problem ? (
              <div className="apex-error-card">
                <h3 className="apex-result-title">{t("apexRunner.compileError")}</h3>
                <div className="apex-error-message">{result.compile_problem.message}</div>
                {result.compile_problem.line ? (
                  <button
                    type="button"
                    className="apex-jump-link"
                    onClick={() => jumpToLine(result.compile_problem!.line!)}
                  >
                    {t("apexRunner.jumpToLine", {
                      line: result.compile_problem.line,
                      column: result.compile_problem.column ?? "?",
                    })}
                  </button>
                ) : null}
                {result.logs && <pre className="apex-log-output">{result.logs}</pre>}
              </div>
            ) : null}

            {result && result.compiled && !result.success ? (
              <div className="apex-error-card">
                <h3 className="apex-result-title">{t("apexRunner.runtimeException")}</h3>
                {result.exception_message && (
                  <div className="apex-error-message">{result.exception_message}</div>
                )}
                {result.exception_stack_trace && (
                  <pre className="apex-stack-trace">{result.exception_stack_trace}</pre>
                )}
                {result.logs && <pre className="apex-log-output">{result.logs}</pre>}
              </div>
            ) : null}

            {error && !result ? (
              <div className="apex-error-card">
                <h3 className="apex-result-title">{t("apexRunner.executionFailed")}</h3>
                <pre className="apex-error-raw">{error}</pre>
              </div>
            ) : null}

            {result && !result.success && result.compiled && !result.exception_message && !result.logs ? (
              <div className="apex-error-card">
                <h3 className="apex-result-title">{t("apexRunner.executionFailed")}</h3>
                <pre className="apex-error-raw">{result.raw_stdout}</pre>
              </div>
            ) : null}

            {!result && !error ? (
              <div className="empty-state">{t("apexRunner.resultPlaceholder")}</div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function statusShort(s: ApexRunStatus): string {
  switch (s) {
    case "success":
      return "+";
    case "compile_error":
      return "C";
    case "runtime_exception":
      return "R";
    case "cli_error":
      return "!";
  }
}
