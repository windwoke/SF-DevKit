import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { tauriApi } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store/workspace";
import { useOrgStore } from "../../store/org";
import { useDeployStore } from "./store";

function formatRelTime(iso: string, t: TFunction): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("deployer.justNow");
  if (min < 60) return t("deployer.minutesAgo", { count: min });
  return t("deployer.hoursAgo", { count: Math.floor(min / 60) });
}

function IconReveal() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function WorkingDirBar() {
  const { t } = useTranslation();
  const { workingDir, setWorkingDir, targetOrgId, setTargetOrgId } = useDeployStore();
  const { lastRetrieveAt } = useWorkspaceStore();
  const { orgs } = useOrgStore();

  const selectDir = async () => {
    const dir = await tauriApi.pickProjectDirectory();
    if (dir) setWorkingDir(dir);
  };

  const openInFinder = async () => {
    if (workingDir) await tauriApi.revealInFinder(workingDir);
  };

  return (
    <div className="deployer-working-bar">
      <div className="deployer-working-field">
        <label>{t("deployer.workingDir")}</label>
        {lastRetrieveAt && (
          <span className="deployer-working-hint">
            {t("deployer.fromMetadataBrowser", { time: formatRelTime(lastRetrieveAt, t) })}
          </span>
        )}
        <div className="deployer-working-row">
          <div
            className={`deployer-path-display ${!workingDir ? "deployer-path-empty" : ""}`}
            onClick={selectDir}
            title={workingDir ?? t("deployer.workingDirPlaceholder")}
          >
            {workingDir ?? t("deployer.workingDirPlaceholder")}
          </div>
          {workingDir && (
            <button className="deployer-icon-btn" onClick={openInFinder} title={t("deployer.openInFinder")}>
              <IconReveal />
            </button>
          )}
        </div>
      </div>

      <div className="deployer-target-field">
        <label>{t("deployer.targetOrg")}</label>
        <select
          value={targetOrgId ?? ""}
          onChange={(e) => setTargetOrgId(e.target.value)}
        >
          <option value="">{t("deployer.selectOrg")}</option>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.alias ?? org.id}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
