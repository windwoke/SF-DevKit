import { describe, expect, it } from "vitest";
import { formatActivityRelativeTime } from "../activityTime";

const NOW = Date.parse("2026-07-21T12:00:00.000Z");

describe("formatActivityRelativeTime", () => {
  it("uses the localized just-now label", () => {
    expect(
      formatActivityRelativeTime(
        "2026-07-21T11:59:40.000Z",
        "zh-CN",
        "刚刚",
        NOW,
      ),
    ).toBe("刚刚");
  });

  it("formats elapsed minutes using the selected locale", () => {
    expect(
      formatActivityRelativeTime(
        "2026-07-21T11:55:00.000Z",
        "en-US",
        "just now",
        NOW,
      ),
    ).toContain("5m");
  });

  it("returns an invalid timestamp unchanged", () => {
    expect(formatActivityRelativeTime("unknown", "zh-CN", "刚刚", NOW)).toBe(
      "unknown",
    );
  });
});
