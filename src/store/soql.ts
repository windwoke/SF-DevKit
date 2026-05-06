import { create } from "zustand";

const DEFAULT_SOQL = "SELECT Id, Name\nFROM Account\nLIMIT 20";
const MAX_HISTORY = 20;

interface SoqlState {
  draft: string;
  history: string[];
  setDraft: (next: string) => void;
  pushHistory: (query: string) => void;
  clearHistory: () => void;
}

export const useSoqlStore = create<SoqlState>((set) => ({
  draft: DEFAULT_SOQL,
  history: [],
  setDraft: (next) => set({ draft: next }),
  pushHistory: (query) =>
    set((state) => {
      const trimmed = query.trim();
      if (!trimmed) return state;
      const deduped = [trimmed, ...state.history.filter((item) => item !== trimmed)];
      return { history: deduped.slice(0, MAX_HISTORY) };
    }),
  clearHistory: () => set({ history: [] }),
}));
