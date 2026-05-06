import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriApi } from "../../lib/tauri";
import { useOrgStore } from "../../store/org";

export function OrgList() {
  const queryClient = useQueryClient();
  const { setCurrentOrg, setOrgs } = useOrgStore();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["orgs"],
    queryFn: async () => {
      const orgs = await tauriApi.syncOrgs();
      setOrgs(orgs);
      return orgs;
    },
  });

  const switchMutation = useMutation({
    mutationFn: (username: string) => tauriApi.setDefaultOrg(username),
    onSuccess: (_, username) => {
      setCurrentOrg(username);
      queryClient.invalidateQueries({ queryKey: ["orgs"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: (username: string) => tauriApi.logoutOrg(username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgs"] });
    },
  });

  const loginMutation = useMutation({
    mutationFn: () => tauriApi.loginOrg(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orgs"] }),
  });

  if (isLoading) return <div className="empty-state">正在同步 Org 列表...</div>;
  if (isError) return <div className="empty-state error">加载失败：{(error as Error).message}</div>;

  return (
    <div className="org-list">
      <div className="org-actions">
        <button onClick={() => loginMutation.mutate()} disabled={loginMutation.isPending}>
          {loginMutation.isPending ? "登录中..." : "添加 Org"}
        </button>
      </div>
      {data && data.length > 0 ? (
        data.map((org) => (
          <article className="org-card" key={org.id}>
            <div>
              <div className="org-name">{org.alias ?? org.id}</div>
              <div className="org-sub">{org.instance_url}</div>
            </div>
            <div className="org-type">{org.org_type}</div>
            <div className="org-buttons">
              <button onClick={() => switchMutation.mutate(org.id)} disabled={switchMutation.isPending}>
                设为默认
              </button>
              <button className="danger" onClick={() => logoutMutation.mutate(org.id)} disabled={logoutMutation.isPending}>
                登出
              </button>
            </div>
          </article>
        ))
      ) : (
        <div className="empty-state">暂无已认证 Org，点击“添加 Org”开始登录。</div>
      )}
    </div>
  );
}
