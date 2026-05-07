import { Sidebar } from "./components/Layout/Sidebar";
import { TopBar } from "./components/Layout/TopBar";
import { ComingSoon } from "./modules/ComingSoon";
import { MetadataBrowser } from "./modules/MetadataBrowser";
import { OrgManager } from "./modules/OrgManager";
import { SoqlEditor } from "./modules/SoqlEditor";
import { useUiStore, type ModuleId } from "./store/ui";

const MODULE_REGISTRY: Array<{ id: ModuleId; label: string; render: () => JSX.Element }> = [
  { id: "orgs", label: "Org 管理", render: OrgManager },
  { id: "soql", label: "SOQL", render: SoqlEditor },
  { id: "metadata", label: "Metadata", render: MetadataBrowser },
  {
    id: "apex",
    label: "Apex Runner",
    render: () => (
      <ComingSoon
        title="Apex Runner"
        summary="用于快速执行 Anonymous Apex，并展示结构化执行结果。"
        bullets={["代码编辑与快捷执行", "执行日志与错误定位", "结果历史与复用"]}
      />
    ),
  },
  {
    id: "deployer",
    label: "Deployer",
    render: () => (
      <ComingSoon
        title="Deployer"
        summary="用于本地项目部署与校验，聚焦部署效率和失败定位。"
        bullets={["Deploy / Validate 一键执行", "变更范围与部署日志追踪", "失败明细与重试"]}
      />
    ),
  },
  {
    id: "logs",
    label: "Log Viewer",
    render: () => (
      <ComingSoon
        title="Log Viewer"
        summary="用于 Debug Log 的快速追踪、过滤与上下文定位。"
        bullets={["日志列表与实时刷新", "按类别/关键字快速过滤", "异常与性能热点高亮"]}
      />
    ),
  },
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
