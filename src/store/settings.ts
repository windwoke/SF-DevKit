import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DiffTool = "vscode" | "beyond_compare" | "custom";
export type ThemeMode = "dark" | "light" | "system";

/**
 * 用户选择的主题模式。
 * - `dark` / `light`：强制使用对应主题。
 * - `system`：跟随操作系统 `prefers-color-scheme`，OS 切换时实时同步。
 */
export type EffectiveTheme = "dark" | "light";

/** 将 ThemeMode 解析为实际生效的深/浅主题。 */
export function resolveTheme(mode: ThemeMode): EffectiveTheme {
  if (mode !== "system") return mode;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

/**
 * 返回当前生效的深/浅主题。当 themeMode === "system" 时，订阅 OS 的
 * prefers-color-scheme 变化并实时更新。
 */
export function useEffectiveTheme(): EffectiveTheme {
  const themeMode = useSettingsStore((state) => state.themeMode);
  const [systemLight, setSystemLight] = useState<boolean>(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: light)").matches
      : false,
  );

  useEffect(() => {
    if (themeMode !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e: MediaQueryListEvent) => setSystemLight(e.matches);
    // 同步一次，避免 OS 在挂载后已切换但状态未更新。
    setSystemLight(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [themeMode]);

  return themeMode === "system" ? (systemLight ? "light" : "dark") : themeMode;
}

interface SettingsStore {
  // Appearance
  themeMode: ThemeMode;

  // Diff tool configuration
  diffTool: DiffTool;
  diffToolPath: string;
  diffCustomCommand: string;

  setThemeMode: (mode: ThemeMode) => void;
  setDiffTool: (tool: DiffTool) => void;
  setDiffToolPath: (path: string) => void;
  setDiffCustomCommand: (cmd: string) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      themeMode: "dark",
      diffTool: "vscode",
      diffToolPath: "",
      diffCustomCommand: 'bcompare "{working}" "{reference}"',

      setThemeMode: (themeMode) => set({ themeMode }),
      setDiffTool: (tool) => set({ diffTool: tool }),
      setDiffToolPath: (path) => set({ diffToolPath: path }),
      setDiffCustomCommand: (cmd) => set({ diffCustomCommand: cmd }),
    }),
    { name: "settings-store" },
  ),
);
