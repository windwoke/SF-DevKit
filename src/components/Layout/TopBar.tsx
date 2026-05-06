import { useOrgStore } from "../../store/org";
import { tauriApi } from "../../lib/tauri";
import { useMutation } from "@tanstack/react-query";

export function TopBar() {
  const { currentOrg, orgs } = useOrgStore();
  const org = orgs.find((o) => o.id === currentOrg);
  const openMutation = useMutation({
    mutationFn: (username: string) => tauriApi.openOrg(username),
  });

  return (
    <header className="topbar">
      <div>当前模块：开发工具台</div>
      <div className="topbar-right">
        <div>{org ? `当前 Org: ${org.alias ?? org.id}` : "当前 Org: 未选择"}</div>
        <button
          className="topbar-open-btn"
          onClick={() => org && openMutation.mutate(org.id)}
          disabled={!org || openMutation.isPending}
        >
          {openMutation.isPending ? "Opening..." : "Open"}
        </button>
      </div>
    </header>
  );
}
