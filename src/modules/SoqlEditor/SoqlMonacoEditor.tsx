import Editor from "@monaco-editor/react";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useEffect, useMemo, useRef } from "react";
import { useOrgStore } from "../../store/org";
import { registerSoqlCompletion } from "./soqlCompletion";
import { registerSoqlLanguage, registerSoqlTokenizer } from "./tokenizer";

loader.config({ monaco });

interface SoqlMonacoEditorProps {
  value: string;
  onChange: (v: string) => void;
}

export function SoqlMonacoEditor({ value, onChange }: SoqlMonacoEditorProps) {
  const { currentOrg } = useOrgStore();
  const orgRef = useRef(currentOrg);
  orgRef.current = currentOrg;

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
  }, []);

  useEffect(() => {
    const disposables = registerSoqlCompletion(orgRef.current);
    return () => {
      disposables.forEach((d) => d.dispose());
    };
  }, [currentOrg]);

  return (
    <Editor
      height="280px"
      defaultLanguage="soql"
      theme="vs-dark"
      value={value}
      onChange={(v) => onChange(v ?? "")}
      options={options}
    />
  );
}
