import { useEffect } from "react";
import { Sidebar } from "./components/Layout/Sidebar";
import { TopBar } from "./components/Layout/TopBar";
import { ComingSoon } from "./modules/ComingSoon";
import { Deployer } from "./modules/Deployer";
import { LogViewer } from "./modules/LogViewer";
import { MetadataBrowser } from "./modules/MetadataBrowser";
import { OrgManager } from "./modules/OrgManager";
import { SoqlEditor } from "./modules/SoqlEditor";
import { useUiStore, type ModuleId } from "./store/ui";
import { useTranslation } from "react-i18next";

export default function App() {
  const { t } = useTranslation();
  const { activeModule, setActiveModule } = useUiStore();
  const moduleRegistry: Array<{ id: ModuleId; label: string; render: () => JSX.Element }> = [
    { id: "orgs", label: t("modules.orgs"), render: OrgManager },
    { id: "soql", label: t("modules.soql"), render: SoqlEditor },
    { id: "metadata", label: t("modules.metadata"), render: MetadataBrowser },
    {
      id: "deployer",
      label: t("modules.deployer"),
      render: Deployer,
    },
    {
      id: "logs",
      label: t("modules.logs"),
      render: LogViewer,
    },
    {
      id: "apex",
      label: t("modules.apex"),
      render: () => (
        <ComingSoon
          title={t("modules.apex")}
          summary={t("comingSoon.apex.summary")}
          bullets={t("comingSoon.apex.bullets", { returnObjects: true }) as string[]}
        />
      ),
    },
  ];
  // Keyboard shortcuts: Cmd/Ctrl + 1..6 to switch modules
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const idx = Number(e.key) - 1; // "1" → 0, "2" → 1, ...
      if (idx >= 0 && idx < moduleRegistry.length) {
        setActiveModule(moduleRegistry[idx].id);
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const active = moduleRegistry.find((m) => m.id === activeModule) ?? moduleRegistry[0];
  const ActiveComponent = active.render;

  return (
    <div className="app-shell">
      <TopBar moduleName={active.label} />
      <div className="app-body">
        <Sidebar modules={moduleRegistry} active={activeModule} onSelect={setActiveModule} />
        <main className="main-panel">
          <ActiveComponent />
        </main>
      </div>
    </div>
  );
}
