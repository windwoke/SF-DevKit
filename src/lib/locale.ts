/** BCP 47-ish locale for `toLocaleString` / `toLocaleTimeString` / `localeCompare`. */
export function dateLocaleFromI18n(lng: string): string {
  return lng === "zh-CN" || lng.startsWith("zh") ? "zh-CN" : "en-US";
}
