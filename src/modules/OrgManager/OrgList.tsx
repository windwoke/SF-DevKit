import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { orgTypeLabel } from "../../lib/orgTypeLabel";
import { isAlibabaInstance } from "../../lib/isAlibabaInstance";
import { tauriApi } from "../../lib/tauri";
import { OrgLoginDialog } from "./OrgLoginDialog";
import { JwtKeyWizard } from "./JwtKeyWizard";
import type { JwtKeyRoute } from "./JwtSetupGuide";
import { authMethodKey, loginErrorKey, loginFormValid, loginRequest, newLoginForm, reauthorizeForm } from "./loginForm";
import { useOrgStore, type OrgAuth } from "../../store/org";

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

function IconReauthorize() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19 8.5V5m0 0h-3.5M19 5l-4 4a6.5 6.5 0 1 0 1.7 5.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheckStatus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m7 10 2 2 4-4m2 7 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type ConnectionKind = "connected" | "expired" | "unreachable" | "unknown";

function getConnectionKind(org: { connection_status: string; expires_at: string | null; org_type: string }): ConnectionKind {
  const expiresAt = org.expires_at ? Date.parse(org.expires_at) : Number.NaN;
  if (org.org_type === "scratch" && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    return "expired";
  }

  const status = org.connection_status.trim().toLowerCase();
  if (status === "connected") return "connected";
  if (!status || status === "unknown") return "unknown";
  if (/(expired|invalid|refresh token|inactive organization)/.test(status)) return "expired";
  return "unreachable";
}

