import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useMemo, useState } from "react";
import { tauriApi } from "../../lib/tauri";
import { useOrgStore } from "../../store/org";
import { useSoqlStore } from "../../store/soql";
import { SoqlMonacoEditor } from "./SoqlMonacoEditor";
import { extractFromObject } from "./contextParser";
import { clearSoqlCompletionCache } from "./soqlCompletion";

interface SoqlLogEntry {
  id: number;
  level: "info" | "error";
  time: string;
  message: string;
}

export function SoqlEditor() {
  const { currentOrg } = useOrgStore();
  const { draft: soql, setDraft: setSoql, history, pushHistory, clearHistory } = useSoqlStore();
  const [resultJson, setResultJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completionLoading, setCompletionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<SoqlLogEntry[]>([]);
  const [logCounter, setLogCounter] = useState(0);

  const pushLog = useCallback((level: SoqlLogEntry["level"], message: string) => {
    setLogCounter((prev) => {
      const id = prev + 1;
      const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
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
  }, []);

  const handleCompletionLog = useCallback(
    (message: string, level: "info" | "error" = "info") => {
      pushLog(level, message);
    },
    [pushLog],
  );

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error("请先选择或登录 Org");
      pushHistory(soql);
      pushLog("info", `开始执行 SOQL，Org=${currentOrg}`);
      pushLog("info", `Query: ${soql.replace(/\s+/g, " ").slice(0, 240)}`);
      return invoke<unknown>("run_soql_query", { orgId: currentOrg, query: soql });
    },
    onSuccess: (data) => {
      setError(null);
      const pretty = JSON.stringify(data, null, 2);
      setResultJson(pretty);
      const rows =
        (data as { result?: { records?: unknown[]; totalSize?: number } })?.result?.records?.length ??
        (data as { result?: { totalSize?: number } })?.result?.totalSize ??
        0;
      pushLog("info", `执行成功，返回记录数=${rows}`);
    },
    onError: (e) => {
      setResultJson(null);
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      pushLog("error", `执行失败: ${message}`);
    },
  });

  const refreshCacheMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error("请先选择或登录 Org");
      const objectName = extractFromObject(soql);
      pushLog("info", objectName ? `手动刷新缓存: ${objectName}` : "手动刷新缓存: 全量对象列表");
      await tauriApi.refreshSchemaCache({ orgId: currentOrg, objectName });
      clearSoqlCompletionCache({ orgId: currentOrg, objectName: objectName ?? undefined });
      return { objectName };
    },
    onSuccess: ({ objectName }) => {
      pushLog("info", objectName ? `缓存已刷新: ${objectName}` : "缓存已刷新: 全量对象列表");
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      pushLog("error", `刷新缓存失败: ${message}`);
    },
  });

  const table = useMemo(() => {
    if (!resultJson) return null;
    try {
      const data = JSON.parse(resultJson) as { result?: { records?: Record<string, unknown>[] } };
      const records = data.result?.records;
      if (!records?.length) return null;
      const cols = Object.keys(records[0]);
      return { cols, rows: records };
    } catch {
      return null;
    }
  }, [resultJson]);

  return (
    <section className="module soql-module">
      <div className="module-header">
        <h2>SOQL 编辑器</h2>
        {!currentOrg ? <span className="soql-hint">未选择 Org，请先在 Org 管理中设置默认。</span> : null}
      </div>
      <div className="soql-layout">
        <div className="soql-editor-wrap">
          <div className="soql-history-row">
            <span className="soql-history-label">历史输入</span>
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
              <option value="">{history.length === 0 ? "暂无历史" : "选择历史 SOQL…"}</option>
              {history.map((item, idx) => (
                <option key={`${idx}-${item.slice(0, 20)}`} value={item}>
                  {item.replace(/\s+/g, " ").slice(0, 120)}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => clearHistory()} disabled={history.length === 0}>
              清空历史
            </button>
          </div>
          <SoqlMonacoEditor
            value={soql}
            onChange={setSoql}
            onLog={handleCompletionLog}
            onLoading={setCompletionLoading}
          />
          <div className="soql-toolbar">
            {completionLoading ? <span className="soql-completion-loading">{completionLoading}</span> : null}
            <button
              type="button"
              onClick={() => refreshCacheMutation.mutate()}
              disabled={!currentOrg || refreshCacheMutation.isPending}
            >
              {refreshCacheMutation.isPending ? "刷新缓存中…" : "刷新缓存"}
            </button>
            <button type="button" onClick={() => runMutation.mutate()} disabled={runMutation.isPending || !currentOrg}>
              {runMutation.isPending ? "执行中…" : "执行 SOQL"}
            </button>
          </div>
        </div>
        <div className="soql-results">
          <h3 className="soql-results-title">结果</h3>
          {error ? <div className="empty-state error">{error}</div> : null}
          {table ? (
            <div className="soql-table-scroll">
              <table className="soql-table">
                <thead>
                  <tr>
                    {table.cols.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, i) => (
                    <tr key={i}>
                      {table.cols.map((c) => (
                        <td key={c}>{formatCell(row[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : resultJson && !error ? (
            <pre className="soql-json">{resultJson}</pre>
          ) : !error ? (
            <div className="empty-state">执行查询后在此显示结果。</div>
          ) : null}
        </div>
        <div className="soql-log-panel">
          <div className="soql-log-header">
            <h3 className="soql-results-title">执行日志</h3>
            <button type="button" onClick={() => setLogs([])} disabled={logs.length === 0}>
              清空日志
            </button>
          </div>
          {logs.length === 0 ? (
            <div className="empty-state">暂无日志，执行一次 SOQL 后会显示详细过程。</div>
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

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
