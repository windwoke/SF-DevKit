import type { MetadataTypeMeta } from "../../lib/tauri";
import { GROUP_ORDER } from "./constants";

const KNOWN_GROUPS = new Set<string>(GROUP_ORDER);

export type MetadataTreeGroup = (typeof GROUP_ORDER)[number];

/** 将未知或空分组归并到 Other，避免条目被放进 Map 却从未出现在 GROUP_ORDER 渲染循环里。 */
export function resolveTreeGroup(groupName: string | null | undefined): MetadataTreeGroup {
  const g = (groupName ?? "").trim();
  return (KNOWN_GROUPS.has(g) ? g : "Other") as MetadataTreeGroup;
}

function normalizeSearchText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase();
}

/** 去掉非字母数字下划线后拼成一串，便于跨 `.`、`·` 仍按连续子串搜（如 customf）。 */
function compactIdentifier(s: string): string {
  return normalizeSearchText(s.replace(/[^a-zA-Z0-9_]+/g, ""));
}

export function normalizeMetadataSearchQuery(raw: string): string {
  return normalizeSearchText(raw.trim());
}

/** 参与匹配的原始片段（不拆 CamelCase、不插空格）。 */
function typeSearchTokens(item: MetadataTypeMeta): string[] {
  const out: string[] = [item.xml_name];
  if (item.parent_xml_name) {
    const p = item.parent_xml_name;
    const c = item.xml_name;
    out.push(p, `${p}.${c}`, `${c}.${p}`, `${c} · ${p}`, `${p} · ${c}`);
  }
  if (item.directory_name) {
    out.push(item.directory_name);
  }
  if (item.xml_name === "CustomLabels") {
    out.push("CustomLabel");
  }
  return out;
}

export function typeMatchesMetadataSearch(item: MetadataTypeMeta, queryLower: string): boolean {
  if (!queryLower) return true;
  const q = normalizeSearchText(queryLower.trim());
  if (!q) return true;

  const tokens = typeSearchTokens(item);
  for (const t of tokens) {
    const n = normalizeSearchText(t);
    if (n.includes(q)) return true;
  }

  const glued = compactIdentifier(tokens.join(""));
  if (glued.includes(q)) return true;

  return false;
}
