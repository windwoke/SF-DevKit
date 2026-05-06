import { useMutation } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useRef, useState } from "react";
import { tauriApi } from "../../lib/tauri";
import { useMetadataStore } from "../../store/metadata";
import { useOrgStore } from "../../store/org";

interface LogLine {
  type: "start" | "stdout" | "stderr" | "exit" | "info";
  text: string;
}

export function RetrievePanel() {
  const { currentOrg } = useOrgStore();
  const { selectedCount, toSelectionList, clearSelection, outputDir, setOutputDir, outputMode, setOutputMode, apiVersion, setApiVersion } =
    useMetadataStore();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [lastOutputPath, setLastOutputPath] = useState("");
  const eventIdRef = useRef("");
  const unlistenRef = useRef<null | (() => void)>(null);

  const retrieveMutation = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error("请先选择 Org");
      if (!outputDir) throw new Error("请先选择输出目录");
      const selections = toSelectionList();
      if (selections.length === 0) throw new Error("请先勾选至少一个组件");
      const eventId = `metadata-retrieve-${Date.now()}`;
      eventIdRef.current = eventId;
      setLogs([]);
      setLastOutputPath("");

      const unlisten = await listen<{ event_type: LogLine["type"]; data: string }>(eventId, ({ payload }) => {
        setLogs((prev) => [...prev, { type: payload.event_type, text: payload.data }]);
      });
      unlistenRef.current = unlisten;

      const result = await tauriApi.retrieveMetadata({
        orgId: currentOrg,
        selections,
        outputDir,
        outputMode,
        apiVersion,
        eventId,
      });
      return result;
    },
    onSuccess: (result) => {
      setLastOutputPath(result.output_path);
      setLogs((prev) => [...prev, { type: "info", text: `完成，耗时 ${(result.duration_ms / 1000).toFixed(1)}s` }]);
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
    onSuccess: () => setLogs((prev) => [...prev, { type: "info", text: "已请求取消任务。" }]),
  });

  const chooseDir = async () => {
    const picked = await tauriApi.pickProjectDirectory();
    if (picked) setOutputDir(picked);
  };

  return (
    <section className="metadata-pane metadata-retrieve-pane">
      <header className="metadata-pane-header">
        <h3>下载面板</h3>
      </header>

      <div className="metadata-field">
        <label>输出目录</label>
        <div className="metadata-output-row">
          <input readOnly value={outputDir} placeholder="请选择输出目录…" />
          <button type="button" onClick={() => void chooseDir()}>
            选择
          </button>
        </div>
      </div>

      <div className="metadata-field">
        <label>输出格式</label>
        <div className="metadata-radio-row">
          <label>
            <input type="radio" checked={outputMode === "extract"} onChange={() => setOutputMode("extract")} /> 解压到目录
          </label>
          <label>
            <input type="radio" checked={outputMode === "zip"} onChange={() => setOutputMode("zip")} /> 保留 zip
          </label>
        </div>
      </div>

      <div className="metadata-field">
        <label>API 版本</label>
        <select value={apiVersion} onChange={(e) => setApiVersion(e.target.value)}>
          {["62.0", "61.0", "60.0", "59.0", "58.0"].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div className="metadata-summary-row">
        <span>已选 {selectedCount()} 个组件</span>
        <button type="button" onClick={clearSelection} disabled={selectedCount() === 0}>
          清空
        </button>
      </div>

      <div className="metadata-action-row">
        <button
          type="button"
          className="metadata-primary-btn"
          onClick={() => void retrieveMutation.mutateAsync()}
          disabled={retrieveMutation.isPending || !currentOrg}
        >
          {retrieveMutation.isPending ? "执行中…" : "下载"}
        </button>
        <button type="button" onClick={() => cancelMutation.mutate()} disabled={!retrieveMutation.isPending}>
          取消
        </button>
        <button type="button" onClick={() => tauriApi.revealInFinder(lastOutputPath)} disabled={!lastOutputPath}>
          打开目录
        </button>
      </div>

      <div className="metadata-log-panel">
        {logs.length === 0 ? <div className="metadata-muted">执行日志将显示在这里。</div> : null}
        {logs.map((line, idx) => (
          <div key={`${line.type}-${idx}`} className={`metadata-log-line metadata-log-${line.type}`}>
            {line.text}
          </div>
        ))}
      </div>
    </section>
  );
}
