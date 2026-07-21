import { describe, expect, it } from "vitest";
import { greetingPeriodForHour } from "../greetingTime";

describe("greetingPeriodForHour", () => {
  it.each([
    [5, "morning"],
    [10, "morning"],
    [11, "noon"],
    [13, "noon"],
    [14, "afternoon"],
    [17, "afternoon"],
    [18, "evening"],
    [22, "evening"],
    [23, "lateNight"],
    [0, "lateNight"],
    [4, "lateNight"],
  ])("maps hour %i to %s", (hour, expected) => {
    expect(greetingPeriodForHour(hour)).toBe(expected);
  });
});
