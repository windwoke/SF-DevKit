import { invoke } from "@tauri-apps/api/core";
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
  startRenewTimer: (orgId: string, targetId: string) => void;
  stopRenewTimer: (targetId: string) => void;
  ensureRenewTimers: (orgId: string) => void;
}

const renewTimers = new Map<string, ReturnType<typeof setInterval>>();

export const useLogStore = create<LogViewerState>()(
  persist(
    (set, get) => ({
      targets: [],
      downloadConfig: {
        outputDir: "",
        autoOpenVscode: true,
        preset: "standard",
        durationMinutes: 30,
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
      removeTarget: (id) => {
        const timer = renewTimers.get(id);
        if (timer) {
          clearInterval(timer);
          renewTimers.delete(id);
        }
        set((state) => ({ targets: state.targets.filter((it) => it.id !== id) }));
      },
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
      startRenewTimer: (orgId, targetId) => {
        const old = renewTimers.get(targetId);
        if (old) clearInterval(old);
        const timer = setInterval(async () => {
          const target = get().targets.find((it) => it.id === targetId);
          if (!target?.traceFlagId || !target.expiresAt) return;
          const remainSec = (new Date(target.expiresAt).getTime() - Date.now()) / 1000;
          if (remainSec > 120) return;
          try {
            const newExpires = await invoke<string>("renew_trace", {
              orgId,
              traceFlagId: target.traceFlagId,
              durationMinutes: get().downloadConfig.durationMinutes,
            });
            get().updateTarget(targetId, { expiresAt: newExpires, isActive: true });
          } catch {
            get().updateTarget(targetId, { isActive: false, traceFlagId: null, expiresAt: null });
          }
        }, 30_000);
        renewTimers.set(targetId, timer);
      },
      stopRenewTimer: (targetId) => {
        const timer = renewTimers.get(targetId);
        if (!timer) return;
        clearInterval(timer);
        renewTimers.delete(targetId);
      },
      ensureRenewTimers: (orgId) => {
        const state = get();
        const activeTargetIds = new Set<string>();

        for (const target of state.targets) {
          const belongsToOrg = (target.orgId ?? orgId) === orgId;
          if (!belongsToOrg) {
            const timer = renewTimers.get(target.id);
            if (timer) {
              clearInterval(timer);
              renewTimers.delete(target.id);
            }
            continue;
          }

          if (!target.isActive || !target.traceFlagId || !target.expiresAt) {
            const timer = renewTimers.get(target.id);
            if (timer) {
              clearInterval(timer);
              renewTimers.delete(target.id);
            }
            continue;
          }

          const expiresAtMs = new Date(target.expiresAt).getTime();
          if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
            get().updateTarget(target.id, { isActive: false, traceFlagId: null, expiresAt: null });
            const timer = renewTimers.get(target.id);
            if (timer) {
              clearInterval(timer);
              renewTimers.delete(target.id);
            }
            continue;
          }

          activeTargetIds.add(target.id);
          if (!renewTimers.has(target.id)) {
            get().startRenewTimer(orgId, target.id);
          }
        }

        for (const [targetId, timer] of renewTimers.entries()) {
          if (!activeTargetIds.has(targetId)) {
            clearInterval(timer);
            renewTimers.delete(targetId);
          }
        }
      },
    }),
    {
      name: "log-viewer-store",
      partialize: (state) => ({
        targets: state.targets,
        downloadConfig: state.downloadConfig,
      }),
    },
  ),
);
