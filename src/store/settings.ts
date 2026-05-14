import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DiffTool = "vscode" | "beyond_compare" | "custom";

interface SettingsStore {
  // Diff tool configuration
  diffTool: DiffTool;
  diffToolPath: string;
  diffCustomCommand: string;

  setDiffTool: (tool: DiffTool) => void;
  setDiffToolPath: (path: string) => void;
  setDiffCustomCommand: (cmd: string) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      diffTool: "vscode",
      diffToolPath: "",
      diffCustomCommand: 'bcompare "{working}" "{reference}"',

      setDiffTool: (tool) => set({ diffTool: tool }),
      setDiffToolPath: (path) => set({ diffToolPath: path }),
      setDiffCustomCommand: (cmd) => set({ diffCustomCommand: cmd }),
    }),
    { name: "settings-store" },
  ),
);
