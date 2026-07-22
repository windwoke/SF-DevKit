import { describe, expect, it } from "vitest";
import { greetingPeriodForHour, greetingSubtitleIndex } from "../greetingTime";

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

describe("greetingSubtitleIndex", () => {
  it("keeps the same message throughout a local calendar day", () => {
    const morning = new Date(2026, 6, 22, 8, 0);
    const evening = new Date(2026, 6, 22, 22, 30);

    expect(greetingSubtitleIndex(morning)).toBe(greetingSubtitleIndex(evening));
  });

  it("rotates on the next day and wraps within the available messages", () => {
    const first = greetingSubtitleIndex(new Date(2026, 6, 22), 3);
    const second = greetingSubtitleIndex(new Date(2026, 6, 23), 3);

    expect(second).toBe((first + 1) % 3);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(3);
  });
});
