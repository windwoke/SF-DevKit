import Editor from "@monaco-editor/react";
import { loader } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import * as monaco from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOrgStore } from "../../store/org";
import { useEffectiveTheme } from "../../store/settings";
import { registerSoqlCompletion, type CompletionLoadingFn, type CompletionLogFn } from "./soqlCompletion";
import { registerSoqlLanguage, registerSoqlLanguageConfiguration, registerSoqlTokenizer } from "./tokenizer";

loader.config({ monaco });

interface SoqlMonacoEditorProps {
  value: string;
  onChange: (v: string) => void;
  onLog?: CompletionLogFn;
  onLoading?: CompletionLoadingFn;
  /** Cmd+Enter / Ctrl+Enter 执行查询 */
  onRun?: () => void;
  runDisabled?: boolean;
  /** Command palette / keyboard action label (i18n) */
  runActionLabel: string;
}

export function SoqlMonacoEditor({ value, onChange, onLog, onLoading, onRun, runDisabled, runActionLabel }: SoqlMonacoEditorProps) {
  const { currentOrg } = useOrgStore();
  const effectiveTheme = useEffectiveTheme();
  const orgRef = useRef(currentOrg);
  const onLogRef = useRef(onLog);
  const onLoadingRef = useRef(onLoading);
  const onRunRef = useRef(onRun);
  const runDisabledRef = useRef(runDisabled);
  orgRef.current = currentOrg;
  onLogRef.current = onLog;
  onLoadingRef.current = onLoading;
  onRunRef.current = onRun;
  runDisabledRef.current = runDisabled;

  const [mountedEditor, setMountedEditor] = useState<editor.IStandaloneCodeEditor | null>(null);

  const options = useMemo(
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

  useEffect(() => {
    registerSoqlLanguage();
    registerSoqlTokenizer();
    registerSoqlLanguageConfiguration();
    monaco.editor.defineTheme("sfdevkit-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#FBFCFE",
        "editor.foreground": "#172033",
        "editorLineNumber.foreground": "#68758C",
        "editorLineNumber.activeForeground": "#3B465A",
        "editorCursor.foreground": "#2563EB",
        "editor.selectionBackground": "#CFE0FF",
        "editor.inactiveSelectionBackground": "#E4ECFA",
        "editor.lineHighlightBackground": "#F3F6FA",
        "editorIndentGuide.background1": "#E2E7EF",
        "editorIndentGuide.activeBackground1": "#B9C2D0",
      },
    });
  }, []);

  useEffect(() => {
    const disposables = registerSoqlCompletion(orgRef.current, (message, level) => {
      onLogRef.current?.(message, level);
    }, (message) => {
      onLoadingRef.current?.(message);
    });
    return () => {
      disposables.forEach((d) => d.dispose());
    };
  }, [currentOrg]);

  useEffect(() => {
    if (!mountedEditor) return;
    const disposable = mountedEditor.addAction({
      id: "sfdevkit.soql.run",
      label: runActionLabel,
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        if (runDisabledRef.current) return;
        onRunRef.current?.();
      },
    });
    return () => disposable.dispose();
  }, [mountedEditor, runActionLabel]);

  return (
    <Editor
      height="280px"
      defaultLanguage="soql"
      theme={effectiveTheme === "light" ? "sfdevkit-light" : "vs-dark"}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      options={options}
      onMount={(editor) => setMountedEditor(editor)}
    />
  );
}