export function OrgList() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { setCurrentOrg, setOrgs, updateOrg } = useOrgStore();
  const [keyword, setKeyword] = useState("");
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [keyWizardRoute, setKeyWizardRoute] = useState<JwtKeyRoute | null>(null);
  const [loginForm, setLoginForm] = useState(newLoginForm);
  const [loadingLoginProfile, setLoadingLoginProfile] = useState(false);
  const loginCancelled = useRef(false);
  const [notice, setNotice] = useState<{
    text: string;
    autoHide: boolean;
    variant?: "success" | "error";
  } | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginCancelling, setLoginCancelling] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [editingAliasFor, setEditingAliasFor] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [reauthorizingOrg, setReauthorizingOrg] = useState<OrgAuth | null>(null);

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

  const checkStatusMutation = useMutation({
    mutationFn: (username: string) => tauriApi.checkOrgLoginStatus(username),
    onSuccess: (org) => {
      queryClient.setQueryData<OrgAuth[]>(["orgs"], (orgs) => orgs?.map((item) => item.id === org.id ? org : item));
      updateOrg(org);
      const status = getConnectionKind(org);
      setNotice({
        text: i18n.t(`orgManager.notice.statusCheck.${status}`, { name: org.alias ?? org.id }),
        autoHide: true,
        variant: status === "connected" ? "success" : "error",
      });
    },
    onError: (error) => {
      const code = error instanceof Error ? error.message : String(error);
      setNotice({ text: i18n.t(code === "ORG_CHECK_CLI_MISSING" ? "orgManager.loginErrors.cliMissing" : "orgManager.notice.statusCheckFailed"), autoHide: true, variant: "error" });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: (username: string) => tauriApi.logoutOrg(username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orgs"] });
    },
  });

  const updateAliasMutation = useMutation({
    mutationFn: ({ username, alias }: { username: string; alias: string }) => tauriApi.updateOrgAlias(username, alias),
    onSuccess: async () => {
      setEditingAliasFor(null);
      await queryClient.invalidateQueries({ queryKey: ["orgs"] });
      setNotice({ text: i18n.t("orgManager.notice.aliasSaved"), autoHide: true, variant: "success" });
    },
    onError: (e) => {
      const message = e instanceof Error ? e.message : String(e);
      setNotice({ text: i18n.t("orgManager.notice.aliasSaveFailed", { message }), autoHide: true, variant: "error" });
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

  const loginMessage = (error: unknown) => {
    const raw = error instanceof Error ? error.message : String(error);
    const key = loginErrorKey(raw);
    return key ? i18n.t(key) : raw;
  };

  useEffect(() => {
    if (!showLoginModal || !reauthorizingOrg) return;
    let active = true;
    setLoadingLoginProfile(true);
    tauriApi.getOrgLoginProfile(reauthorizingOrg.id)
      .then((profile) => {
        if (active) {
          setLoginForm(reauthorizeForm(reauthorizingOrg, profile));
        }
      })
      .catch((error) => { if (active) setLoginError(loginMessage(error)); })
      .finally(() => { if (active) setLoadingLoginProfile(false); });
    return () => { active = false; };
  }, [showLoginModal, reauthorizingOrg]);

  const closeLogin = () => {
    setKeyWizardRoute(null);
    setShowLoginModal(false);
    setReauthorizingOrg(null);
    setLoginForm(newLoginForm());
    setLoginError(null);
    setLoadingLoginProfile(false);
  };

  const handleLoginCancel = async () => {
    if (loginBusy) {
      loginCancelled.current = true;
      setLoginCancelling(true);
      try {
        await tauriApi.cancelLogin();
      } catch (error) {
        loginCancelled.current = false;
        setLoginError(loginMessage(error));
        setLoginCancelling(false);
        return;
      }
      setLoginCancelling(false);
    }
    closeLogin();
  };

  const handlePickJwtKey = async () => {
    try {
      const keyFile = await tauriApi.pickJwtKeyFile();
      if (keyFile) setLoginForm((form) => ({ ...form, keyFile }));
    } catch (error) {
      setLoginError(loginMessage(error));
    }
  };

  const handleLoginConfirm = async () => {
    if (loginBusy || loadingLoginProfile || !loginFormValid(loginForm)) return;
    setLoginError(null);
    setLoginBusy(true);
    loginCancelled.current = false;
    let authDone = false;
    const reauthorizing = Boolean(reauthorizingOrg);
    try {
      const request = loginRequest(loginForm, reauthorizing);
      if (reauthorizingOrg) {
        await tauriApi.reauthorizeOrg(reauthorizingOrg.id, request);
      } else {
        await tauriApi.loginOrg(request);
      }
      authDone = true;
      closeLogin();
      setNotice({ text: i18n.t("orgManager.notice.authSyncing"), autoHide: false, variant: "success" });
      const orgs = await tauriApi.syncOrgs();
      setOrgs(orgs);
      queryClient.setQueryData(["orgs"], orgs);
      const defaultOrg = orgs.find((org) => !!org.is_default) ?? null;
      setCurrentOrg(defaultOrg?.id ?? orgs[0]?.id ?? null);
      setNotice({
        text: reauthorizing ? i18n.t("orgManager.notice.reauthorizeDone")
          : defaultOrg ? i18n.t("orgManager.notice.syncDoneDefault", { name: defaultOrg.alias ?? defaultOrg.id })
          : i18n.t("orgManager.notice.syncDoneNoDefault"),
        autoHide: true, variant: "success",
      });
    } catch (error) {
      if (!loginCancelled.current) {
        const message = loginMessage(error);
        if (authDone) {
          setNotice({ text: i18n.t("orgManager.notice.syncFailed", { message }), autoHide: true, variant: "error" });
        } else {
          setLoginError(message);
        }
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

  const beginAliasEdit = (orgId: string, alias: string | null) => {
    setEditingAliasFor(orgId);
    setAliasDraft(alias ?? "");
  };

  const saveAlias = (orgId: string) => {
    const alias = aliasDraft.trim();
    if (!alias) {
      setNotice({ text: i18n.t("orgManager.aliasRequired"), autoHide: true, variant: "error" });
      return;
    }
    updateAliasMutation.mutate({ username: orgId, alias });
  };

  const beginReauthorize = (org: OrgAuth) => {
    setReauthorizingOrg(org);
    setLoginForm(reauthorizeForm(org));
    setLoadingLoginProfile(true);
    setLoginError(null);
    setShowLoginModal(true);
  };

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
        <button onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending || checkStatusMutation.isPending}>
          {refreshMutation.isPending ? t("orgManager.refreshing") : t("orgManager.refresh")}
        </button>
        <button
          onClick={() => {
            setReauthorizingOrg(null);
            setLoginForm(newLoginForm());
            setLoginError(null);
            setLoadingLoginProfile(false);
            setShowLoginModal(true);
          }}
          disabled={loginBusy}
        >
          {t("orgManager.addOrg")}
        </button>
      </div>
      {showLoginModal && !keyWizardRoute && (
        <OrgLoginDialog
          form={loginForm}
          reauthorizing={Boolean(reauthorizingOrg)}
          busy={loginBusy}
          cancelling={loginCancelling}
          loadingProfile={loadingLoginProfile}
          error={loginError}
          onChange={setLoginForm}
          onSubmit={() => void handleLoginConfirm()}
          onCancel={() => void handleLoginCancel()}
          onPickKey={() => void handlePickJwtKey()}
          onPrepareKey={setKeyWizardRoute}
        />
      )}
      {showLoginModal && keyWizardRoute && <JwtKeyWizard
        route={keyWizardRoute}
        alibaba={loginForm.domain === "alibaba"}
        onClose={() => setKeyWizardRoute(null)}
        onComplete={(material) => {
          setLoginForm((form) => ({ ...form, keyFile: material.keyFile }));
          setLoginError(null);
          setKeyWizardRoute(null);
        }}
      />}
      {filteredOrgs.length > 0 ? (
        filteredOrgs.map((org) => (
          <article className="org-card" key={org.id}>
            <div className="org-card-top">
              <div className="org-name-block">
                <div className="org-name">
                  {editingAliasFor === org.id ? (
                    <form
                      className="org-alias-editor"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveAlias(org.id);
                      }}
                    >
                      <input
                        autoFocus
                        aria-label={t("orgManager.editAliasAria")}
                        className="org-alias-input"
                        value={aliasDraft}
                        onChange={(event) => setAliasDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setEditingAliasFor(null);
                          }
                        }}
                        disabled={updateAliasMutation.isPending}
                      />
                      <button type="submit" className="org-alias-save" disabled={updateAliasMutation.isPending}>
                        {t("orgManager.saveAlias")}
                      </button>
                      <button
                        type="button"
                        className="org-alias-cancel"
                        onClick={() => setEditingAliasFor(null)}
                        disabled={updateAliasMutation.isPending}
                      >
                        {t("orgManager.cancel")}
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="org-alias-trigger"
                      title={t("orgManager.editAliasTitle")}
                      onClick={() => beginAliasEdit(org.id, org.alias)}
                    >
                      {org.alias ?? org.id}
                    </button>
                  )}
                  {org.is_default ? <span className="org-default-tag">{t("orgManager.defaultTag")}</span> : null}
                  <span className={`org-type org-type-${org.org_type}`}>{orgTypeLabel(org.org_type, t)}</span>
                  {isAlibabaInstance(org.instance_url) ? <span className="org-type org-type-alibaba">{t("orgManager.alibabaTag")}</span> : null}
                  <span className="org-auth-method" title={t("orgManager.authMethodDisplay", { method: t(authMethodKey(org.auth_method)) })}>
                    {t(org.auth_method === "web" ? "orgManager.authOauth" : authMethodKey(org.auth_method))}
                  </span>
                  <span
                    className={`org-connection-status org-connection-${getConnectionKind(org)}`}
                    title={org.connection_status}
                  >
                    {checkStatusMutation.isPending && checkStatusMutation.variables === org.id
                      ? t("orgManager.checkingLoginStatus")
                      : t(`orgManager.connectionStatus.${getConnectionKind(org)}`)}
                  </span>
                </div>
                <div className="org-username" title={org.id}>{org.id}</div>
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
                {getConnectionKind(org) === "expired" ? (
                  <button
                    className="org-icon-btn org-reauthorize-btn"
                    title={t("orgManager.reauthorizeTitle")}
                    aria-label={t("orgManager.reauthorizeAria")}
                    onClick={() => beginReauthorize(org)}
                    disabled={loginBusy || loadingLoginProfile || checkStatusMutation.isPending}
                  >
                    <IconReauthorize />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="org-icon-btn"
                    title={t(checkStatusMutation.isPending && checkStatusMutation.variables === org.id ? "orgManager.checkingLoginStatus" : "orgManager.checkLoginStatus")}
                    aria-label={t("orgManager.checkLoginStatus")}
                    aria-busy={checkStatusMutation.isPending && checkStatusMutation.variables === org.id}
                    disabled={checkStatusMutation.isPending || loginBusy || loadingLoginProfile || refreshMutation.isPending}
                    onClick={() => checkStatusMutation.mutate(org.id)}
                  >
                    <IconCheckStatus />
                  </button>
                )}
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
