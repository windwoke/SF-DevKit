import { useQueryClient } from "@tanstack/react-query";
import { MetadataTree } from "./MetadataTree";
import { PackageXmlPanel } from "./PackageXmlPanel";
import { RetrievePanel } from "./RetrievePanel";
import { useMetadataStore } from "../../store/metadata";
import { useOrgStore } from "../../store/org";

export function MetadataBrowser() {
  const queryClient = useQueryClient();
  const { currentOrg } = useOrgStore();
  const { searchQuery, setSearchQuery, selectedCount } = useMetadataStore();

  const refresh = () => {
    if (!currentOrg) return;
    queryClient.invalidateQueries({ queryKey: ["metadata-types", currentOrg] });
    queryClient.invalidateQueries({ queryKey: ["metadata-components", currentOrg] });
  };

  return (
    <section className="module metadata-module">
      <div className="module-header metadata-header">
        <h2>Metadata Browser</h2>
        <div className="metadata-toolbar">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索 Metadata Type 或组件名…"
          />
          <span className="metadata-selected-chip">已选 {selectedCount()}</span>
          <button type="button" onClick={refresh}>
            刷新
          </button>
        </div>
      </div>
      <div className="metadata-layout">
        <MetadataTree />
        <PackageXmlPanel />
        <RetrievePanel />
      </div>
    </section>
  );
}
