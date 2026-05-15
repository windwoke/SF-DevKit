import { orgTypeLabel } from "../../lib/orgTypeLabel";
import { tauriApi } from "../../lib/tauri";
import { useOrgStore } from "../../store/org";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

export function TopBar({ moduleName }: { moduleName: string }) {
  const { t } = useTranslation();
  const { currentOrg, orgs } = useOrgStore();
  const org = orgs.find((o) => o.id === currentOrg);
  const openMutation = useMutation({
    mutationFn: (username: string) => tauriApi.openOrg(username),
  });

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="topbar-module-name">{moduleName}</span>
      </div>
      <div className="topbar-right">
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
