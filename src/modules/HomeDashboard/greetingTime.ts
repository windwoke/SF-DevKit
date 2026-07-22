export type GreetingPeriod =
  "morning" | "noon" | "afternoon" | "evening" | "lateNight";

export const GREETING_SUBTITLE_COUNT = 7;

export function greetingPeriodForHour(hour: number): GreetingPeriod {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 14) return "noon";
  if (hour >= 14 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "lateNight";
}

/** Pick a stable message for the local calendar day, including across DST. */
export function greetingSubtitleIndex(
  date: Date,
  count = GREETING_SUBTITLE_COUNT,
): number {
  const safeCount = Math.max(1, Math.floor(count));
  const dayNumber = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  );
  return ((dayNumber % safeCount) + safeCount) % safeCount;
}
