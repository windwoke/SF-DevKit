import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../../i18n";
import { useSettingsStore, type DiffTool } from "../../store/settings";
import type { ModuleId } from "../../store/ui";
import { IconSettingsNav, SidebarModuleIcon } from "./SidebarIcons";

interface ModuleItem {
  id: ModuleId;
  label: string;
}

interface SidebarProps {
  modules: ModuleItem[];
  active: ModuleId;
  onSelect: (moduleId: ModuleId) => void;
}

export function Sidebar({ modules, active, onSelect }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsWrapRef = useRef<HTMLDivElement>(null);
  const {
    diffTool,
    diffToolPath,
    diffCustomCommand,
    setDiffTool,
    setDiffToolPath,
    setDiffCustomCommand,
  } = useSettingsStore();

  useEffect(() => {
    if (!settingsOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const el = settingsWrapRef.current;
      if (!el || el.contains(e.target as Node)) return;
      setSettingsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);

  const diffToolOptions: { value: DiffTool; label: string }[] = [
    { value: "vscode", label: "VSCode" },
    { value: "beyond_compare", label: "Beyond Compare" },
    { value: "custom", label: t("settings.custom") },
  ];

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav" aria-label={t("sidebar.mainNav")}>
        {modules.map((m) => (
          <button
            key={m.id}
            type="button"
            className={m.id === active ? "nav-item active" : "nav-item"}
            aria-label={m.label}
            title={m.label}
            aria-current={m.id === active ? "page" : undefined}
            onClick={() => onSelect(m.id)}
          >
            <SidebarModuleIcon id={m.id} />
          </button>
        ))}
      </nav>
      <div className="sidebar-settings-wrap" ref={settingsWrapRef}>
        <button
          type="button"
          className={`nav-item sidebar-settings-btn${settingsOpen ? " active" : ""}`}
          aria-label={t("sidebar.settingsAria")}
          title={t("sidebar.settings")}
          aria-expanded={settingsOpen}
          aria-haspopup="dialog"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <IconSettingsNav />
        </button>
        {settingsOpen ? (
          <div
            className="sidebar-settings-panel"
            role="dialog"
            aria-label={t("sidebar.settings")}
          >
            <div className="sidebar-settings-panel-title">
              {t("sidebar.settings")}
            </div>

            {/* Language */}
            <label className="sidebar-settings-lang">
              <span>{t("topbar.language")}</span>
              <select
                value={i18n.language.startsWith("zh") ? "zh-CN" : "en-US"}
                onChange={(e) => void i18n.changeLanguage(e.target.value)}
              >
                {SUPPORTED_LANGUAGES.map((lng) => (
                  <option key={lng} value={lng}>
                    {t(`language.${lng}`)}
                  </option>
                ))}
              </select>
            </label>

            {/* Diff Tool */}
            <div className="sidebar-settings-divider" />
            <div className="sidebar-settings-section-title">
              {t("settings.diffTool")}
            </div>
            <div className="sidebar-settings-diff-options">
              {diffToolOptions.map((opt) => (
                <label key={opt.value} className="sidebar-settings-radio">
                  <input
                    type="radio"
                    name="diffTool"
                    checked={diffTool === opt.value}
                    onChange={() => setDiffTool(opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>

            {diffTool === "vscode" && (
              <label className="sidebar-settings-field">
                <span>{t("settings.path")}</span>
                <input
                  value={diffToolPath}
                  onChange={(e) => setDiffToolPath(e.target.value)}
                  placeholder="code (auto-detect)"
                />
              </label>
            )}

            {diffTool === "beyond_compare" && (
              <label className="sidebar-settings-field">
                <span>{t("settings.path")}</span>
                <input
                  value={diffToolPath}
                  onChange={(e) => setDiffToolPath(e.target.value)}
                  placeholder="bcompare (auto-detect)"
                />
              </label>
            )}

            {diffTool === "custom" && (
              <label className="sidebar-settings-field">
                <span>{t("settings.command")}</span>
                <input
                  value={diffCustomCommand}
                  onChange={(e) => setDiffCustomCommand(e.target.value)}
                  placeholder={'bcompare "{working}" "{reference}"'}
                />
                <span className="sidebar-settings-hint">
                  {t("settings.commandHint")}
                </span>
              </label>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
