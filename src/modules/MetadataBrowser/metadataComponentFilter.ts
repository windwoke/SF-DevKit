import type { MetadataComponentMeta } from "../../lib/tauri";

function normKey(s: string): string {
  return s
    .trim()
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase();
}

/** 子项过滤：整条 full_name 与搜索词同一套规范化后，做忽略大小写的子串包含。 */
export function filterMetadataComponents(
  items: MetadataComponentMeta[],
  query: string,
  _metadataType: string,
): MetadataComponentMeta[] {
  const normalized = normKey(query);
  if (!normalized) return items;

  return items.filter((item) => {
    const fn = normKey(item.full_name);
    if (fn.includes(normalized)) return true;
    const compact = normKey(item.full_name.replace(/[^a-zA-Z0-9_]+/g, ""));
    return compact.includes(normalized);
  });
}
