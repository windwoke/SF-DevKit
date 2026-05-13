import type { MetadataComponentMeta } from "../../lib/tauri";

function normKey(s: string): string {
  return s
    .trim()
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase();
}

/** 子项过滤：对整条 full_name 做忽略大小写的子串包含。
 *  注意：只对原始 full_name 做匹配，不使用 compact 形式（去除分隔符）以避免
 *  跨 Object.Field 边界的误匹配（如 "hdCl" 误匹配 Opportunity__hd.CloseDate__c）。 */
export function filterMetadataComponents(
  items: MetadataComponentMeta[],
  query: string,
): MetadataComponentMeta[] {
  const normalized = normKey(query);
  if (!normalized) return items;

  return items.filter((item) => normKey(item.full_name).includes(normalized));
}
