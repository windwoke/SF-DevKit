import { create } from "zustand";

export type ModuleId = "home" | "orgs" | "soql" | "metadata" | "apex" | "deployer" | "logs";

interface UiState {
  activeModule: ModuleId;
  setActiveModule: (moduleId: ModuleId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeModule: "home",
  setActiveModule: (moduleId) => set({ activeModule: moduleId }),
}));
