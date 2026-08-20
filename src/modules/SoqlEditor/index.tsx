import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { dateLocaleFromI18n } from "../../lib/locale";
import { tauriApi } from "../../lib/tauri";
import { useOrgStore } from "../../store/org";
import { useSoqlStore } from "../../store/soql";
import { SoqlMonacoEditor } from "./SoqlMonacoEditor";
import { extractFromObject } from "./contextParser";
import {
  extractSubqueryRows,
  getByPath,
  parseSoqlLayout,
  remapAggregateExprColumns,
  type MainColumn,
} from "./resultLayout";
import { clearSoqlCompletionCache } from "./soqlCompletion";
import { formatSoql } from "./soqlFormat";
import { IconCopy, IconExport, IconFormat, IconRefresh, IconRun } from "./SoqlToolbarIcons";

interface SoqlLogEntry {
  id: number;
  level: "info" | "error";
  time: string;
  message: string;
}

interface QuerySummary {
  orgId: string;
  totalSize: number;
  displayedRows: number;
  durationMs: number;
  executedAt: string;
}

interface ClassifiedError {
  category: string;
  title: string;
  suggestion: string;
  raw: string;
}

type SortDirection = "asc" | "desc";
type SortState = { column: string | null; direction: SortDirection };

type ParsedRecords = { fallbackCols: string[]; rows: Record<string, unknown>[] };
type RecordsTable = { cols: MainColumn[]; rows: Record<string, unknown>[] };

/** 解析 result.records（含空数组）；解析失败返回 null */
function parseRecordsTableFromResultJson(resultJson: string): ParsedRecords | null {
  try {
    const data = JSON.parse(resultJson) as { result?: { records?: Record<string, unknown>[] } };
    const records = data.result?.records;
    if (!Array.isArray(records)) return null;
    const colSet = new Set<string>();
    for (const row of records) {
      if (row && typeof row === "object") {
        Object.keys(row as object)
          .filter((c) => c !== "attributes")
          .forEach((c) => colSet.add(c));
      }
    }
    return { fallbackCols: [...colSet], rows: [...records] };
  } catch {
    return null;
  }
}

