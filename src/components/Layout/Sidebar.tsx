import type { ModuleId } from "../../store/ui";
import { SidebarModuleIcon } from "./SidebarIcons";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
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
    </aside>
  );
}
