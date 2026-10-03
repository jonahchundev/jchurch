import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { presetRange } from "../src/reports/range";

// A session "later today" (11 PM local) must be inside every bounded preset —
// regression for end boundaries previously stopping at the current instant.
const LATER_TODAY = DateTime.local().startOf("day").plus({ hours: 23 }).toUTC().toISO()!;
const START_OF_TODAY = DateTime.local().startOf("day").toUTC().toISO()!;

describe("presetRange", () => {
  it.each(["30d", "90d", "ytd"])("includes a session at any time today for preset %s", (preset) => {
    const { to } = presetRange(preset);
    expect(to).toBeDefined();
    expect(LATER_TODAY < to!).toBe(true);
    expect(START_OF_TODAY < to!).toBe(true);
  });

  it("bounds 30d/90d presets to whole local days", () => {
    const now = DateTime.local();
    for (const [preset, days] of [["30d", 30], ["90d", 90]] as const) {
      const range = presetRange(preset);
      expect(range.from).toBe(now.minus({ days }).startOf("day").toUTC().toISO());
      expect(range.to).toBe(now.plus({ days: 1 }).startOf("day").toUTC().toISO());
    }
  });

  it("bounds year to date from January 1 through the end of today", () => {
    const now = DateTime.local();
    const range = presetRange("ytd");
    expect(range.from).toBe(now.startOf("year").toUTC().toISO());
    expect(range.to).toBe(now.plus({ days: 1 }).startOf("day").toUTC().toISO());
  });

  it("includes the whole end date when custom from and to are the same date", () => {
    const date = DateTime.local().startOf("day");
    const label = date.toFormat("yyyy-MM-dd");
    const { from, to } = presetRange("custom", label, label);
    expect(from).toBe(date.toUTC().toISO());
    expect(to).toBe(date.plus({ days: 1 }).toUTC().toISO());
    const sessionStart = date.plus({ hours: 19 }).toUTC().toISO()!;
    expect(sessionStart >= from!).toBe(true);
    expect(sessionStart < to!).toBe(true);
  });

  it("ignores incomplete custom dates", () => {
    expect(presetRange("custom", "", "")).toEqual({});
    expect(presetRange("custom", "not-a-date", "")).toEqual({});
  });

  it("leaves all time unbounded", () => {
    expect(presetRange("all")).toEqual({});
  });
});
