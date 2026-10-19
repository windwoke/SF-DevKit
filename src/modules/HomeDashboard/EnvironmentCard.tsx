import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { tauriApi } from "../../lib/tauri";

export function EnvironmentCard() {
  const { t, i18n } = useTranslation();
  const [openError, setOpenError] = useState<string | null>(null);
  const openDownload = async (target: string) => {
    setOpenError(null);
    try {
      await tauriApi.openExternal({ kind: "url", target });
    } catch (error) {
      setOpenError(String(error));
    }
  };
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ["environment"],
    queryFn: tauriApi.checkEnvironment,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const failures = data?.checks.filter((check) => check.status === "error").length ?? 0;
  const warnings = data?.checks.some((check) => check.status === "warning");
  const status = failures > 0 ? "error" : warnings ? "warning" : "ok";

  return (
    <div className="home-card home-card--environment" aria-busy={isFetching}>
      <div className="home-card__header">
        <h3>{t("dashboard.environment.title")}</h3>
        <div className="home-card__header-actions">
          <button type="button" className="btn btn-ghost btn-sm" disabled={isFetching} onClick={() => void refetch()}>
            {t(`dashboard.environment.${isFetching ? "checking" : "recheck"}`)}
          </button>
        </div>
      </div>
      <div className="home-card__body environment-card__body">
        <div role="status" className={`environment-summary is-${error ? "error" : status}`}>
          {error
            ? t("dashboard.environment.checkFailed")
            : !data
              ? t("dashboard.environment.checking")
              : failures > 0
                ? t("dashboard.environment.needsAttention", { count: failures })
                : t(`dashboard.environment.${warnings ? "readyWithWarning" : "ready"}`)}
        </div>
        {error && <p className="environment-check__help">{String(error)}</p>}
        {openError && <p role="alert" className="environment-check__help">{openError}</p>}
        {data && (
          <>
            <ul className="environment-checks">
              {data.checks.map((check) => (
                <li key={check.id} className={`environment-check is-${check.status}`}>
                  <span className="environment-check__icon" aria-hidden="true">
                    {check.status === "ok" ? "✓" : check.status === "warning" ? "!" : "×"}
                  </span>
                  <div className="environment-check__content">
                    <div className="environment-check__heading">
                      <strong>{t(`dashboard.environment.items.${check.id}`)}</strong>
                      <span className="environment-check__status">{t(`dashboard.environment.status.${check.status}`)}</span>
                    </div>
                    {check.version && <span className="environment-check__version">{check.version}</span>}
                    {check.path && <code className="environment-check__path" title={check.path}>{check.path}</code>}
                    {check.issue && (
                      <p className="environment-check__help">
                        {t(`dashboard.environment.issues.${check.issue}`, {
                          tool: t(`dashboard.environment.items.${check.id}`),
                        })}
                      </p>
                    )}
                    {check.id === "salesforceCli" && check.issue === "missing" && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openDownload("https://developer.salesforce.com/tools/salesforcecli")}>
                        {t("dashboard.environment.installCli")}
                      </button>
                    )}
                    {check.id === "node" && check.status === "error" && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openDownload("https://nodejs.org/en/download")}>
                        {t("dashboard.environment.installNode")}
                      </button>
                    )}
                    {check.detail && <pre className="environment-check__detail">{check.detail}</pre>}
                  </div>
                </li>
              ))}
            </ul>
            <details className="environment-details">
              <summary>{t("dashboard.environment.details")}</summary>
              <p>{t("dashboard.environment.checkedAt", {
                time: new Date(data.checked_at).toLocaleTimeString(i18n.language),
              })}</p>
              <code>{data.search_path}</code>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
