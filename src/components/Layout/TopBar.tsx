import { useOrgStore } from "../../store/org";

export function TopBar() {
  const { currentOrg, orgs } = useOrgStore();
  const org = orgs.find((o) => o.id === currentOrg);

  return (
    <header className="topbar">
      <div>当前模块：开发工具台</div>
      <div>{org ? `当前 Org: ${org.alias ?? org.id}` : "当前 Org: 未选择"}</div>
    </header>
  );
}
