import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../../i18n";
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

  return (
    <aside className="sidebar">
      <div className="sidebar-brand" title="SF DevKit">
        <span className="sidebar-brand-text">SF</span>
      </div>
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
          <div className="sidebar-settings-panel" role="dialog" aria-label={t("sidebar.settings")}>
            <div className="sidebar-settings-panel-title">{t("sidebar.settings")}</div>
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
          </div>
        ) : null}
      </div>
    </aside>
  );
}
