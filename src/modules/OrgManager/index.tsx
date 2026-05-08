import { useTranslation } from "react-i18next";
import { OrgList } from "./OrgList";

export function OrgManager() {
  const { t } = useTranslation();
  return (
    <section className="module module-org">
      <div className="module-header module-header--compact">
        <h2>{t("modules.orgs")}</h2>
      </div>
      <OrgList />
    </section>
  );
}
