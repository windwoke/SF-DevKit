import { useTranslation } from "react-i18next";

export interface ConfirmAction {
  title: string;
  items: { label: string; value: string }[];
  onConfirm: () => void;
}

export function ConfirmModal({ action, onClose }: { action: ConfirmAction; onClose: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="deployer-confirm-overlay" onClick={onClose}>
      <div className="deployer-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="deployer-confirm-title">{action.title}</div>
        <div className="deployer-confirm-body">
          {action.items.map((item, i) => (
            <div key={i} className="deployer-confirm-item">
              <span className="deployer-confirm-label">{item.label}</span>
              <span className="deployer-confirm-value">{item.value}</span>
            </div>
          ))}
        </div>
        <div className="deployer-confirm-actions">
          <button className="deployer-confirm-cancel" onClick={onClose}>
            {t("orgManager.cancel")}
          </button>
          <button
            className="deployer-confirm-ok"
            onClick={() => {
              action.onConfirm();
              onClose();
            }}
          >
            {t("deployer.confirmOk")}
          </button>
        </div>
      </div>
    </div>
  );
}
