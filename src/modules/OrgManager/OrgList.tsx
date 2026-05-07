import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tauriApi, type LoginDomain } from "../../lib/tauri";
import { useOrgStore } from "../../store/org";

function IconFolder() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-10Z" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconLaunch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6H6.5A2.5 2.5 0 0 0 4 8.5v9A2.5 2.5 0 0 0 6.5 20h9a2.5 2.5 0 0 0 2.5-2.5V15" stroke="currentColor" strokeWidth="1.7" />
      <path d="M13 5h6v6M19 5l-8.5 8.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 7h14M10 11v6M14 11v6M8 7l1-2h6l1 2M7 7v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconCompass() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m15.8 8.2-2.3 6.1-6.1 2.3 2.3-6.1 6.1-2.3Z" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function IconSwitch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 8h11m0 0-2.6-2.6M16 8l-2.6 2.6M19 16H8m0 0 2.6-2.6M8 16l2.6 2.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
                <button type="button" className="org-icon-btn" title="选择本地项目文件夹" aria-label="选择本地项目文件夹" onClick={() => void linkLocalProject(org.id)}>
                  <IconFolder />
                </button>
                <button
                  type="button"
                  className="org-icon-btn"
                  title="在本地 IDE 中打开项目"
                  aria-label="在本地 IDE 中打开项目"
                  disabled={!org.linked_project_path?.trim() || openIdeMutation.isPending}
                  onClick={() => openIdeMutation.mutate(org.id)}
                >
                  <IconLaunch />
                </button>
                <button
                  type="button"
                  className="org-icon-btn org-link-clear"
                  title="清除关联路径"
                  aria-label="清除关联路径"
                  disabled={!org.linked_project_path?.trim()}
                  onClick={() => void clearLinkedProject(org.id)}
                >
                  <IconTrash />
                </button>
              </div>
              <div className="org-manage-actions">
                <button className="org-icon-btn" title="在 Salesforce 打开 Org" aria-label="在 Salesforce 打开 Org" onClick={() => openMutation.mutate(org.id)} disabled={openMutation.isPending}>
                  <IconCompass />
                </button>
                <button className="org-icon-btn" title="切换为默认 Org" aria-label="切换为默认 Org" onClick={() => switchMutation.mutate(org.id)} disabled={switchMutation.isPending}>
                  <IconSwitch />
                </button>
                <button className="org-icon-btn danger" title="登出当前 Org" aria-label="登出当前 Org" onClick={() => logoutMutation.mutate(org.id)} disabled={logoutMutation.isPending}>
                  <IconTrash />
                </button>
              </div>
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
