import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useOrgStore } from "../../store/org";
import { useUiStore } from "../../store/ui";
import { tauriApi } from "../../lib/tauri";
import { orgTypeLabel } from "../../lib/orgTypeLabel";

function IconSwitch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 8h11m0 0-2.6-2.6M16 8l-2.6 2.6M19 16H8m0 0 2.6-2.6M8 16l2.6 2.6" />
    </svg>
  );
}

function IconCompass() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.8 8.2-2.3 6.1-6.1 2.3 2.3-6.1 6.1-2.3Z" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-10Z" />
    </svg>
  );
}

export function OrgStatusCard() {
  const { t } = useTranslation();
  const currentOrgId = useOrgStore((s) => s.currentOrg);
  const orgs = useOrgStore((s) => s.orgs);
  const setActiveModule = useUiStore((s) => s.setActiveModule);

  const org = orgs.find((o) => o.id === currentOrgId) ?? null;

  const openOrg = useMutation({
    mutationFn: (orgId: string) => tauriApi.openOrg(orgId),
  });
  const openDirectory = useMutation({
    mutationFn: (path: string) =>
      tauriApi.openExternal({ kind: "path", target: path }),
  });

  return (
    <div className="home-card home-card--org">
      <div className="home-card__header">
        <h3>{t("dashboard.orgStatus.title")}</h3>
      </div>
      {!org ? (
        <div className="home-card__empty">
          <p>{t("dashboard.orgStatus.noOrg")}</p>
          <button
            className="btn btn-primary"
            onClick={() => setActiveModule("orgs")}
          >
            {t("dashboard.orgStatus.goOrgs")}
          </button>
        </div>
      ) : (
        <div className="home-card__body">
          <dl className="org-status-grid">
            <dt>{t("dashboard.orgStatus.alias")}</dt>
            <dd>{org.alias ?? org.id}</dd>
            <dt>{t("dashboard.orgStatus.type")}</dt>
            <dd>{orgTypeLabel(org.org_type, t)}</dd>
            <dt>{t("dashboard.orgStatus.localDirectory")}</dt>
            <dd title={org.linked_project_path ?? undefined}>
              {org.linked_project_path || t("dashboard.orgStatus.notLinked")}
            </dd>
          </dl>
          <div className="org-status-actions">
            <button
              className="card-action-btn"
              onClick={() => setActiveModule("orgs")}
            >
              <IconSwitch />
              <span>{t("dashboard.orgStatus.switch")}</span>
            </button>
            <button
              className="card-action-btn"
              onClick={() => openOrg.mutate(org.id)}
              disabled={openOrg.isPending}
            >
              <IconCompass />
              <span>{t("dashboard.orgStatus.openOrg")}</span>
            </button>
            <button
              className="card-action-btn"
              onClick={() =>
                org.linked_project_path &&
                openDirectory.mutate(org.linked_project_path)
              }
              disabled={!org.linked_project_path || openDirectory.isPending}
            >
              <IconFolder />
              <span>{t("dashboard.orgStatus.openDirectory")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
