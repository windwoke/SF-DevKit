import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriApi, type LoginDomain } from "../../lib/tauri";
import { useOrgStore } from "../../store/org";

export function OrgList() {
  const queryClient = useQueryClient();
  const { setCurrentOrg, setOrgs } = useOrgStore();
  const [keyword, setKeyword] = useState("");
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginAlias, setLoginAlias] = useState("");
  const [loginDomain, setLoginDomain] = useState<LoginDomain>("production");
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["orgs"],
    queryFn: async () => {
      const orgs = await tauriApi.listOrgs();
      setOrgs(orgs);
      return orgs;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
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
    mutationFn: (payload: { alias?: string; loginDomain: LoginDomain }) => tauriApi.loginOrg(payload),
    onSuccess: (orgs) => {
      setOrgs(orgs);
      queryClient.setQueryData(["orgs"], orgs);
      setCurrentOrg(orgs.find((org) => org.is_default)?.id ?? orgs[0]?.id ?? null);
      setShowLoginForm(false);
      setLoginAlias("");
      setLoginDomain("production");
      setNotice("Org 登录成功，已自动设置为默认。");
    },
  });

  const openMutation = useMutation({
    mutationFn: (username: string) => tauriApi.openOrg(username),
  });

  const refreshMutation = useMutation({
    mutationFn: () => tauriApi.syncOrgs(),
    onSuccess: (orgs) => {
      setOrgs(orgs);
      queryClient.setQueryData(["orgs"], orgs);
      setNotice("Org 列表已刷新。");
    },
  });

  const filteredOrgs = useMemo(() => {
    if (!data) return [];
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return data;
    return data.filter((org) =>
      [org.id, org.alias ?? "", org.instance_url].some((v) =>
        v.toLowerCase().includes(normalizedKeyword),
      ),
    );
  }, [data, keyword]);

  if (isLoading) return <div className="empty-state">正在同步 Org 列表...</div>;
  if (isError) return <div className="empty-state error">加载失败：{(error as Error).message}</div>;

  return (
    <div className="org-list">
      {notice ? <div className="success-banner">{notice}</div> : null}
      <div className="org-actions">
        <input
          className="org-search"
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索 Org（用户名 / 别名 / URL）"
        />
        <button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
          {refreshMutation.isPending ? "刷新中..." : "刷新"}
        </button>
        <button onClick={() => setShowLoginForm((prev) => !prev)} disabled={loginMutation.isPending}>
          {showLoginForm ? "取消添加" : "添加 Org"}
        </button>
      </div>
      {showLoginForm ? (
        <div className="org-login-form">
          <input
            type="text"
            className="org-form-input"
            value={loginAlias}
            onChange={(e) => setLoginAlias(e.target.value)}
            placeholder="Org 别名（可选）"
          />
          <select
            className="org-form-select"
            value={loginDomain}
            onChange={(e) => setLoginDomain(e.target.value as LoginDomain)}
          >
            <option value="production">正式环境（login.salesforce.com）</option>
            <option value="sandbox">测试环境（test.salesforce.com）</option>
          </select>
          <button
            onClick={() => loginMutation.mutate({ alias: loginAlias, loginDomain })}
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? "登录中..." : "登录并设为默认"}
          </button>
        </div>
      ) : null}
      {loginMutation.isError ? (
        <div className="empty-state error">登录失败：{(loginMutation.error as Error).message}</div>
      ) : null}
      {filteredOrgs.length > 0 ? (
        filteredOrgs.map((org) => (
          <article className="org-card" key={org.id}>
            <div className="org-card-top">
              <div className="org-name-block">
                <div className="org-name">
                  {org.alias ?? org.id}
                  {org.is_default ? <span className="org-default-tag">默认</span> : null}
                </div>
                <div className="org-sub">{org.instance_url}</div>
              </div>
              <div className={`org-type org-type-${org.org_type}`}>{org.org_type}</div>
            </div>
            <div className="org-buttons org-card-bottom">
              <button onClick={() => openMutation.mutate(org.id)} disabled={openMutation.isPending}>
                Open
              </button>
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
        <div className="empty-state">
          {keyword.trim()
            ? "没有匹配的 Org，请调整关键词后重试。"
            : "暂无已认证 Org，点击“添加 Org”开始登录。"}
        </div>
      )}
    </div>
  );
}
