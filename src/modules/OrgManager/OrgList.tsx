import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { orgTypeLabel } from "../../lib/orgTypeLabel";
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
  const { t, i18n } = useTranslation();
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
  const [loginCancelling, setLoginCancelling] = useState(false);
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
      setNotice({
        text: i18n.t("orgManager.notice.openIdeError", { message }),
        autoHide: true,
        variant: "error",
      });
    },
    onSuccess: () => {
      setNotice({ text: i18n.t("orgManager.notice.openIdeSuccess"), autoHide: true, variant: "success" });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: () => tauriApi.syncOrgs(),
    onSuccess: (orgs) => {
      setOrgs(orgs);
      queryClient.setQueryData(["orgs"], orgs);
      setNotice({ text: i18n.t("orgManager.notice.listRefreshed"), autoHide: true, variant: "success" });
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      setNotice({ text: message, autoHide: true, variant: "error" });
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
      setNotice({ text: i18n.t("orgManager.notice.browserAuthSyncing"), autoHide: false, variant: "success" });
      const orgs = await tauriApi.syncOrgs();
      setOrgs(orgs);
      queryClient.setQueryData(["orgs"], orgs);
      const defaultOrg = orgs.find((org) => !!org.is_default) ?? null;
      setCurrentOrg(defaultOrg?.id ?? orgs[0]?.id ?? null);
      setNotice(
        defaultOrg
          ? {
              text: i18n.t("orgManager.notice.syncDoneDefault", {
                name: defaultOrg.alias ?? defaultOrg.id,
              }),
              autoHide: true,
              variant: "success",
            }
          : { text: i18n.t("orgManager.notice.syncDoneNoDefault"), autoHide: true, variant: "success" },
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (browserAuthDone) {
        setNotice({ text: i18n.t("orgManager.notice.syncFailed", { message }), autoHide: true, variant: "error" });
      } else {
        setLoginError(message);
      }
    } finally {
      setLoginBusy(false);
      setLoginCancelling(false);
    }
  };

  const linkLocalProject = async (orgId: string) => {
    try {
      const picked = await tauriApi.pickProjectDirectory();
      if (picked == null) return;
      await tauriApi.setOrgLinkedProjectPath(orgId, picked);
      await queryClient.invalidateQueries({ queryKey: ["orgs"] });
      setNotice({ text: i18n.t("orgManager.notice.linkedSaved"), autoHide: true, variant: "success" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice({ text: i18n.t("orgManager.notice.linkFailed", { message }), autoHide: true, variant: "error" });
    }
  };

  const clearLinkedProject = async (orgId: string) => {
    try {
      await tauriApi.setOrgLinkedProjectPath(orgId, null);
      await queryClient.invalidateQueries({ queryKey: ["orgs"] });
      setNotice({ text: i18n.t("orgManager.notice.linkCleared"), autoHide: true, variant: "success" });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setNotice({ text: i18n.t("orgManager.notice.clearFailed", { message }), autoHide: true, variant: "error" });
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

  if (isLoading) return <div className="empty-state">{t("orgManager.loading")}</div>;
  if (isError)
    return (
      <div className="empty-state error">{t("orgManager.loadError", { message: (error as Error).message })}</div>
    );

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
          placeholder={t("orgManager.searchPlaceholder")}
        />
        <button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending}>
          {refreshMutation.isPending ? t("orgManager.refreshing") : t("orgManager.refresh")}
        </button>
        <button onClick={() => setShowLoginModal(true)} disabled={loginBusy}>
          {t("orgManager.addOrg")}
        </button>
      </div>
      {showLoginModal ? (
        <div className="org-login-modal-backdrop" onClick={() => !loginBusy && setShowLoginModal(false)}>
          <div className="org-login-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="org-login-title">{t("orgManager.modalTitle")}</h3>
            <input
              type="text"
              className="org-form-input"
              value={loginAlias}
              onChange={(e) => setLoginAlias(e.target.value)}
              placeholder={t("orgManager.aliasPlaceholder")}
            />
            <select
              className="org-form-select"
              value={loginDomain}
              onChange={(e) => setLoginDomain(e.target.value as LoginDomain)}
            >
              <option value="production">{t("orgManager.domainProduction")}</option>
              <option value="sandbox">{t("orgManager.domainSandbox")}</option>
            </select>
            {loginError ? <div className="org-login-error">{loginError}</div> : null}
            <div className="org-login-modal-actions">
              <button
                onClick={async () => {
                  if (loginBusy) {
                    setLoginCancelling(true);
                    try {
                      await tauriApi.cancelLogin();
                    } catch { /* ignore */ }
                    setLoginBusy(false);
                    setLoginCancelling(false);
                  }
                  setShowLoginModal(false);
                  setLoginError(null);
                }}
              >
                {loginCancelling ? t("orgManager.cancelling") ?? "Cancelling…" : t("orgManager.cancel")}
              </button>
              <button onClick={() => void handleLoginConfirm()} disabled={loginBusy}>
                {loginBusy ? t("orgManager.loginWaitingBrowser") : t("orgManager.loginAndSetDefault")}
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
                  {org.is_default ? <span className="org-default-tag">{t("orgManager.defaultTag")}</span> : null}
                  <span className={`org-type org-type-${org.org_type}`}>{orgTypeLabel(org.org_type, t)}</span>
                </div>
                <div className="org-sub">{org.instance_url}</div>
              </div>
            </div>
            <div className="org-linked-row">
              <span className="org-linked-label">{t("orgManager.linkedProject")}</span>
              <div
                className="org-linked-path-wrap"
                title={org.linked_project_path?.trim() ? org.linked_project_path : undefined}
              >
                <span className="org-linked-path">
                  {org.linked_project_path?.trim() ? org.linked_project_path : t("orgManager.notLinked")}
                </span>
              </div>
              <div className="org-linked-actions">
                <button
                  type="button"
                  className="org-icon-btn"
                  title={t("orgManager.pickFolderTitle")}
                  aria-label={t("orgManager.pickFolderAria")}
                  onClick={() => void linkLocalProject(org.id)}
                >
                  <IconFolder />
                </button>
                <button
                  type="button"
                  className="org-icon-btn"
                  title={t("orgManager.openIdeTitle")}
                  aria-label={t("orgManager.openIdeAria")}
                  disabled={!org.linked_project_path?.trim() || openIdeMutation.isPending}
                  onClick={() => openIdeMutation.mutate(org.id)}
                >
                  <IconLaunch />
                </button>
                <button
                  type="button"
                  className="org-icon-btn org-link-clear"
                  title={t("orgManager.clearLinkTitle")}
                  aria-label={t("orgManager.clearLinkAria")}
                  disabled={!org.linked_project_path?.trim()}
                  onClick={() => void clearLinkedProject(org.id)}
                >
                  <IconTrash />
                </button>
              </div>
              <div className="org-manage-actions">
                <button
                  className="org-icon-btn"
                  title={t("orgManager.openSfTitle")}
                  aria-label={t("orgManager.openSfAria")}
                  onClick={() => openMutation.mutate(org.id)}
                  disabled={openMutation.isPending}
                >
                  <IconCompass />
                </button>
                <button
                  className="org-icon-btn"
                  title={t("orgManager.setDefaultTitle")}
                  aria-label={t("orgManager.setDefaultAria")}
                  onClick={() => switchMutation.mutate(org.id)}
                  disabled={switchMutation.isPending}
                >
                  <IconSwitch />
                </button>
                <button
                  className="org-icon-btn danger"
                  title={t("orgManager.logoutTitle")}
                  aria-label={t("orgManager.logoutAria")}
                  onClick={() => logoutMutation.mutate(org.id)}
                  disabled={logoutMutation.isPending}
                >
                  <IconTrash />
                </button>
              </div>
            </div>
          </article>
        ))
      ) : (
        <div className="empty-state">
          {keyword.trim()
            ? t("orgManager.emptyNoMatch")
            : t("orgManager.emptyNoOrgs", { action: t("orgManager.addOrg") })}
        </div>
      )}
    </div>
  );
}
