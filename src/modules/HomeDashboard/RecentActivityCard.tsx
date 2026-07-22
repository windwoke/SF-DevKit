import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useOrgStore } from "../../store/org";
import { useUiStore } from "../../store/ui";
import { tauriApi } from "../../lib/tauri";
import { formatActivityRelativeTime } from "./activityTime";

interface ActivityItem {
  kind: "retrieve" | "deploy";
  ts: string | null;
  success: boolean;
  detail: string;
  onClick: () => void;
}

function parseTs(ts: string): number {
  const parsed = Date.parse(ts);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function RecentActivityCard() {
  const { t, i18n } = useTranslation();
  const currentOrgId = useOrgStore((s) => s.currentOrg);
  const setActiveModule = useUiStore((s) => s.setActiveModule);

  const enabled = !!currentOrgId;

  const deploys = useQuery({
    queryKey: ["home", "deploys", currentOrgId],
    queryFn: () =>
      tauriApi.listDeployHistory({ orgId: currentOrgId!, limit: 5 }),
    enabled,
    staleTime: 60 * 1000,
  });

  const retrieves = useQuery({
    queryKey: ["home", "retrieves", currentOrgId],
    queryFn: () =>
      tauriApi.listRetrieveHistory({ orgId: currentOrgId!, limit: 5 }),
    enabled,
    staleTime: 60 * 1000,
  });

  if (!enabled) {
    return (
      <div className="home-card home-card--recent-activity">
        <div className="home-card__header">
          <h3>{t("dashboard.recentActivity.title")}</h3>
        </div>
        <div className="home-card__empty">
          <p>{t("dashboard.recentActivity.empty")}</p>
        </div>
      </div>
    );
  }

  const items: ActivityItem[] = [];
  for (const d of deploys.data ?? []) {
    const components = t("dashboard.recentActivity.componentCount", {
      count: d.component_count,
    });
    const errors = t("dashboard.recentActivity.errorCount", {
      count: d.error_count,
    });
    items.push({
      kind: "deploy",
      ts: d.executed_at,
      success: d.success,
      detail: t("dashboard.recentActivity.deployDetail", {
        components,
        errors,
      }),
      onClick: () => setActiveModule("deployer"),
    });
  }
  for (const r of retrieves.data ?? []) {
    let count = 0;
    try {
      const parsed = JSON.parse(r.selections_json) as Array<{
        members?: unknown[];
      }>;
      count = parsed.reduce((sum, s) => sum + (s.members?.length ?? 0), 0);
    } catch {
      count = 0;
    }
    const components = t("dashboard.recentActivity.componentCount", { count });
    const outputMode = t(
      `dashboard.recentActivity.outputMode.${r.output_mode}`,
      {
        defaultValue: r.output_mode,
      },
    );
    items.push({
      kind: "retrieve",
      ts: r.executed_at,
      success: r.status === "success",
      detail: t("dashboard.recentActivity.retrieveDetail", {
        components,
        outputMode,
      }),
      onClick: () => setActiveModule("metadata"),
    });
  }
  items.sort((a, b) => parseTs(b.ts ?? "") - parseTs(a.ts ?? ""));
  const top = items.slice(0, 8);

  return (
    <div className="home-card home-card--recent-activity">
      <div className="home-card__header">
        <h3>{t("dashboard.recentActivity.title")}</h3>
      </div>
      {top.length === 0 ? (
        <div className="home-card__empty">
          <p>{t("dashboard.recentActivity.empty")}</p>
        </div>
      ) : (
        <ul className="recent-list">
          {top.map((item, idx) => (
            <li key={idx}>
              <button
                className={`recent-item recent-item--${item.kind} ${
                  item.success ? "is-ok" : "is-err"
                }`}
                onClick={item.onClick}
                title={item.detail}
              >
                <span className="recent-item__badge">
                  {item.kind === "deploy" ? "⬆" : "⬇"}
                </span>
                <span className="recent-item__detail">{item.detail}</span>
                <span className="recent-item__ts">
                  {formatActivityRelativeTime(
                    item.ts,
                    i18n.resolvedLanguage ?? i18n.language,
                    t("dashboard.recentActivity.justNow"),
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
