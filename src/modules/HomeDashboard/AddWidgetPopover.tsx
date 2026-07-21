import { useTranslation } from "react-i18next";
import type { WidgetKind } from "../../store/dashboard";

interface Props {
  onPick: (kind: WidgetKind) => void;
  onClose: () => void;
}

const ORDER: WidgetKind[] = [
  "greeting",
  "orgStatus",
  "quickActions",
  "recentSoql",
  "recentActivity",
  "news",
];

const ICONS: Record<WidgetKind, string> = {
  greeting: "☀️",
  orgStatus: "🏢",
  quickActions: "⚡",
  recentSoql: "🔍",
  recentActivity: "🕒",
  news: "📰",
};

export function AddWidgetPopover({ onPick, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <h4>{t("dashboard.layout.addTitle")}</h4>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="dialog__body">
          <ul className="add-widget-list">
            {ORDER.map((kind) => (
              <li key={kind}>
                <button
                  className="add-widget-item"
                  onClick={() => onPick(kind)}
                >
                  <span className="add-widget-item__icon" aria-hidden>
                    {ICONS[kind]}
                  </span>
                  <span>{t(`dashboard.manage.widgets.${kind}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
