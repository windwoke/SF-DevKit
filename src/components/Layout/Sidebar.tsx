import type { ModuleId } from "../../store/ui";

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
  return (
    <aside className="sidebar">
      <h1 className="sidebar-title">SF DevKit</h1>
      <nav className="sidebar-nav">
        {modules.map((m) => (
          <button
            key={m.id}
            className={m.id === active ? "nav-item active" : "nav-item"}
            onClick={() => onSelect(m.id)}
          >
            {m.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
