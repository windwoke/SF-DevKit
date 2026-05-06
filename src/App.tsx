import { Sidebar } from "./components/Layout/Sidebar";
import { TopBar } from "./components/Layout/TopBar";
import { MetadataBrowser } from "./modules/MetadataBrowser";
import { OrgManager } from "./modules/OrgManager";
import { SoqlEditor } from "./modules/SoqlEditor";
import { useUiStore, type ModuleId } from "./store/ui";

const MODULE_REGISTRY: Array<{ id: ModuleId; label: string; render: () => JSX.Element }> = [
  { id: "orgs", label: "Org 管理", render: OrgManager },
  { id: "soql", label: "SOQL", render: SoqlEditor },
  { id: "metadata", label: "Metadata", render: MetadataBrowser },
];

export default function App() {
  const { activeModule, setActiveModule } = useUiStore();
  const active = MODULE_REGISTRY.find((m) => m.id === activeModule) ?? MODULE_REGISTRY[0];
  const ActiveComponent = active.render;

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        <Sidebar modules={MODULE_REGISTRY} active={activeModule} onSelect={setActiveModule} />
        <main className="main-panel">
          <ActiveComponent />
        </main>
      </div>
    </div>
  );
}
