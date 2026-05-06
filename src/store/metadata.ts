import { create } from "zustand";

type SelectionMap = Record<string, string[]>;

type TypeSelectionState = "none" | "partial" | "all";

interface MetadataState {
  selection: SelectionMap;
  expandedTypes: string[];
  searchQuery: string;
  outputDir: string;
  outputMode: "extract" | "zip";
  apiVersion: string;
  setSearchQuery: (q: string) => void;
  setOutputDir: (dir: string) => void;
  setOutputMode: (mode: "extract" | "zip") => void;
  setApiVersion: (v: string) => void;
  toggleExpand: (metadataType: string) => void;
  toggleComponent: (metadataType: string, fullName: string) => void;
  toggleType: (metadataType: string, members: string[]) => void;
  clearSelection: () => void;
  replaceSelectionFromList: (items: Array<{ metadata_type: string; members: string[] }>) => void;
  selectedCount: () => number;
  getTypeSelectionState: (metadataType: string, allMembers: string[]) => TypeSelectionState;
  toSelectionList: () => Array<{ metadata_type: string; members: string[] }>;
}

export const useMetadataStore = create<MetadataState>((set, get) => ({
  selection: {},
  expandedTypes: [],
  searchQuery: "",
  outputDir: "",
  outputMode: "extract",
  apiVersion: "60.0",
  setSearchQuery: (q) => set({ searchQuery: q }),
  setOutputDir: (dir) => set({ outputDir: dir }),
  setOutputMode: (mode) => set({ outputMode: mode }),
  setApiVersion: (v) => set({ apiVersion: v }),
  toggleExpand: (metadataType) =>
    set((state) => {
      const setBuf = new Set(state.expandedTypes);
      if (setBuf.has(metadataType)) setBuf.delete(metadataType);
      else setBuf.add(metadataType);
      return { expandedTypes: Array.from(setBuf) };
    }),
  toggleComponent: (metadataType, fullName) =>
    set((state) => {
      const existing = new Set(state.selection[metadataType] ?? []);
      if (existing.has(fullName)) existing.delete(fullName);
      else existing.add(fullName);
      const next = { ...state.selection };
      if (existing.size === 0) delete next[metadataType];
      else next[metadataType] = Array.from(existing).sort();
      return { selection: next };
    }),
  toggleType: (metadataType, members) =>
    set((state) => {
      const current = new Set(state.selection[metadataType] ?? []);
      const allSelected = members.length > 0 && members.every((m) => current.has(m));
      const next = { ...state.selection };
      if (allSelected || members.length === 0) delete next[metadataType];
      else next[metadataType] = [...members].sort();
      return { selection: next };
    }),
  clearSelection: () => set({ selection: {} }),
  replaceSelectionFromList: (items) =>
    set(() => {
      const selection: SelectionMap = {};
      for (const item of items) {
        const metadataType = item.metadata_type.trim();
        if (!metadataType) continue;
        const members = Array.from(new Set(item.members.map((m) => m.trim()).filter(Boolean))).sort();
        if (members.length > 0) {
          selection[metadataType] = members;
        }
      }
      return { selection };
    }),
  selectedCount: () => Object.values(get().selection).reduce((sum, members) => sum + members.length, 0),
  getTypeSelectionState: (metadataType, allMembers) => {
    const selected = new Set(get().selection[metadataType] ?? []);
    if (selected.size === 0) return "none";
    if (allMembers.length > 0 && allMembers.every((m) => selected.has(m))) return "all";
    return "partial";
  },
  toSelectionList: () => {
    const entries = Object.entries(get().selection);
    return entries
      .filter(([, members]) => members.length > 0)
      .map(([metadata_type, members]) => ({
        metadata_type,
        members: [...members].sort(),
      }))
      .sort((a, b) => a.metadata_type.localeCompare(b.metadata_type));
  },
}));
