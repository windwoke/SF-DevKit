import { create } from "zustand";

export interface OrgAuth {
  id: string;
  alias: string | null;
  instance_url: string;
  org_type: string;
  auth_method: "web" | "jwt" | "token" | "unknown";
  is_default: boolean;
  expires_at: string | null;
  connection_status: string;
  last_used: string | null;
  /** Local folder linked to this org (from SQLite). */
  linked_project_path: string | null;
}

interface OrgState {
  currentOrg: string | null;
  orgs: OrgAuth[];
  setCurrentOrg: (orgId: string | null) => void;
  setOrgs: (orgs: OrgAuth[]) => void;
  updateOrg: (org: OrgAuth) => void;
  upsertOrg: (org: OrgAuth, select?: boolean) => void;
}

export function mergeAuthorizedOrg(orgs: OrgAuth[], org: OrgAuth): OrgAuth[] {
  const next = orgs.filter((item) => item.id !== org.id).map((item) =>
    org.is_default && item.is_default ? { ...item, is_default: false } : item,
  );
  next.push(org);
  const label = (item: OrgAuth) => item.alias?.trim() || item.id;
  return next.sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default)
    || label(a).localeCompare(label(b), "en", { sensitivity: "base" })
    || a.id.localeCompare(b.id, "en", { sensitivity: "base" }));
}

export const useOrgStore = create<OrgState>((set) => ({
  currentOrg: null,
  orgs: [],
  setCurrentOrg: (orgId) => set({ currentOrg: orgId }),
  updateOrg: (org) => set((state) => ({ orgs: state.orgs.map((item) => item.id === org.id ? org : item) })),
  upsertOrg: (org, select = false) => set((state) => ({
    orgs: mergeAuthorizedOrg(state.orgs, org),
    currentOrg: select || !state.currentOrg ? org.id : state.currentOrg,
  })),
  setOrgs: (orgs) =>
    set({
      orgs,
      currentOrg: orgs.find((o) => o.is_default)?.id ?? orgs[0]?.id ?? null,
    }),
}));
