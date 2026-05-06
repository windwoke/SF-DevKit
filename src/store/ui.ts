import { create } from "zustand";

export type ModuleId = "orgs" | "soql" | "metadata";

interface UiState {
  activeModule: ModuleId;
  setActiveModule: (moduleId: ModuleId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeModule: "orgs",
  setActiveModule: (moduleId) => set({ activeModule: moduleId }),
}));
