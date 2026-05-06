import { invoke } from "@tauri-apps/api/core";
import type { OrgAuth } from "../store/org";

export const tauriApi = {
  syncOrgs: () => invoke<OrgAuth[]>("sync_orgs"),
  listOrgs: () => invoke<OrgAuth[]>("list_orgs"),
  setDefaultOrg: (username: string) => invoke<void>("set_default_org", { username }),
  logoutOrg: (username: string) => invoke<void>("logout_org", { username }),
  loginOrg: () => invoke<void>("login_org"),
};
