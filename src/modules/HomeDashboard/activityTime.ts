export function formatActivityRelativeTime(
  timestamp: string | null,
  locale: string,
  justNow: string,
  nowMs = Date.now(),
): string {
  if (!timestamp) return "";
  const then = Date.parse(timestamp);
  if (Number.isNaN(then)) return timestamp;

  const elapsedMs = Math.max(0, nowMs - then);
  if (elapsedMs < 60_000) return justNow;

  const formatter = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
    style: "narrow",
  });
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.floor(hours / 24), "day");
}
