import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useDashboardStore, type QuickActionKind } from "../../store/dashboard";
import { tauriApi } from "../../lib/tauri";
import { MODULE_IDS } from "./quickActionModules";
import { EmojiPicker } from "./EmojiPicker";

interface Props {
  onClose: () => void;
}

export function AddQuickActionDialog({ onClose }: Props) {
  const { t } = useTranslation();
  const addQuickAction = useDashboardStore((s) => s.addQuickAction);

  const [kind, setKind] = useState<QuickActionKind>("module");
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("•");
  const [moduleId, setModuleId] = useState<(typeof MODULE_IDS)[number]>("soql");
  const [target, setTarget] = useState("");
  const [args, setArgs] = useState("");
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  const submit = () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) return;
    if (kind === "url" && !target.trim()) return;
    if (kind === "app" && !target.trim()) return;
    addQuickAction({
      kind,
      label: trimmedLabel,
      icon: icon.trim() || "•",
      moduleId: kind === "module" ? moduleId : undefined,
      target: kind !== "module" ? target.trim() : undefined,
      args: kind === "app" ? args.trim() || undefined : undefined,
    });
    onClose();
  };

  const handlePickApp = async () => {
    setPicking(true);
    try {
      const picked = await tauriApi.pickAppPath();
      if (picked) setTarget(picked);
    } finally {
      setPicking(false);
    }
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
          <h4>{t("dashboard.quickActions.dialog.title")}</h4>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="dialog__body">
          <label className="form-row">
            <span>{t("dashboard.quickActions.dialog.kind")}</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as QuickActionKind)}
            >
              <option value="module">
                {t("dashboard.quickActions.dialog.kindModule")}
              </option>
              <option value="url">
                {t("dashboard.quickActions.dialog.kindUrl")}
              </option>
              <option value="app">
                {t("dashboard.quickActions.dialog.kindApp")}
              </option>
            </select>
          </label>
          <label className="form-row">
            <span>{t("dashboard.quickActions.dialog.label")}</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("dashboard.quickActions.dialog.labelPh")}
            />
          </label>
          <div className="form-row">
            <span>{t("dashboard.quickActions.dialog.icon")}</span>
            <div className="icon-picker-row">
              <button
                type="button"
                className="icon-preview"
                onClick={() => setEmojiPickerOpen((v) => !v)}
                aria-label={t("dashboard.quickActions.dialog.pickIcon")}
                title={t("dashboard.quickActions.dialog.pickIcon")}
              >
                <span aria-hidden>{icon}</span>
              </button>
              {emojiPickerOpen && (
                <EmojiPicker
                  value={icon}
                  onChange={(e) => {
                    setIcon(e);
                    setEmojiPickerOpen(false);
                  }}
                />
              )}
            </div>
          </div>
          {kind === "module" && (
            <label className="form-row">
              <span>{t("dashboard.quickActions.dialog.targetModule")}</span>
              <select
                value={moduleId}
                onChange={(e) => setModuleId(e.target.value as typeof moduleId)}
              >
                {MODULE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`modules.${id}`)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "url" && (
            <label className="form-row">
              <span>{t("dashboard.quickActions.dialog.targetUrl")}</span>
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="https://developer.salesforce.com/"
              />
            </label>
          )}
          {kind === "app" && (
            <>
              <div className="form-row">
                <span>{t("dashboard.quickActions.dialog.targetApp")}</span>
                <div className="path-input-row">
                  <input
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder="/Applications/Calculator.app"
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={handlePickApp}
                    disabled={picking}
                    title={t("dashboard.quickActions.dialog.browse")}
                  >
                    {picking ? "…" : t("dashboard.quickActions.dialog.browse")}
                  </button>
                </div>
              </div>
              <label className="form-row">
                <span>{t("dashboard.quickActions.dialog.args")}</span>
                <input value={args} onChange={(e) => setArgs(e.target.value)} />
              </label>
            </>
          )}
        </div>
        <div className="dialog__footer">
          <button className="btn btn-ghost" onClick={onClose}>
            {t("dashboard.quickActions.dialog.cancel")}
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {t("dashboard.quickActions.dialog.save")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
