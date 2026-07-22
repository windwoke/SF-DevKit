import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDashboardStore, type QuickAction } from "../../store/dashboard";
import { useUiStore } from "../../store/ui";
import { tauriApi } from "../../lib/tauri";
import { AddQuickActionDialog } from "./AddQuickActionDialog";

export function QuickActionsPanel() {
  const { t } = useTranslation();
  const quickActions = useDashboardStore((s) => s.quickActions);
  const removeQuickAction = useDashboardStore((s) => s.removeQuickAction);
  const reorderQuickActions = useDashboardStore((s) => s.reorderQuickActions);
  const setActiveModule = useUiStore((s) => s.setActiveModule);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const resolveLabel = (action: QuickAction): string =>
    action.labelKey ? t(action.labelKey) : action.label;

  const handleTrigger = async (action: QuickAction) => {
    setTriggerError(null);
    try {
      if (action.kind === "module" && action.moduleId) {
        setActiveModule(action.moduleId);
        return;
      }
      if (action.kind === "url" && action.target) {
        await tauriApi.openExternal({ kind: "url", target: action.target });
        return;
      }
      if (action.kind === "app" && action.target) {
        await tauriApi.openExternal({
          kind: "app",
          target: action.target,
          args: action.args,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTriggerError(
        t("dashboard.quickActions.launchFailed", { error: message }),
      );
    }
  };

  return (
    <div className="home-card home-card--quick-actions">
      <div className="home-card__header">
        <h3>{t("dashboard.quickActions.title")}</h3>
        <div className="home-card__header-actions">
          {managing && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setAdding(true)}
            >
              + {t("dashboard.quickActions.add")}
            </button>
          )}
          <button
            className={`btn btn-sm quick-actions-manage-btn ${managing ? "btn-primary is-active" : "btn-ghost"}`}
            onClick={() => setManaging((value) => !value)}
            aria-label={
              managing
                ? t("dashboard.quickActions.done")
                : t("dashboard.quickActions.manage")
            }
            title={
              managing
                ? t("dashboard.quickActions.done")
                : t("dashboard.quickActions.manage")
            }
          >
            <span aria-hidden>⚙</span>
          </button>
        </div>
      </div>
      {triggerError && (
        <div className="quick-action-error" role="alert" title={triggerError}>
          {triggerError}
        </div>
      )}
      {quickActions.length === 0 ? (
        <div className="home-card__empty">
          <p>{t("dashboard.quickActions.empty")}</p>
        </div>
      ) : (
        <div className="quick-action-grid">
          {quickActions.map((action, idx) => (
            <div
              className={`quick-action ${managing ? "is-managing" : ""}`}
              key={action.uid}
            >
              <button
                className="quick-action__btn"
                onClick={() => !managing && handleTrigger(action)}
                disabled={managing}
                title={`${resolveLabel(action)}${action.target ? `\n${action.target}` : ""}`}
              >
                <span className="quick-action__icon" aria-hidden>
                  {action.icon || "•"}
                </span>
                <span className="quick-action__label">
                  {resolveLabel(action)}
                </span>
              </button>
              {managing && (
                <div className="quick-action__manage-tools">
                  <button
                    type="button"
                    onClick={() => reorderQuickActions(idx, idx - 1)}
                    disabled={idx === 0}
                    aria-label={t("dashboard.quickActions.moveEarlier")}
                    title={t("dashboard.quickActions.moveEarlier")}
                  >
                    ←
                  </button>
                  <span>{idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => reorderQuickActions(idx, idx + 1)}
                    disabled={idx === quickActions.length - 1}
                    aria-label={t("dashboard.quickActions.moveLater")}
                    title={t("dashboard.quickActions.moveLater")}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    onClick={() => removeQuickAction(action.uid)}
                    aria-label={t("dashboard.quickActions.remove")}
                    title={t("dashboard.quickActions.remove")}
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {managing && adding && (
        <AddQuickActionDialog onClose={() => setAdding(false)} />
      )}
    </div>
  );
}
