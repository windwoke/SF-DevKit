import { create } from "zustand";
import { persist } from "zustand/middleware";

const DEFAULT_APEX = "System.debug('Hello, SF DevKit!');";
const MAX_HISTORY = 30;

export type ApexRunStatus = "success" | "compile_error" | "runtime_exception" | "cli_error";

export interface ApexHistoryEntry {
  id: number;
  code: string;
  status: ApexRunStatus;
  logOutput: string | null;
  errorMessage: string | null;
  durationMs: number;
  executedAt: string;
  orgId: string;
}

interface ApexRunnerState {
  draft: string;
  history: ApexHistoryEntry[];
  nextId: number;
  setDraft: (code: string) => void;
  pushHistory: (entry: Omit<ApexHistoryEntry, "id">) => void;
  clearHistory: () => void;
}

export const useApexRunnerStore = create<ApexRunnerState>()(
  persist(
    (set) => ({
      draft: DEFAULT_APEX,
      history: [],
      nextId: 1,
      setDraft: (code) => set({ draft: code }),
      pushHistory: (entry) =>
        set((state) => {
          const id = state.nextId;
          const record: ApexHistoryEntry = { ...entry, id };
          const history = [record, ...state.history].slice(0, MAX_HISTORY);
          return { history, nextId: id + 1 };
        }),
      clearHistory: () => set({ history: [] }),
    }),
    {
      name: "apex-runner-store",
      partialize: (state) => ({
        history: state.history,
        nextId: state.nextId,
      }),
    },
  ),
);
