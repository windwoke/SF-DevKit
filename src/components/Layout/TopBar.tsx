import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { orgTypeLabel } from "../../lib/orgTypeLabel";
import { tauriApi } from "../../lib/tauri";
import { useOrgStore } from "../../store/org";

function IconChevron() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m4.5 10.2 3.3 3.2 7.7-7.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

export function TopBar({ moduleName }: { moduleName: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { currentOrg, orgs, setCurrentOrg, setOrgs } = useOrgStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const org = orgs.find((item) => item.id === currentOrg) ?? orgs.find((item) => item.is_default);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const openMutation = useMutation({
    mutationFn: (username: string) => tauriApi.openOrg(username),
  });
  const switchMutation = useMutation({
    mutationFn: (username: string) => tauriApi.setDefaultOrg(username),
    onSuccess: (_, username) => {
      const nextOrgs = orgs.map((item) => ({ ...item, is_default: item.id === username }));
      setOrgs(nextOrgs);
      setCurrentOrg(username);
      queryClient.setQueryData(["orgs"], nextOrgs);
      setMenuOpen(false);
    },
  });

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="topbar-module-name">{moduleName}</span>
      </div>
      <div className="topbar-right">
        <div className="topbar-org-switcher" ref={switcherRef}>
          <button
            type="button"
            className={`topbar-org-trigger${menuOpen ? " active" : ""}`}
            onClick={() => setMenuOpen((open) => !open)}
            disabled={!org}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={org ? t("topbar.switchOrgTitle") : t("topbar.noOrg")}
          >
            <span className="topbar-org-live-dot" aria-hidden="true" />
            <span className="topbar-org-copy">
              <span className="topbar-org-label">{t("topbar.activeOrg")}</span>
              <strong>{org ? org.alias ?? org.id : t("topbar.noOrg")}</strong>
            </span>
            {org ? <span className={`org-type org-type-${org.org_type}`}>{orgTypeLabel(org.org_type, t)}</span> : null}
            <span className="topbar-org-chevron"><IconChevron /></span>
          </button>

          {menuOpen ? (
            <div className="topbar-org-menu" role="menu" aria-label={t("topbar.switchOrgTitle")}>
              <div className="topbar-org-menu-heading">{t("topbar.switchOrgTitle")}</div>
              {orgs.map((item) => {
                const active = item.id === org?.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    className={`topbar-org-option${active ? " active" : ""}`}
                    disabled={switchMutation.isPending || active}
                    onClick={() => switchMutation.mutate(item.id)}
                  >
                    <span className="topbar-org-option-main">
                      <strong>{item.alias ?? item.id}</strong>
                      <span>{item.id}</span>
                    </span>
                    <span className={`org-type org-type-${item.org_type}`}>{orgTypeLabel(item.org_type, t)}</span>
                    {active ? <span className="topbar-org-selected"><IconCheck /></span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <button
          className="topbar-open-btn"
          onClick={() => org && openMutation.mutate(org.id)}
          disabled={!org || openMutation.isPending}
        >
          <IconCompass />
          <span>{openMutation.isPending ? t("topbar.opening") : t("topbar.open")}</span>
        </button>
      </div>
    </header>
  );
}
