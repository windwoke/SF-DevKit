import { create } from "zustand";

export type DeployMode = "deploy" | "validate_and_deploy" | "validate_only";
export type TestLevel = "no_test_run" | "run_local_tests" | "run_specified_tests";

interface DeployConfig {
  mode: DeployMode;
  testLevel: TestLevel;
  testClasses: string[];
}

export interface DeployError {
  fileName: string;
  fullName: string;
  componentType: string;
  lineNumber: number | null;
  columnNumber: number | null;
  message: string;
  errorType: string;
}

export interface DeployResult {
  success: boolean;
  deployId: string | null;
  errorCount: number;
  componentCount: number;
  durationMs: number;
  errors: DeployError[];
  mode?: string;
}

interface DeployStore {
  workingDir: string | null;
  referenceDir: string | null;
  targetOrgId: string | null;

  config: DeployConfig;

  isDeploying: boolean;
  isDiffRetrieving: boolean;
  logs: string[];
  lastDeployResult: DeployResult | null;
  logView: "formatted" | "raw";

  setWorkingDir: (dir: string | null) => void;
  setReferenceDir: (dir: string | null) => void;
  setTargetOrgId: (id: string) => void;
  setConfig: (patch: Partial<DeployConfig>) => void;
  addTestClass: (cls: string) => void;
  removeTestClass: (cls: string) => void;
  setIsDeploying: (v: boolean) => void;
  setIsDiffRetrieving: (v: boolean) => void;
  appendLog: (line: string) => void;
  appendLogs: (lines: string[]) => void;
  clearLogs: () => void;
  setLastDeployResult: (r: DeployResult | null) => void;
  setLogView: (v: "formatted" | "raw") => void;
}

export const useDeployStore = create<DeployStore>((set) => ({
  workingDir: null,
  referenceDir: null,
  targetOrgId: null,
  config: {
    mode: "deploy",
    testLevel: "no_test_run",
    testClasses: [],
  },
  isDeploying: false,
  isDiffRetrieving: false,
  logs: [],
  lastDeployResult: null,
  logView: "formatted",

  setWorkingDir: (dir) => set({ workingDir: dir }),
  setReferenceDir: (dir) => set({ referenceDir: dir }),
  setTargetOrgId: (id) => set({ targetOrgId: id }),

  setConfig: (patch) =>
    set((s) => ({ config: { ...s.config, ...patch } })),

  addTestClass: (cls) =>
    set((s) => ({
      config: {
        ...s.config,
        testClasses: s.config.testClasses.includes(cls)
          ? s.config.testClasses
          : [...s.config.testClasses, cls],
      },
    })),

  removeTestClass: (cls) =>
    set((s) => ({
      config: {
        ...s.config,
        testClasses: s.config.testClasses.filter((c) => c !== cls),
      },
    })),

  setIsDeploying: (v) => set({ isDeploying: v }),
  setIsDiffRetrieving: (v) => set({ isDiffRetrieving: v }),

  appendLog: (line) =>
    set((s) => ({ logs: [...s.logs.slice(-2000), line] })),
  appendLogs: (lines) =>
    set((s) => {
      if (lines.length === 0) return { logs: s.logs };
      const next = [...s.logs, ...lines];
      return { logs: next.length > 2000 ? next.slice(-2000) : next };
    }),
  clearLogs: () => set({ logs: [], lastDeployResult: null, logView: "formatted" }),

  setLastDeployResult: (r) => set({ lastDeployResult: r }),
  setLogView: (v) => set({ logView: v }),
}));