export function SoqlEditor() {
  const { t, i18n: i18nInstance } = useTranslation();
  const { currentOrg } = useOrgStore();
  const { draft: soql, setDraft: setSoql, history, pushHistory, clearHistory } = useSoqlStore();
  const [resultJson, setResultJson] = useState<string | null>(null);
  const [error, setError] = useState<ClassifiedError | null>(null);
  const [summary, setSummary] = useState<QuerySummary | null>(null);
  const [sortState, setSortState] = useState<SortState>({ column: null, direction: "asc" });
  const [expandedSubqueries, setExpandedSubqueries] = useState<Record<string, boolean>>({});
  const [completionLoading, setCompletionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<SoqlLogEntry[]>([]);
  const [logCounter, setLogCounter] = useState(0);
  const startedAtRef = useRef<number>(0);
  const [resultCopyUi, setResultCopyUi] = useState<"idle" | "ok" | "err">("idle");
  const [exportUi, setExportUi] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const copyUiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportUiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyUiTimerRef.current) clearTimeout(copyUiTimerRef.current);
      if (exportUiTimerRef.current) clearTimeout(exportUiTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (copyUiTimerRef.current) clearTimeout(copyUiTimerRef.current);
    if (exportUiTimerRef.current) clearTimeout(exportUiTimerRef.current);
    copyUiTimerRef.current = null;
    exportUiTimerRef.current = null;
    setResultCopyUi("idle");
    setExportUi("idle");
    setExpandedSubqueries({});
  }, [resultJson]);

  const pushLog = useCallback((level: SoqlLogEntry["level"], message: string) => {
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
  }, [i18nInstance.language]);

  const handleCompletionLog = useCallback(
    (message: string, level: "info" | "error" = "info") => {
      pushLog(level, message);
    },
    [pushLog],
  );

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error(i18n.t("soqlEditor.errors.needOrg"));
      startedAtRef.current = performance.now();
      pushHistory(soql);
      pushLog("info", i18n.t("soqlEditor.log.runStart", { org: currentOrg }));
      pushLog("info", i18n.t("soqlEditor.log.runQuery", { snippet: soql.replace(/\s+/g, " ").slice(0, 240) }));
      return invoke<unknown>("run_soql_query", { orgId: currentOrg, query: soql });
    },
    onSuccess: (data) => {
      setError(null);
      const pretty = JSON.stringify(data, null, 2);
      setResultJson(pretty);
      const records = (data as { result?: { records?: unknown[] } })?.result?.records ?? [];
      const totalSize = (data as { result?: { totalSize?: number } })?.result?.totalSize ?? records.length ?? 0;
      const durationMs = Math.max(0, Math.round(performance.now() - startedAtRef.current));
      const locale = dateLocaleFromI18n(i18n.language);
      setSummary({
        orgId: currentOrg ?? "-",
        totalSize,
        displayedRows: records.length,
        durationMs,
        executedAt: new Date().toLocaleTimeString(locale, { hour12: false }),
      });
      pushLog("info", i18n.t("soqlEditor.log.runSuccess", { total: totalSize, ms: durationMs }));
    },
    onError: (e) => {
      setResultJson(null);
      const message = e instanceof Error ? e.message : String(e);
      setSummary(null);
      setError(classifySoqlError(message));
      pushLog("error", i18n.t("soqlEditor.log.runFail", { message }));
    },
  });

  const refreshCacheMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error(i18n.t("soqlEditor.errors.needOrg"));
      const objectName = extractFromObject(soql);
      pushLog(
        "info",
        objectName ? i18n.t("soqlEditor.log.cacheManualObj", { name: objectName }) : i18n.t("soqlEditor.log.cacheManualAll"),
      );
      await tauriApi.refreshSchemaCache({ orgId: currentOrg, objectName });
      clearSoqlCompletionCache({ orgId: currentOrg, objectName: objectName ?? undefined });
      return { objectName };
    },
    onSuccess: ({ objectName }) => {
      pushLog(
        "info",
        objectName ? i18n.t("soqlEditor.log.cacheDoneObj", { name: objectName }) : i18n.t("soqlEditor.log.cacheDoneAll"),
      );
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      pushLog("error", i18n.t("soqlEditor.log.cacheFail", { message }));
    },
  });

  const parsedTable = useMemo(() => (resultJson ? parseRecordsTableFromResultJson(resultJson) : null), [resultJson]);
  const resultLayout = useMemo(() => parseSoqlLayout(soql), [soql]);

  const table = useMemo(() => {
    if (!parsedTable || parsedTable.rows.length === 0) return null;
    const rows = [...parsedTable.rows];
    const fallbackColumns: MainColumn[] = parsedTable.fallbackCols.map((label, idx) => ({
      id: `fallback:${label}:${idx}`,
      label,
      kind: "field" as const,
      path: label.split(".").filter(Boolean),
    }));
    const cols = resultLayout?.mainColumns.length
      ? remapAggregateExprColumns(resultLayout.mainColumns, rows)
      : fallbackColumns;
    if (sortState.column) {
      const sortableCol = cols.find(
        (col): col is Extract<MainColumn, { kind: "field" }> => col.id === sortState.column && col.kind === "field",
      );
      if (!sortableCol) {
        return { cols, rows };
      }
      const dir = sortState.direction === "asc" ? 1 : -1;
      const locale = dateLocaleFromI18n(i18nInstance.language);
      rows.sort(
        (a, b) => compareCell(getByPath(a, sortableCol.path), getByPath(b, sortableCol.path), locale) * dir,
      );
    }
    return { cols, rows };
  }, [parsedTable, resultLayout, sortState, i18nInstance.language]);

  const toggleSort = (column: MainColumn) => {
    if (column.kind !== "field") return;
    setSortState((prev) => {
      if (prev.column !== column.id) return { column: column.id, direction: "asc" };
      return { column: column.id, direction: prev.direction === "asc" ? "desc" : "asc" };
    });
  };

  const toggleSubqueryExpand = useCallback((rowKey: string, subqueryName: string) => {
    const stateKey = `${rowKey}::${subqueryName}`;
    setExpandedSubqueries((prev) => ({
      ...prev,
      [stateKey]: !prev[stateKey],
    }));
  }, []);

  const handleFormatSoql = useCallback(() => {
    setSoql(formatSoql(soql));
    pushLog("info", i18n.t("soqlEditor.log.formatted"));
  }, [soql, setSoql, pushLog]);

  const handleCopySoql = useCallback(async () => {
    const text = soql.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      pushLog("info", i18n.t("soqlEditor.log.soqlCopied"));
    } catch {
      pushLog("error", i18n.t("soqlEditor.log.copyFailApp"));
    }
  }, [soql, pushLog]);

  const scheduleCopyUiReset = useCallback(() => {
    if (copyUiTimerRef.current) clearTimeout(copyUiTimerRef.current);
    copyUiTimerRef.current = setTimeout(() => {
      setResultCopyUi("idle");
      copyUiTimerRef.current = null;
    }, 2200);
  }, []);

  const scheduleExportUiReset = useCallback(() => {
    if (exportUiTimerRef.current) clearTimeout(exportUiTimerRef.current);
    exportUiTimerRef.current = setTimeout(() => {
      setExportUi("idle");
      exportUiTimerRef.current = null;
    }, 2200);
  }, []);

  const handleCopyResults = useCallback(async () => {
    if (!resultJson) return;
    const text = buildExcelClipboardText(resultJson, table, parsedTable);
    try {
      await navigator.clipboard.writeText(text);
      setResultCopyUi("ok");
      scheduleCopyUiReset();
      pushLog("info", i18n.t("soqlEditor.log.tsvCopied"));
    } catch {
      setResultCopyUi("err");
      scheduleCopyUiReset();
      pushLog("error", i18n.t("soqlEditor.log.copyFailClipboard"));
    }
  }, [resultJson, table, parsedTable, pushLog, scheduleCopyUiReset]);

  const handleExportResults = useCallback(async () => {
    if (!resultJson) return;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");
    const hasRows = Boolean(table && table.rows.length > 0);
    const defaultName = hasRows ? `soql-result-${ts}.csv` : `soql-result-${ts}.json`;
    const content = hasRows ? recordsToCsv(table!.cols, table!.rows) : resultJson;
    const mime = hasRows ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";

    setExportUi("loading");
    try {
      await invoke("save_export_file", { defaultName, content });
      setExportUi("ok");
      scheduleExportUiReset();
      pushLog("info", hasRows ? i18n.t("soqlEditor.log.savedCsv", { rows: table!.rows.length }) : i18n.t("soqlEditor.log.savedJson"));
    } catch (e) {
      if (isExportCancelled(e)) {
        setExportUi("idle");
        pushLog("info", i18n.t("soqlEditor.log.exportCancelled"));
        return;
      }
      try {
        downloadTextFile(defaultName, content, mime);
        setExportUi("ok");
        scheduleExportUiReset();
        pushLog("info", i18n.t("soqlEditor.log.exportBrowserDownload"));
      } catch (e2) {
        setExportUi("err");
        scheduleExportUiReset();
        const msg = e2 instanceof Error ? e2.message : String(e2);
        pushLog("error", i18n.t("soqlEditor.log.exportFail", { message: msg }));
      }
    }
  }, [resultJson, table, pushLog, scheduleExportUiReset]);

  const hasExportableResult = Boolean(resultJson && !error);

  return (
    <section className="module soql-module">
      <div className="module-header">
        <h2>{t("soqlEditor.title")}</h2>
        {!currentOrg ? <span className="soql-hint">{t("logViewer.noOrgHint")}</span> : null}
      </div>
      <div className="soql-layout">
        <div className="soql-editor-wrap">
          <div className="soql-history-row">
            <span className="soql-history-label">{t("soqlEditor.historyLabel")}</span>
            <select
              className="soql-history-select"
              value=""
              onChange={(e) => {
                const next = e.target.value;
                if (next) setSoql(next);
                e.currentTarget.value = "";
              }}
              disabled={history.length === 0}
            >
              <option value="">
                {history.length === 0 ? t("soqlEditor.historyOptionEmpty") : t("soqlEditor.historyOptionPick")}
              </option>
              {history.map((item, idx) => (
                <option key={`${idx}-${item.slice(0, 20)}`} value={item}>
                  {item.replace(/\s+/g, " ").slice(0, 120)}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => clearHistory()} disabled={history.length === 0}>
              {t("soqlEditor.clearHistory")}
            </button>
          </div>
          <SoqlMonacoEditor
            value={soql}
            onChange={setSoql}
            onLog={handleCompletionLog}
            onLoading={setCompletionLoading}
            onRun={() => runMutation.mutate()}
            runDisabled={runMutation.isPending || !currentOrg}
            runActionLabel={t("soqlEditor.monacoRunAction")}
          />
          <div className="soql-toolbar">
            {completionLoading ? <span className="soql-completion-loading">{completionLoading}</span> : null}
            <div className="soql-toolbar-actions">
              <button
                type="button"
                className="soql-icon-btn"
                title={t("soqlEditor.toolbarFormatTitle")}
                aria-label={t("soqlEditor.toolbarFormatAria")}
                onClick={handleFormatSoql}
                disabled={!soql.trim()}
              >
                <IconFormat />
              </button>
              <button
                type="button"
                className="soql-icon-btn"
                title={t("soqlEditor.toolbarCopyTitle")}
                aria-label={t("soqlEditor.toolbarCopyAria")}
                onClick={() => void handleCopySoql()}
                disabled={!soql.trim()}
              >
                <IconCopy />
              </button>
              <button
                type="button"
                className={`soql-icon-btn${refreshCacheMutation.isPending ? " soql-icon-btn--busy" : ""}`}
                title={t("soqlEditor.toolbarRefreshTitle")}
                aria-label={t("soqlEditor.toolbarRefreshAria")}
                onClick={() => refreshCacheMutation.mutate()}
                disabled={!currentOrg || refreshCacheMutation.isPending}
              >
                <IconRefresh />
              </button>
              <button
                type="button"
                className={`soql-icon-btn soql-icon-btn--primary${runMutation.isPending ? " soql-icon-btn--pulse" : ""}`}
                title={t("soqlEditor.toolbarRunTitle")}
                aria-label={t("soqlEditor.toolbarRunAria")}
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending || !currentOrg}
              >
                <IconRun />
              </button>
            </div>
          </div>
        </div>
        <div className="soql-results">
          <div className="soql-results-header">
            <h3 className="soql-results-title">{t("soqlEditor.resultsTitle")}</h3>
            {hasExportableResult ? (
              <div className="soql-results-actions">
                <button
                  type="button"
                  className={`soql-results-btn${resultCopyUi === "ok" ? " soql-results-btn--ok" : ""}${resultCopyUi === "err" ? " soql-results-btn--err" : ""}`}
                  title={t("soqlEditor.copyResultsTitle")}
                  onClick={() => void handleCopyResults()}
                >
                  <IconCopy />
                  <span>
                    {resultCopyUi === "ok"
                      ? t("soqlEditor.copyLabelOk")
                      : resultCopyUi === "err"
                        ? t("soqlEditor.copyLabelErr")
                        : t("soqlEditor.copyLabelIdle")}
                  </span>
                </button>
                <button
                  type="button"
                  className={`soql-results-btn${exportUi === "ok" ? " soql-results-btn--ok" : ""}${exportUi === "err" ? " soql-results-btn--err" : ""}`}
                  title={table ? t("soqlEditor.exportCsvTitle") : t("soqlEditor.exportJsonTitle")}
                  disabled={exportUi === "loading"}
                  onClick={() => void handleExportResults()}
                >
                  <IconExport />
                  <span>
                    {exportUi === "loading"
                      ? t("soqlEditor.exportLabelLoading")
                      : exportUi === "ok"
                        ? t("soqlEditor.exportLabelOk")
                        : exportUi === "err"
                          ? t("soqlEditor.exportLabelErr")
                          : t("soqlEditor.exportLabelIdle")}
                  </span>
                </button>
              </div>
            ) : null}
          </div>
          {summary ? (
            <div className="soql-summary">
              <span>{t("soqlEditor.summaryTotal", { n: summary.totalSize })}</span>
              <span>{t("soqlEditor.summaryDisplayed", { n: summary.displayedRows })}</span>
              <span>{t("soqlEditor.summaryDuration", { n: summary.durationMs })}</span>
              <span>{t("soqlEditor.summaryOrg", { id: summary.orgId })}</span>
              <span>{t("soqlEditor.summaryExecutedAt", { time: summary.executedAt })}</span>
            </div>
          ) : null}
          {error ? (
            <div className="soql-error-card">
              <div className="soql-error-title">{error.title}</div>
              <div className="soql-error-subtitle">{error.category}</div>
              <div className="soql-error-suggestion">{error.suggestion}</div>
              <details>
                <summary>{t("soqlEditor.errorDetailsSummary")}</summary>
                <pre className="soql-error-raw">{error.raw}</pre>
              </details>
            </div>
          ) : null}
          {table ? (
            <div className="soql-table-scroll">
              <table className="soql-table">
                <thead>
                  <tr>
                    <th className="soql-th-rownum">#</th>
                    {table.cols.map((col) => (
                      <th
                        key={col.id}
                        className={col.kind === "field" ? "soql-sortable-th" : undefined}
                        onClick={() => toggleSort(col)}
                      >
                        <span>{col.label}</span>
                        {sortState.column === col.id ? <span>{sortState.direction === "asc" ? "▲" : "▼"}</span> : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, i) => {
                    const rowKey = getRowIdentity(row, i);
                    const expandedItems = table.cols
                      .filter((col): col is Extract<MainColumn, { kind: "subquery" }> => col.kind === "subquery")
                      .map((col) => {
                        const sqRows = extractSubqueryRows(row, col.subqueryName);
                        const sqLayout = resultLayout?.subqueries[col.subqueryName];
                        const stateKey = `${rowKey}::${col.subqueryName}`;
                        return { col, sqRows, sqLayout, expanded: Boolean(expandedSubqueries[stateKey]) };
                      })
                      .filter((item) => item.expanded && item.sqLayout);

                    return (
                      <Fragment key={`${rowKey}-fragment`}>
                        <tr key={`${rowKey}-main`}>
                          <td className="soql-td-rownum">{i + 1}</td>
                          {table.cols.map((col) => {
                            if (col.kind === "field") {
                              const value = getByPath(row, col.path);
                              return (
                                <td key={col.id} title={formatCell(value)}>
                                  <span className="soql-cell-text">{formatCell(value)}</span>
                                </td>
                              );
                            }
                            const sqRows = extractSubqueryRows(row, col.subqueryName);
                            const sqLayout = resultLayout?.subqueries[col.subqueryName];
                            const countText = t("soqlEditor.subqueryRows", { count: sqRows.length });
                            const stateKey = `${rowKey}::${col.subqueryName}`;
                            const isExpanded = Boolean(expandedSubqueries[stateKey]);
                            return (
                              <td key={col.id} title={countText}>
                                <button
                                  type="button"
                                  className="soql-subquery-btn"
                                  disabled={sqRows.length === 0 || !sqLayout}
                                  onClick={() => toggleSubqueryExpand(rowKey, col.subqueryName)}
                                >
                                  {isExpanded ? t("soqlEditor.subqueryCollapse") : t("soqlEditor.subqueryExpand")} {countText}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                        {expandedItems.length > 0 ? (
                          <tr key={`${rowKey}-sub`} className="soql-subquery-inline-row">
                            <td colSpan={table.cols.length + 1}>
                              {expandedItems.map((item) => (
                                <div className="soql-subquery-panel" key={`${rowKey}-${item.col.subqueryName}`}>
                                  <div className="soql-subquery-header">
                                    <strong>{t("soqlEditor.subqueryPanelTitle", { label: item.col.label, row: i + 1 })}</strong>
                                  </div>
                                  {item.sqRows.length === 0 ? (
                                    <div className="empty-state">{t("soqlEditor.subqueryEmptyRow")}</div>
                                  ) : (
                                    <div className="soql-table-scroll soql-subquery-table-scroll">
                                      <table className="soql-table">
                                        <thead>
                                          <tr>
                                            <th className="soql-th-rownum">#</th>
                                            {item.sqLayout?.columns.map((col) => (
                                              <th key={`${rowKey}-${item.col.subqueryName}-${col.label}`}>{col.label}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {item.sqRows.map((sqRow, sqIndex) => (
                                            <tr key={`${rowKey}-${item.col.subqueryName}-${sqIndex}`}>
                                              <td className="soql-td-rownum">{sqIndex + 1}</td>
                                              {item.sqLayout?.columns.map((col) => {
                                                const value = getByPath(sqRow, col.path);
                                                return (
                                                  <td
                                                    key={`${rowKey}-${item.col.subqueryName}-${sqIndex}-${col.label}`}
                                                    title={formatCell(value)}
                                                  >
                                                    <span className="soql-cell-text">{formatCell(value)}</span>
                                                  </td>
                                                );
                                              })}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          {!table && resultJson && !error ? (
            <pre className="soql-json">{resultJson}</pre>
          ) : null}
          {!table && !resultJson && !error ? (
            <div className="empty-state">{t("soqlEditor.resultPlaceholder")}</div>
          ) : null}
        </div>
        <div className="soql-log-panel">
          <div className="soql-log-header">
            <h3 className="soql-results-title">{t("soqlEditor.execLogTitle")}</h3>
            <button type="button" onClick={() => setLogs([])} disabled={logs.length === 0}>
              {t("soqlEditor.clearLog")}
            </button>
          </div>
          {logs.length === 0 ? (
            <div className="empty-state">{t("soqlEditor.logPanelEmpty")}</div>
          ) : (
            <div className="soql-log-list">
              {logs.map((log) => (
                <div key={log.id} className={log.level === "error" ? "soql-log-item error" : "soql-log-item"}>
                  <span className="soql-log-time">[{log.time}]</span> {log.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function compareCell(a: unknown, b: unknown, locale: string): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  const na = typeof a === "number" ? a : Number(a);
  const nb = typeof b === "number" ? b : Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b), locale, { sensitivity: "base" });
}

function classifySoqlError(raw: string): ClassifiedError {
  const lower = raw.toLowerCase();
  if (lower.includes("malformed_query") || lower.includes("unexpected token") || lower.includes("syntax")) {
    return {
      category: i18n.t("soqlEditor.errorClass.syntax.category"),
      title: i18n.t("soqlEditor.errorClass.syntax.title"),
      suggestion: i18n.t("soqlEditor.errorClass.syntax.suggestion"),
      raw,
    };
  }
  if (lower.includes("insufficient_access") || lower.includes("insufficient permissions") || lower.includes("no such column")) {
    return {
      category: i18n.t("soqlEditor.errorClass.access.category"),
      title: i18n.t("soqlEditor.errorClass.access.title"),
      suggestion: i18n.t("soqlEditor.errorClass.access.suggestion"),
      raw,
    };
  }
  if (lower.includes("session") || lower.includes("not authorized") || lower.includes("expired")) {
    return {
      category: i18n.t("soqlEditor.errorClass.session.category"),
      title: i18n.t("soqlEditor.errorClass.session.title"),
      suggestion: i18n.t("soqlEditor.errorClass.session.suggestion"),
      raw,
    };
  }
  if (lower.includes("sf") || lower.includes("command failed") || lower.includes("network")) {
    return {
      category: i18n.t("soqlEditor.errorClass.cli.category"),
      title: i18n.t("soqlEditor.errorClass.cli.title"),
      suggestion: i18n.t("soqlEditor.errorClass.cli.suggestion"),
      raw,
    };
  }
  return {
    category: i18n.t("soqlEditor.errorClass.unknown.category"),
    title: i18n.t("soqlEditor.errorClass.unknown.title"),
    suggestion: i18n.t("soqlEditor.errorClass.unknown.suggestion"),
    raw,
  };
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function isExportCancelled(e: unknown): boolean {
  if (typeof e === "string") return e.toLowerCase().includes("cancelled");
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message).toLowerCase().includes("cancelled");
  }
  return String(e).toLowerCase().includes("cancelled");
}

/** 单元格内换行/制表符会破坏 TSV 列对齐，替换为空格 */
function formatCellForExcel(v: unknown): string {
  return formatCell(v).replace(/\r\n|\n|\r/g, " ").replace(/\t/g, " ");
}

function recordsToTsv(cols: MainColumn[], rows: Record<string, unknown>[]): string {
  if (cols.length === 0) return "";
  const header = cols.map((col) => formatCellForExcel(col.label)).join("\t");
  if (rows.length === 0) return header;
  return [
    header,
    ...rows.map((row) => cols.map((col) => formatCellForExcel(getMainColumnCellValue(row, col))).join("\t")),
  ].join("\n");
}

function collapseLinesForSingleCell(s: string): string {
  return s.replace(/\r\n|\n|\r/g, " ").slice(0, 32760);
}

function buildExcelClipboardText(resultJson: string, table: RecordsTable | null, parsed: ParsedRecords | null): string {
  if (table) return recordsToTsv(table.cols, table.rows);
  if (parsed?.rows.length === 0) {
    if (parsed.fallbackCols.length > 0) {
      const cols: MainColumn[] = parsed.fallbackCols.map((label, idx) => ({
        id: `fallback:${label}:${idx}`,
        label,
        kind: "field",
        path: label.split(".").filter(Boolean),
      }));
      return recordsToTsv(cols, []);
    }
    return i18n.t("soqlEditor.excelNoDataHint");
  }
  if (parsed && parsed.rows.length > 0) {
    const cols: MainColumn[] = parsed.fallbackCols.map((label, idx) => ({
      id: `fallback:${label}:${idx}`,
      label,
      kind: "field",
      path: label.split(".").filter(Boolean),
    }));
    return recordsToTsv(cols, parsed.rows);
  }
  return collapseLinesForSingleCell(resultJson);
}

function escapeCsvField(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function recordsToCsv(cols: MainColumn[], rows: Record<string, unknown>[]): string {
  const header = cols.map((col) => escapeCsvField(col.label)).join(",");
  const lines = rows.map((row) => cols.map((col) => escapeCsvField(formatCell(getMainColumnCellValue(row, col)))).join(","));
  return `\uFEFF${header}\n${lines.join("\n")}`;
}

function getMainColumnCellValue(row: Record<string, unknown>, col: MainColumn): unknown {
  if (col.kind === "field") {
    return getByPath(row, col.path);
  }
  return i18n.t("soqlEditor.subqueryRows", { count: extractSubqueryRows(row, col.subqueryName).length });
}

function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}

function getRowIdentity(row: Record<string, unknown>, idx: number): string {
  const id = getByPath(row, ["Id"]);
  if (typeof id === "string" && id.trim()) return id;
  const contactId = getByPath(row, ["ID"]);
  if (typeof contactId === "string" && contactId.trim()) return contactId;
  return `row-${idx}`;
}
