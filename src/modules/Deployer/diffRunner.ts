import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../store/settings";

/**
 * Build the shell command to open an external diff tool.
 * Uses the settings store for tool type, path, and custom command.
 * Available variables in custom: {working}, {reference}
 */
export function buildDiffCommand(workingDir: string, referenceDir: string): string {
  const { diffTool, diffToolPath, diffCustomCommand } = useSettingsStore.getState();

  switch (diffTool) {
    case "vscode": {
      const bin = diffToolPath || "code";
      // VSCode doesn't support directory diff from CLI; open working dir
      return `${bin} "${workingDir}"`;
    }
    case "beyond_compare": {
      const bin = diffToolPath || "bcompare";
      return `${bin} "-fv=Folder Compare" "-expandall" "${workingDir}" "${referenceDir}"`;
    }
    case "custom":
      return diffCustomCommand
        .replace(/\{working\}/g, workingDir)
        .replace(/\{reference\}/g, referenceDir);

    default:
      return `code "${workingDir}"`;
  }
}

/** Test the diff tool by opening it with dummy paths */
export async function testDiffTool(): Promise<boolean> {
  try {
    const cmd = buildDiffCommand("/tmp/diff-test-working", "/tmp/diff-test-reference");
    await invoke("open_diff_tool", { command: cmd });
    return true;
  } catch {
    return false;
  }
}
