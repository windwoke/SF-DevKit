import { useTranslation } from "react-i18next";
import { MetadataTree } from "./MetadataTree";
import { PackageXmlPanel } from "./PackageXmlPanel";
import { RetrievePanel } from "./RetrievePanel";

export function MetadataBrowser() {
  const { t } = useTranslation();
  return (
    <section className="module metadata-module">
      <div className="module-header metadata-header">
        <h2>{t("metadataBrowser.title")}</h2>
      </div>
      <div className="metadata-layout">
        <MetadataTree />
        <PackageXmlPanel />
        <RetrievePanel />
      </div>
    </section>
  );
}
