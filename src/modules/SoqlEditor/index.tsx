import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import { useOrgStore } from "../../store/org";
import { SoqlMonacoEditor } from "./SoqlMonacoEditor";

const DEFAULT_SOQL = "SELECT Id, Name\nFROM Account\nLIMIT 20";

export function SoqlEditor() {
  const { currentOrg } = useOrgStore();
  const [soql, setSoql] = useState(DEFAULT_SOQL);
  const [resultJson, setResultJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error("请先选择或登录 Org");
      return invoke<unknown>("run_soql_query", { org_id: currentOrg, query: soql });
    },
    onSuccess: (data) => {
      setError(null);
      setResultJson(JSON.stringify(data, null, 2));
    },
    onError: (e) => {
      setResultJson(null);
      setError(e instanceof Error ? e.message : String(e));
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
          <SoqlMonacoEditor value={soql} onChange={setSoql} />
          <div className="soql-toolbar">
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
      </div>
    </section>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
