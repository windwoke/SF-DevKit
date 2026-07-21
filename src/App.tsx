import { useEffect } from "react";
import { Sidebar } from "./components/Layout/Sidebar";
import { TopBar } from "./components/Layout/TopBar";
import { ApexRunner } from "./modules/ApexRunner";
import { Deployer } from "./modules/Deployer";
import { HomeDashboard } from "./modules/HomeDashboard";
import { LogViewer } from "./modules/LogViewer";
import { MetadataBrowser } from "./modules/MetadataBrowser";
import { OrgManager } from "./modules/OrgManager";
import { SoqlEditor } from "./modules/SoqlEditor";
import { useUiStore, type ModuleId } from "./store/ui";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import { tauriApi, type TrayLabels } from "./lib/tauri";

export default function App() {
  const { t } = useTranslation();
  const { activeModule, setActiveModule } = useUiStore();
  const moduleRegistry: Array<{ id: ModuleId; label: string; render: () => JSX.Element }> = [
    { id: "home", label: t("modules.home"), render: HomeDashboard },
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
    { id: "apex", label: t("modules.apex"), render: ApexRunner },
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

  // Push localized tray strings to the Rust side on mount and whenever the
  // i18n locale changes. macOS-only on the backend; no-op elsewhere.
  useEffect(() => {
    const pushTrayLabels = () => {
      const labels: TrayLabels = {
        openOrgsLabel: t("tray.openOrgsLabel"),
        defaultLabelTemplate: t("tray.defaultLabelTemplate"),
        noDefault: t("tray.noDefault"),
        noOrgs: t("tray.noOrgs"),
        showMain: t("tray.showMain"),
        refresh: t("tray.refresh"),
        quit: t("tray.quit"),
        tooltip: t("tray.tooltip"),
      };
      void tauriApi.updateTrayLabels(labels).catch((err) => {
        console.warn("[tray] update_tray_labels failed", err);
      });
    };
    pushTrayLabels();
    const handler = () => pushTrayLabels();
    i18n.on("languageChanged", handler);
    return () => {
      i18n.off("languageChanged", handler);
    };
  }, [t]);

  const active = moduleRegistry.find((m) => m.id === activeModule) ?? moduleRegistry[0];

  return (
    <div className="app-shell">
      <TopBar moduleName={active.label} />
      <div className="app-body">
        <Sidebar modules={moduleRegistry} active={activeModule} onSelect={setActiveModule} />
        <main className="main-panel">
          {moduleRegistry.map((m) => {
            const Component = m.render;
            return (
              <div key={m.id} style={{ display: m.id === activeModule ? undefined : "none", height: "100%" }}>
                <Component />
              </div>
            );
          })}
        </main>
      </div>
    </div>
  );
}
