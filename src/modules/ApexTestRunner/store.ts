import { create } from "zustand";
import type { ApexTestSourceMode } from "./types";

/**
 * Cross-module navigation intent only: when Metadata Browser finishes a
 * retrieve, it can point this store at the package and switch modules.
 * Not persisted, never holds run results.
 */
interface ApexTestRunnerNavState {
  sourceMode: ApexTestSourceMode;
  packagePath: string | null;
  /** Set by other modules to hand a retrieve package over to this module. */
  openRetrievePackage: (path: string) => void;
  setSourceMode: (mode: ApexTestSourceMode) => void;
}

export const useApexTestRunnerStore = create<ApexTestRunnerNavState>()((set) => ({
  sourceMode: "org",
  packagePath: null,
  openRetrievePackage: (path) => set({ sourceMode: "retrieve", packagePath: path }),
  setSourceMode: (sourceMode) => set({ sourceMode }),
}));
