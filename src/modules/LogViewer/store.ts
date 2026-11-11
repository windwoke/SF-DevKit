import { create } from "zustand";
import { persist } from "zustand/middleware";

export type TraceTargetKind = "SELF" | "USER" | "APEX_CLASS";
export type TracePreset = "standard" | "verbose";

export interface TraceTarget {
  id: string;
  orgId: string | null;
  kind: TraceTargetKind;
  label: string;
  entityId: string;
  traceFlagId: string | null;
  expiresAt: string | null;
  isActive: boolean;
}

export interface DownloadConfig {
  outputDir: string;
  autoOpenVscode: boolean;
  preset: TracePreset;
  durationMinutes: number;
}

interface LogViewerState {
  targets: TraceTarget[];
  downloadConfig: DownloadConfig;
  userFilter: string;
  selectedLogId: string | null;
  addTarget: (target: Omit<TraceTarget, "traceFlagId" | "expiresAt" | "isActive">) => void;
  removeTarget: (id: string) => void;
  updateTarget: (id: string, patch: Partial<TraceTarget>) => void;
  setDownloadConfig: (patch: Partial<DownloadConfig>) => void;
  setUserFilter: (value: string) => void;
  setSelectedLogId: (value: string | null) => void;
  expireTraceTargets: (now?: number) => void;
}

export const useLogStore = create<LogViewerState>()(
  persist(
    (set) => ({
      targets: [],
      downloadConfig: {
        outputDir: "",
        autoOpenVscode: true,
        preset: "standard",
        durationMinutes: 120,
      },
      userFilter: "",
      selectedLogId: null,
      addTarget: (target) =>
        set((state) => ({
          targets: [
            ...state.targets.filter((it) => it.id !== target.id),
            { ...target, traceFlagId: null, expiresAt: null, isActive: false },
          ],
        })),
      removeTarget: (id) =>
        set((state) => ({ targets: state.targets.filter((it) => it.id !== id) })),
      updateTarget: (id, patch) =>
        set((state) => ({
          targets: state.targets.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        })),
      setDownloadConfig: (patch) =>
        set((state) => ({
          downloadConfig: { ...state.downloadConfig, ...patch },
        })),
      setUserFilter: (value) => set({ userFilter: value }),
      setSelectedLogId: (value) => set({ selectedLogId: value }),
      expireTraceTargets: (now = Date.now()) =>
        set((state) => {
          const targets = state.targets.map((target) => {
            if (!target.isActive) return target;
            const expiresAt = target.expiresAt ? Date.parse(target.expiresAt) : Number.NaN;
            if (target.traceFlagId && Number.isFinite(expiresAt) && expiresAt > now) return target;
            return { ...target, isActive: false, traceFlagId: null, expiresAt: null };
          });
          return targets.some((target, index) => target !== state.targets[index]) ? { targets } : state;
        }),
    }),
    {
      name: "log-viewer-store",
      version: 1,
      migrate: (persistedState) => {
        const state = persistedState as Pick<LogViewerState, "targets" | "downloadConfig">;
        if (state.downloadConfig?.durationMinutes === 30) {
          return { ...state, downloadConfig: { ...state.downloadConfig, durationMinutes: 120 } };
        }
        return state;
      },
      partialize: (state) => ({
        targets: state.targets,
        downloadConfig: state.downloadConfig,
      }),
    },
  ),
);
