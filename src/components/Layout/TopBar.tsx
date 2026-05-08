import { orgTypeLabel } from "../../lib/orgTypeLabel";
import { tauriApi } from "../../lib/tauri";
import { useOrgStore } from "../../store/org";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../../i18n";

export function TopBar() {
  const { t, i18n } = useTranslation();
  const { currentOrg, orgs } = useOrgStore();
  const org = orgs.find((o) => o.id === currentOrg);
  const openMutation = useMutation({
    mutationFn: (username: string) => tauriApi.openOrg(username),
  });

  return (
    <header className="topbar topbar--right-only">
      <div className="topbar-right">
        <label className="topbar-lang">
          <span>{t("topbar.language")}</span>
          <select
            value={i18n.language.startsWith("zh") ? "zh-CN" : "en-US"}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
          >
            {SUPPORTED_LANGUAGES.map((lng) => (
              <option key={lng} value={lng}>
                {t(`language.${lng}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="topbar-org-info">
          {org ? (
            <>
              <span>{t("topbar.currentOrg", { name: org.alias ?? org.id })}</span>
              <span className={`org-type org-type-${org.org_type}`}>{orgTypeLabel(org.org_type, t)}</span>
            </>
          ) : (
            t("topbar.noOrg")
          )}
        </div>
        <button
          className="topbar-open-btn"
          onClick={() => org && openMutation.mutate(org.id)}
          disabled={!org || openMutation.isPending}
        >
          {openMutation.isPending ? t("topbar.opening") : t("topbar.open")}
        </button>
      </div>
    </header>
  );
}
