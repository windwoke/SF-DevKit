import { MetadataTree } from "./MetadataTree";
import { PackageXmlPanel } from "./PackageXmlPanel";
import { RetrievePanel } from "./RetrievePanel";

export function MetadataBrowser() {
  return (
    <section className="module metadata-module">
      <div className="module-header metadata-header">
        <h2>Metadata Browser</h2>
      </div>
      <div className="metadata-layout">
        <MetadataTree />
        <PackageXmlPanel />
        <RetrievePanel />
      </div>
    </section>
  );
}
