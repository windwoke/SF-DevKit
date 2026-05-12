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

export function normalizeMetadataSearchQuery(raw: string): string {
  return normalizeSearchText(raw.trim());
}

/** 将 CamelCase 的 xmlName 转成带空格短语，便于搜「custom label」这类自然语言。 */
function camelCaseXmlNameToSpaced(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

/** 类型搜索用的合并文本：API 名、分词后的可读形式、父类型、目录名等。 */
function typeSearchHaystackRaw(item: MetadataTypeMeta): string {
  const parts: string[] = [
    item.xml_name,
    camelCaseXmlNameToSpaced(item.xml_name),
  ];
  if (item.parent_xml_name) {
    parts.push(item.parent_xml_name);
    parts.push(camelCaseXmlNameToSpaced(item.parent_xml_name));
    parts.push(`${item.parent_xml_name}.${item.xml_name}`);
  }
  if (item.directory_name) {
    parts.push(item.directory_name);
  }
  // Salesforce 顶层为 CustomLabels（复数），子类型为 CustomLabel；用户常按单数搜。
  if (item.xml_name === "CustomLabels") {
    parts.push("CustomLabel", camelCaseXmlNameToSpaced("CustomLabel"));
  }
  return parts.join(" ");
}

export function typeMatchesMetadataSearch(item: MetadataTypeMeta, queryLower: string): boolean {
  if (!queryLower) return true;
  const haystack = normalizeSearchText(typeSearchHaystackRaw(item));
  const q = normalizeSearchText(queryLower.trim());
  if (!q) return true;
  return haystack.includes(q);
}
