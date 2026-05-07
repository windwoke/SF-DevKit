import Editor from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMonaco } from "@monaco-editor/react";
import { useMetadataStore } from "../../store/metadata";
import { generatePackageXml, parsePackageXml } from "./packageXml";
import { registerPackageXmlCompletion } from "./xmlCompletion";
import { useOrgStore } from "../../store/org";
import { computePackageXmlDiagnostics } from "./xmlCompletion/diagnostics";
import { parseXmlCompletionContext } from "./xmlCompletion/contextParser";

export function PackageXmlPanel() {
  const monaco = useMonaco();
  const { currentOrg } = useOrgStore();
  const { apiVersion, selection, toSelectionList, replaceSelectionFromList } = useMetadataStore();
  const previewXml = useMemo(() => generatePackageXml(toSelectionList(), apiVersion), [selection, apiVersion, toSelectionList]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [draftXml, setDraftXml] = useState(previewXml);
  const [lastSyncedXml, setLastSyncedXml] = useState(previewXml);
  const [draftError, setDraftError] = useState<string | null>(null);
  const modelRef = useRef<import("monaco-editor").editor.ITextModel | null>(null);
  const isEditModeRef = useRef(false);

  useEffect(() => {
    isEditModeRef.current = isEditMode;
  }, [isEditMode]);

  useEffect(() => {
    if (!isEditMode) {
      setDraftXml(previewXml);
      setLastSyncedXml(previewXml);
      setDraftError(null);
    }
  }, [previewXml, isEditMode]);

  const dirty = isEditMode && draftXml !== lastSyncedXml;
  const editorValue = isEditMode ? draftXml : previewXml;

  const enterEditMode = () => {
    setDraftXml(previewXml);
    setLastSyncedXml(previewXml);
    setDraftError(null);
    setIsEditMode(true);
  };

  const exitEditMode = () => {
    if (dirty) {
      const shouldDiscard = window.confirm("当前草稿有未应用修改，确定退出编辑并放弃草稿吗？");
      if (!shouldDiscard) return;
    }
    setIsEditMode(false);
    setDraftError(null);
  };

  const overwriteDraftFromSelection = () => {
    setDraftXml(previewXml);
    setLastSyncedXml(previewXml);
    setDraftError(null);
  };

  const applyDraftToSelection = () => {
    try {
      const parsed = parsePackageXml(draftXml);
      replaceSelectionFromList(parsed);
      setLastSyncedXml(draftXml);
      setDraftError(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setDraftError(message);
    }
  };

  useEffect(() => {
    if (!monaco || !currentOrg || !isEditMode) return;
    const disposable = registerPackageXmlCompletion(monaco, currentOrg);
    return () => disposable.dispose();
  }, [monaco, currentOrg, isEditMode]);

  useEffect(() => {
    if (!monaco) return;
    const model = modelRef.current;
    if (!model) return;
    if (!isEditMode) {
      monaco.editor.setModelMarkers(model, "package-xml-diagnostics", []);
      return;
    }
    const markers = computePackageXmlDiagnostics(monaco, draftXml);
    monaco.editor.setModelMarkers(model, "package-xml-diagnostics", markers);
  }, [monaco, isEditMode, draftXml, selection]);

  return (
    <section className="metadata-pane">
      <header className="metadata-pane-header">
        <div className="metadata-package-header-row">
          <h3>package.xml 预览</h3>
          <button type="button" onClick={isEditMode ? exitEditMode : enterEditMode}>
            {isEditMode ? "退出编辑" : "编辑 package.xml"}
          </button>
        </div>
        {isEditMode ? (
          <div className="metadata-package-tools">
            <span className={`metadata-package-status ${dirty ? "dirty" : "synced"}`}>{dirty ? "草稿未应用" : "草稿已同步"}</span>
            <button type="button" onClick={overwriteDraftFromSelection}>
              用左侧选择覆盖草稿
            </button>
            <button type="button" onClick={applyDraftToSelection}>
              将草稿应用到左侧选择
            </button>
          </div>
        ) : null}
        {isEditMode ? <div className="metadata-package-banner">编辑模式已启用：左侧勾选不会自动覆盖当前草稿。</div> : null}
        {draftError ? <div className="metadata-package-error">解析失败：{draftError}</div> : null}
      </header>
      <div className="metadata-package-editor">
        <Editor
          height="100%"
          language="xml"
          value={editorValue}
          onChange={(value) => {
            if (!isEditMode) return;
            setDraftXml(value ?? "");
          }}
          theme="vs-dark"
          options={{
            readOnly: !isEditMode,
            minimap: { enabled: false },
            lineNumbers: "on",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            fontSize: 12,
            autoClosingBrackets: "never",
            autoClosingQuotes: "never",
            autoClosingDelete: "never",
            autoClosingOvertype: "never",
            quickSuggestions: { other: true, comments: false, strings: true },
            suggest: { showWords: false, preview: true },
          }}
          onMount={(editor) => {
            const model = editor.getModel();
            if (model) {
              modelRef.current = model;
              model.onDidChangeContent((event) => {
                if (!isEditModeRef.current) return;
                const isDelete = event.changes.some((change) => change.text.length === 0 && change.rangeLength > 0);
                if (!isDelete) return;
                const position = editor.getPosition();
                if (!position) return;
                const offset = model.getOffsetAt(position);
                const ctx = parseXmlCompletionContext(model.getValue(), offset);
                if (ctx.kind !== "NAME_CONTENT" && ctx.kind !== "MEMBERS_CONTENT") return;
                queueMicrotask(() => {
                  editor.trigger("package-xml-delete", "editor.action.triggerSuggest", {});
                });
              });
            }
          }}
        />
      </div>
    </section>
  );
}
