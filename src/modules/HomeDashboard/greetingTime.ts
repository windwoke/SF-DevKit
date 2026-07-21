export type GreetingPeriod =
  | "morning"
  | "noon"
  | "afternoon"
  | "evening"
  | "lateNight";

export function greetingPeriodForHour(hour: number): GreetingPeriod {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 14) return "noon";
  if (hour >= 14 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 23) return "evening";
  return "lateNight";
}
