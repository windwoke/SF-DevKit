import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  id: string;
  editing: boolean;
  onRemove: () => void;
  children: ReactNode;
}

/**
 * Wraps a widget card. In edit mode:
 *  - The whole card is draggable.
 *  - Top-right × removes the widget.
 *  - Bottom-right ⇲ resize handle is injected by react-resizable.
 */
export function WidgetFrame({ id, editing, onRemove, children }: Props) {
  const { t } = useTranslation();
  return (
    <div className={`widget-frame ${editing ? "is-editing" : ""}`}>
      {editing && (
        <button
          className="widget-frame__remove"
          onClick={onRemove}
          aria-label={t("dashboard.layout.remove")}
          title={t("dashboard.layout.remove")}
          data-widget-id={id}
        >
          ×
        </button>
      )}
      <div className="widget-frame__content">{children}</div>
    </div>
  );
}
