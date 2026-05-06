import { invoke } from "@tauri-apps/api/core";
import type { OrgAuth } from "../store/org";

export type LoginDomain = "production" | "sandbox";

export const tauriApi = {
  syncOrgs: () => invoke<OrgAuth[]>("sync_orgs"),
  listOrgs: () => invoke<OrgAuth[]>("list_orgs"),
  setDefaultOrg: (username: string) => invoke<void>("set_default_org", { username }),
  logoutOrg: (username: string) => invoke<void>("logout_org", { username }),
  /** Web OAuth only; call `syncOrgs` afterward to refresh the local list. */
  loginOrg: (payload: { alias?: string; loginDomain: LoginDomain }) =>
    invoke<void>("login_org", {
      alias: payload.alias?.trim() || null,
      login_domain: payload.loginDomain,
    }),
  openOrg: (username: string) => invoke<void>("open_org", { username }),
};
