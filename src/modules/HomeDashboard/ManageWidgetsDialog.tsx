import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  useDashboardStore,
  type NewsSource,
  type NewsSourceKind,
} from "../../store/dashboard";

interface Props {
  onClose: () => void;
}

/**
 * Manage news subscriptions only. Widget layout is now done inline
 * (drag/resize on the grid itself); this dialog just handles RSS / SE source
 * CRUD, opened from the news card's "Manage Sources" button.
 */
export function ManageWidgetsDialog({ onClose }: Props) {
  const { t } = useTranslation();
  const newsSources = useDashboardStore((s) => s.newsSources);
  const addNewsSource = useDashboardStore((s) => s.addNewsSource);
  const updateNewsSource = useDashboardStore((s) => s.updateNewsSource);
  const removeNewsSource = useDashboardStore((s) => s.removeNewsSource);

  const [addingSource, setAddingSource] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftKind, setDraftKind] = useState<NewsSourceKind>("rss");

  const submitSource = () => {
    const label = draftLabel.trim();
    const url = draftUrl.trim();
    if (!label || !url) return;
    addNewsSource({ label, url, kind: draftKind, enabled: true });
    setDraftLabel("");
    setDraftUrl("");
    setDraftKind("rss");
    setAddingSource(false);
  };

  return createPortal(
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <h4>{t("dashboard.manage.sections.sources")}</h4>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="dialog__body">
          <div className="manage-section__head">
            <button
              type="button"
              className={`btn btn-sm source-add-toggle ${addingSource ? "btn-ghost is-cancel" : "btn-primary"}`}
              onClick={() => setAddingSource((v) => !v)}
            >
              <span className="source-add-toggle__icon" aria-hidden="true">
                {addingSource ? "×" : "+"}
              </span>
              <span>
                {addingSource
                  ? t("dashboard.manage.sources.cancel")
                  : t("dashboard.manage.sources.add")}
              </span>
            </button>
          </div>
          <ul className="manage-list">
            {newsSources.length === 0 && (
              <li className="manage-empty">
                {t("dashboard.manage.sources.empty")}
              </li>
            )}
            {newsSources.map((src) => (
              <SourceRow
                key={src.id}
                source={src}
                onToggle={(enabled) => updateNewsSource(src.id, { enabled })}
                onRemove={() => removeNewsSource(src.id)}
              />
            ))}
          </ul>
          {addingSource && (
            <div className="source-add-form">
              <label className="form-row form-row--inline">
                <span>{t("dashboard.manage.sources.kind")}</span>
                <select
                  value={draftKind}
                  onChange={(e) =>
                    setDraftKind(e.target.value as NewsSourceKind)
                  }
                >
                  <option value="rss">
                    {t("dashboard.manage.sources.kindRss")}
                  </option>
                  <option value="se-api">
                    {t("dashboard.manage.sources.kindSeApi")}
                  </option>
                </select>
              </label>
              <label className="form-row form-row--inline">
                <span>{t("dashboard.manage.sources.label")}</span>
                <input
                  value={draftLabel}
                  onChange={(e) => setDraftLabel(e.target.value)}
                  placeholder={t("dashboard.manage.sources.labelPh")}
                />
              </label>
              <label className="form-row form-row--inline">
                <span>{t("dashboard.manage.sources.url")}</span>
                <input
                  value={draftUrl}
                  onChange={(e) => setDraftUrl(e.target.value)}
                  placeholder="https://example.com/feed"
                />
              </label>
              <div className="source-add-form__actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAddingSource(false)}
                >
                  {t("dashboard.manage.sources.cancel")}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={submitSource}
                  disabled={!draftLabel.trim() || !draftUrl.trim()}
                >
                  {t("dashboard.manage.sources.save")}
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="dialog__footer">
          <button className="btn btn-primary" onClick={onClose}>
            {t("dashboard.manage.done")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SourceRow({
  source,
  onToggle,
  onRemove,
}: {
  source: NewsSource;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const kindLabel =
    source.kind === "rss"
      ? t("dashboard.manage.sources.kindRss")
      : t("dashboard.manage.sources.kindSeApi");
  return (
    <li>
      <div className="source-row">
        <label className="source-row__main">
          <input
            type="checkbox"
            checked={source.enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <div className="source-row__text">
            <span className="source-row__label">{source.label}</span>
            <span className="source-row__url" title={source.url}>
              {source.url}
            </span>
            <span className="source-row__kind">{kindLabel}</span>
          </div>
        </label>
        <button
          className="btn btn-ghost btn-sm source-row__remove"
          onClick={onRemove}
          aria-label={t("dashboard.manage.sources.remove")}
          title={t("dashboard.manage.sources.remove")}
        >
          ×
        </button>
      </div>
    </li>
  );
}
