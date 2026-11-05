import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInstance } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en-US.json";
import zh from "../../i18n/locales/zh-CN.json";
import { mergeAuthorizedOrg, useOrgStore, type OrgAuth } from "../../store/org";
import { OrgList } from "./OrgList";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("incremental org authorization", () => {
  const account = (id: string, alias: string, is_default = false): OrgAuth => ({
    id, alias, is_default, instance_url: "https://demo.my.salesforce.com",
    org_type: "production", auth_method: "web", expires_at: null,
    connection_status: "Connected", last_used: null, linked_project_path: null,
  });

  it("inserts a non-default org in order and preserves the selected org and other records", () => {
    const existing = account("existing@example.com", "Zulu", true);
    const selected = account("selected@example.com", "Alpha");
    const added = account("new@example.com", "Beta");
    useOrgStore.setState({ orgs: [existing, selected], currentOrg: selected.id });
    useOrgStore.getState().upsertOrg(added);
    const state = useOrgStore.getState();
    expect(state.currentOrg).toBe(selected.id);
    expect(state.orgs).toEqual([existing, selected, added]);
    expect(state.orgs[0]).toBe(existing);
    expect(state.orgs[1]).toBe(selected);
    expect(mergeAuthorizedOrg([existing, selected], added)).toEqual(state.orgs);
    useOrgStore.setState({ orgs: [], currentOrg: null });
  });

  it("changes only the previous default flag when the new org is set as default", () => {
    const previous = account("previous@example.com", "Previous", true);
    const other = account("other@example.com", "Other");
    const added = account("new@example.com", "New", true);
    useOrgStore.setState({ orgs: [previous, other], currentOrg: other.id });
    useOrgStore.getState().upsertOrg(added, true);
    expect(useOrgStore.getState().currentOrg).toBe(added.id);
    expect(useOrgStore.getState().orgs[0]).toBe(added);
    expect(useOrgStore.getState().orgs.find((org) => org.id === previous.id)).toEqual({ ...previous, is_default: false });
    expect(useOrgStore.getState().orgs.find((org) => org.id === other.id)).toBe(other);
    useOrgStore.setState({ orgs: [], currentOrg: null });
  });

  it("replaces a reauthorized account without duplicates or switching the selected org", () => {
    const current = account("current@example.com", "Current");
    const previous = account("previous@example.com", "Previous", true);
    const renewed = { ...previous, auth_method: "jwt" as const };
    useOrgStore.setState({ orgs: [previous, current], currentOrg: current.id });
    useOrgStore.getState().upsertOrg(renewed);
    expect(useOrgStore.getState().orgs).toEqual([renewed, current]);
    expect(useOrgStore.getState().currentOrg).toBe(current.id);
    useOrgStore.setState({ orgs: [], currentOrg: null });
    useOrgStore.getState().upsertOrg(current);
    expect(useOrgStore.getState().currentOrg).toBe(current.id);
    useOrgStore.setState({ orgs: [], currentOrg: null });
  });
});

describe("org authorization badges", () => {
  it("shows the current method in both languages with one card per account", () => {
    for (const language of ["zh-CN", "en-US"]) {
      const client = new QueryClient();
      const orgs: OrgAuth[] = (["jwt", "web", "token", "unknown"] as const).map((auth_method) => ({
        id: `${auth_method}@example.com`, alias: auth_method,
        instance_url: "https://demo.my.salesforce.com", org_type: "production",
        auth_method, is_default: false, expires_at: null, connection_status: "Connected",
        last_used: null, linked_project_path: null,
      }));
      client.setQueryData(["orgs"], orgs);
      const i18n = createInstance();
      void i18n.init({ lng: language, initAsync: false, resources: {
        "en-US": { translation: en }, "zh-CN": { translation: zh },
      } });
      const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}><OrgList /></QueryClientProvider>
      </I18nextProvider>);
      expect(html.match(/class="org-card"/g)).toHaveLength(4);
      expect(html.match(/class="org-auth-method"/g)).toHaveLength(4);
      expect(html).toContain(language === "zh-CN" ? "授权方式：JWT" : "Auth: JWT");
      expect(html).toContain(language === "zh-CN" ? "授权方式：浏览器 OAuth" : "Auth: Browser OAuth");
      expect(html).toMatch(/class="org-auth-method"[^>]*>JWT<\/span>/);
      expect(html).toMatch(/class="org-auth-method"[^>]*>Oauth<\/span>/);
      expect(html).not.toContain("orgManager.authMethods.");
      client.clear();
    }
  });
});

describe("per-account sign-in check", () => {
  it("offers a check for valid, unknown and unreachable accounts and reauthorization for expired accounts", () => {
    for (const language of ["zh-CN", "en-US"]) {
      const client = new QueryClient();
      const orgs: OrgAuth[] = ["Connected", "Unknown", "Unreachable", "Expired"].map((connection_status) => ({
        id: `${connection_status}@example.com`, alias: connection_status,
        instance_url: "https://demo.my.salesforce.com", org_type: "production",
        auth_method: "jwt", is_default: false, expires_at: null, connection_status,
        last_used: null, linked_project_path: null,
      }));
      client.setQueryData(["orgs"], orgs);
      const i18n = createInstance();
      void i18n.init({ lng: language, initAsync: false, resources: {
        "en-US": { translation: en }, "zh-CN": { translation: zh },
      } });
      const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}><OrgList /></QueryClientProvider>
      </I18nextProvider>);
      const checkLabel = language === "zh-CN" ? "检查登录状态" : "Check sign-in status";
      const reauthLabel = language === "zh-CN" ? "重新授权此 Org" : "Reauthorize this org";
      expect(html.match(new RegExp(`aria-label="${checkLabel}"`, "g"))).toHaveLength(3);
      expect(html.match(new RegExp(`aria-label="${reauthLabel}"`, "g"))).toHaveLength(1);
      client.clear();
    }
  });

  it("updates the selected account without changing other accounts or the current org", () => {
    const org: OrgAuth = { id: "one@example.com", alias: "One", instance_url: "https://demo.my.salesforce.com",
      org_type: "production", auth_method: "jwt", is_default: false, expires_at: null,
      connection_status: "Connected", last_used: null, linked_project_path: null };
    const other = { ...org, id: "two@example.com", is_default: true };
    useOrgStore.setState({ orgs: [org, other], currentOrg: org.id });
    useOrgStore.getState().updateOrg({ ...org, connection_status: "Expired" });
    expect(useOrgStore.getState().currentOrg).toBe(org.id);
    expect(useOrgStore.getState().orgs[0].connection_status).toBe("Expired");
    expect(useOrgStore.getState().orgs[1]).toBe(other);
    useOrgStore.setState({ orgs: [], currentOrg: null });
  });

  it("invokes a single-account check without a global refresh", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { tauriApi } = await import("../../lib/tauri");
    vi.mocked(invoke).mockClear();
    await tauriApi.checkOrgLoginStatus("one@example.com");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("check_org_login_status", { username: "one@example.com" });
  });
});
