import { useTranslation } from "react-i18next";
import { MetadataLayoutResizable } from "./MetadataLayoutResizable";

export function MetadataBrowser() {
  const { t } = useTranslation();
  return (
    <section className="module metadata-module">
      <div className="module-header metadata-header">
        <h2>{t("metadataBrowser.title")}</h2>
      </div>
      <MetadataLayoutResizable />
    </section>
  );
}
