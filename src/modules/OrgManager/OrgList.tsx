import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriApi, type LoginDomain } from "../../lib/tauri";
import { useOrgStore } from "../../store/org";

export function OrgList() {
  const queryClient = useQueryClient();
  const { setCurrentOrg, setOrgs } = useOrgStore();
  const [keyword, setKeyword] = useState("");
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginAlias, setLoginAlias] = useState("");
  const [loginDomain, setLoginDomain] = useState<LoginDomain>("production");
  const [notice, setNotice] = useState<{
    text: string;
    autoHide: boolean;
    variant?: "success" | "error";
  } | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (!notice?.autoHide) return;
    const id = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(id);
  }, [notice]);

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

  const openMutation = useMutation({
    mutationFn: (username: string) => tauriApi.openOrg(username),
  });

  const openIdeMutation = useMutation({
    mutationFn: (orgId: string) => tauriApi.openOrgLinkedProjectInIde(orgId),
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      setNotice({ text: `无法在 IDE 中打开：${message}`, autoHide: true, variant: "error" });
    },
    onSuccess: () => {
      setNotice({ text: "已在 IDE 中打开关联项目。", autoHide: true, variant: "success" });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: () => tauriApi.syncOrgs(),
    onSuccess: (orgs) => {
      setOrgs(orgs);
      queryClient.setQueryData(["orgs"], orgs);
      setNotice({ text: "Org 列表已刷新。", autoHide: true, variant: "success" });
    },
  });

  const handleLoginConfirm = async () => {
    setLoginError(null);
    setLoginBusy(true);
    let browserAuthDone = false;
    try {
      await tauriApi.loginOrg({ alias: loginAlias, loginDomain });
      setShowLoginModal(false);
      setLoginAlias("");
      setLoginDomain("production");
      browserAuthDone = true;
      setNotice({ text: "浏览器授权成功，正在同步 Org 列表…", autoHide: false, variant: "success" });
      const orgs = await tauriApi.syncOrgs();
      setOrgs(orgs);
      queryClient.setQueryData(["orgs"], orgs);
      const defaultOrg = orgs.find((org) => !!org.is_default) ?? null;
      setCurrentOrg(defaultOrg?.id ?? orgs[0]?.id ?? null);
      setNotice(
        defaultOrg
          ? {
              text: `同步完成，默认 Org：${defaultOrg.alias ?? defaultOrg.id}。`,
              autoHide: true,
              variant: "success",
            }
          : { text: "同步完成，未检测到默认 Org，请手动设置。", autoHide: true, variant: "success" },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (browserAuthDone) {
        setNotice({ text: `同步失败：${message}`, autoHide: true, variant: "error" });
      } else {
        setLoginError(message);
      }
    } finally {
      setLoginBusy(false);
    }
  };

  const linkLocalProject = async (orgId: string) => {
    try {
      const picked = await tauriApi.pickProjectDirectory();
      if (picked == null) return;
      await tauriApi.setOrgLinkedProjectPath(orgId, picked);
      await queryClient.invalidateQueries({ queryKey: ["orgs"] });
      setNotice({ text: "已保存本地项目路径。", autoHide: true, variant: "success" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice({ text: `关联路径失败：${message}`, autoHide: true, variant: "error" });
    }
  };

  const clearLinkedProject = async (orgId: string) => {
    try {
      await tauriApi.setOrgLinkedProjectPath(orgId, null);
      await queryClient.invalidateQueries({ queryKey: ["orgs"] });
      setNotice({ text: "已清除本地项目关联。", autoHide: true, variant: "success" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice({ text: `清除失败：${message}`, autoHide: true, variant: "error" });
    }
  };

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
      {notice ? (
        <div className={notice.variant === "error" ? "notice-banner notice-banner-error" : "notice-banner notice-banner-success"}>
          {notice.text}
        </div>
      ) : null}
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
        <button onClick={() => setShowLoginModal(true)} disabled={loginBusy}>
          添加 Org
        </button>
      </div>
      {showLoginModal ? (
        <div className="org-login-modal-backdrop" onClick={() => !loginBusy && setShowLoginModal(false)}>
          <div className="org-login-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="org-login-title">添加 Org</h3>
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
            {loginError ? <div className="org-login-error">{loginError}</div> : null}
            <div className="org-login-modal-actions">
              <button onClick={() => setShowLoginModal(false)} disabled={loginBusy}>
                取消
              </button>
              <button onClick={() => void handleLoginConfirm()} disabled={loginBusy}>
                {loginBusy ? "等待浏览器授权…" : "登录并设为默认"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {filteredOrgs.length > 0 ? (
        filteredOrgs.map((org) => (
          <article className="org-card" key={org.id}>
            <div className="org-card-top">
              <div className="org-name-block">
                <div className="org-name">
                  {org.alias ?? org.id}
                  {org.is_default ? <span className="org-default-tag">默认</span> : null}
                  <span className={`org-type org-type-${org.org_type}`}>{org.org_type}</span>
                </div>
                <div className="org-sub">{org.instance_url}</div>
              </div>
            </div>
            <div className="org-linked-row">
              <span className="org-linked-label">本地项目</span>
              <div
                className="org-linked-path-wrap"
                title={org.linked_project_path?.trim() ? org.linked_project_path : undefined}
              >
                <span className="org-linked-path">
                  {org.linked_project_path?.trim() ? org.linked_project_path : "未关联"}
                </span>
              </div>
              <div className="org-linked-actions">
                <button type="button" onClick={() => void linkLocalProject(org.id)}>
                  选择文件夹…
                </button>
                <button
                  type="button"
                  disabled={!org.linked_project_path?.trim() || openIdeMutation.isPending}
                  onClick={() => openIdeMutation.mutate(org.id)}
                >
                  {openIdeMutation.isPending ? "打开中…" : "在 IDE 中打开"}
                </button>
                <button
                  type="button"
                  className="org-link-clear"
                  disabled={!org.linked_project_path?.trim()}
                  onClick={() => void clearLinkedProject(org.id)}
                >
                  清除
                </button>
              </div>
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
