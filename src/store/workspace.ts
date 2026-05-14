import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WorkspaceStore {
  lastRetrieveDir: string | null;
  lastRetrieveOrgId: string | null;
  lastRetrieveAt: string | null;

  setLastRetrieve: (dir: string, orgId: string) => void;
  clearLastRetrieve: () => void;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      lastRetrieveDir: null,
      lastRetrieveOrgId: null,
      lastRetrieveAt: null,

      setLastRetrieve: (dir, orgId) =>
        set({
          lastRetrieveDir: dir,
          lastRetrieveOrgId: orgId,
          lastRetrieveAt: new Date().toISOString(),
        }),

      clearLastRetrieve: () =>
        set({
          lastRetrieveDir: null,
          lastRetrieveOrgId: null,
          lastRetrieveAt: null,
        }),
    }),
    { name: "workspace-store" },
  ),
);
