import { create } from "zustand";

export interface OrgAuth {
  id: string;
  alias: string | null;
  instance_url: string;
  org_type: string;
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
}

export const useOrgStore = create<OrgState>((set) => ({
  currentOrg: null,
  orgs: [],
  setCurrentOrg: (orgId) => set({ currentOrg: orgId }),
  setOrgs: (orgs) =>
    set({
      orgs,
      currentOrg: orgs.find((o) => o.is_default)?.id ?? orgs[0]?.id ?? null,
    }),
}));
