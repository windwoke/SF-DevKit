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
}

export const useOrgStore = create<OrgState>((set) => ({
  currentOrg: null,
  orgs: [],
  setCurrentOrg: (orgId) => set({ currentOrg: orgId }),
  updateOrg: (org) => set((state) => ({ orgs: state.orgs.map((item) => item.id === org.id ? org : item) })),
  setOrgs: (orgs) =>
    set({
      orgs,
      currentOrg: orgs.find((o) => o.is_default)?.id ?? orgs[0]?.id ?? null,
    }),
}));
