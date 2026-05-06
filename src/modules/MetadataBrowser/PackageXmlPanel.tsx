import Editor from "@monaco-editor/react";
import { useMemo } from "react";
import { useMetadataStore } from "../../store/metadata";
import { generatePackageXml } from "./packageXml";

export function PackageXmlPanel() {
  const { apiVersion, selection, toSelectionList } = useMetadataStore();
  const packageXml = useMemo(() => generatePackageXml(toSelectionList(), apiVersion), [selection, apiVersion, toSelectionList]);

  return (
    <section className="metadata-pane">
      <header className="metadata-pane-header">
        <h3>package.xml 预览</h3>
      </header>
      <div className="metadata-package-editor">
        <Editor
          height="100%"
          language="xml"
          value={packageXml}
          theme="vs-dark"
          options={{
            readOnly: true,
            minimap: { enabled: false },
            lineNumbers: "on",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            fontSize: 12,
          }}
        />
      </div>
    </section>
  );
}
