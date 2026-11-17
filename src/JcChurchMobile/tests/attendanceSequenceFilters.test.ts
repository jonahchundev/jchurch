import { describe, expect, it } from "vitest";
import type { Attendance, Member, Occurrence } from "../src/api/types";
import { buildAttendanceSequence } from "../src/reports/attendanceSequence";
import { absencePreset, DEFAULT_ABSENCE_SETTINGS, filterAbsenceRows, getAbsenceMetrics, RECENTLY_ABSENT_SETTINGS, validateAbsenceSettings } from "../src/reports/attendanceSequenceFilters";

const now = Date.parse("2026-11-16T12:00:00Z");
const sessions = Array.from({ length: 6 }, (_, index) => ({ id: `session_${index}`, startsAt: `2026-11-${11 + index}T11:00:00Z`, endsAt: `2026-11-${11 + index}T13:00:00Z` } as Occurrence));
const member = (id: string, createdOn: string | undefined = "2020-01-01") => ({ id, active: true, firstName: id, lastName: "Example", createdOn } as Member);
const receipt = (memberId: string, index: number) => ({ memberId, occurrenceId: sessions[index]!.id, active: true, checkedInAt: "2026-11-16T11:59:00Z" } as Attendance);
const rows = buildAttendanceSequence([member("always"), member("never"), member("mixed"), { ...member("unknown"), createdOn: undefined }], sessions,
  [...sessions.map((_, index) => receipt("always", index)), receipt("mixed", 0), receipt("mixed", 3)], now);

describe("recent absence filters", () => {
  it("keeps default unchanged and excludes unknown histories from absence filters", () => {
    expect(filterAbsenceRows(rows, DEFAULT_ABSENCE_SETTINGS, now)).toHaveLength(4);
    for (const filter of ["latest", "consecutive", "recent", "none"] as const)
      expect(filterAbsenceRows(rows, { ...DEFAULT_ABSENCE_SETTINGS, filter }, now).map(row => row.member.id)).not.toContain("unknown");
    expect(filterAbsenceRows(rows, { ...DEFAULT_ABSENCE_SETTINGS, filter: "none" }, now).map(row => row.member.id)).toEqual(["never"]);
    expect(filterAbsenceRows(rows, RECENTLY_ABSENT_SETTINGS, now).map(row => row.member.id)).toEqual(["never", "mixed"]);
  });
  it("uses actual short-window denominator and absolute missed threshold", () => {
    const short = buildAttendanceSequence([member("new", "2026-11-15")], sessions, [], now);
    expect(getAbsenceMetrics(short[0]!, 5, now)).toMatchObject({ recentCount: 2, recentMissed: 2 });
    expect(filterAbsenceRows(short, { ...DEFAULT_ABSENCE_SETTINGS, filter: "recent" }, now)).toHaveLength(0);
    expect(filterAbsenceRows(short, { ...DEFAULT_ABSENCE_SETTINGS, filter: "recent", missed: "2" }, now)).toHaveLength(1);
  });
  it("ignores trailing future attendance and uses session date instead of receipt time", () => {
    const future = { ...sessions[5]!, id: "future", startsAt: "2026-11-17T11:00:00Z" };
    const [row] = buildAttendanceSequence([member("late")], [...sessions, future], [receipt("late", 0), { ...receipt("late", 0), occurrenceId: "future" }], now);
    expect(getAbsenceMetrics(row!, 5, now)).toMatchObject({ lastAttended: sessions[0]!.startsAt, latestAbsent: true, latestInProgress: true, currentAbsences: 5 });
    expect(getAbsenceMetrics(row!, 5, Date.parse(sessions[5]!.endsAt)).latestInProgress).toBe(false);
  });
  it("sorts no attendance first and unknown eligibility last for scoped recency", () => {
    expect(filterAbsenceRows(rows, { ...DEFAULT_ABSENCE_SETTINGS, sort: "last-attended" }, now).map(row => row.member.id)).toEqual(["never", "mixed", "always", "unknown"]);
    expect(filterAbsenceRows(rows, { ...DEFAULT_ABSENCE_SETTINGS, sort: "recent" }, now).map(row => row.member.id)).toEqual(["never", "mixed", "always", "unknown"]);
  });
  it("validates drafts and maps presets deterministically", () => {
    expect(absencePreset(DEFAULT_ABSENCE_SETTINGS)).toBe("all");
    expect(absencePreset(RECENTLY_ABSENT_SETTINGS)).toBe("recently-absent");
    expect(absencePreset({ ...RECENTLY_ABSENT_SETTINGS, window: "3" })).toBe("custom");
    for (const minimum of ["", "0", "-1", "1.5", "word"])
      expect(validateAbsenceSettings({ ...DEFAULT_ABSENCE_SETTINGS, filter: "consecutive", minimum })).not.toBe("");
    expect(validateAbsenceSettings({ ...DEFAULT_ABSENCE_SETTINGS, filter: "recent", missed: "6" })).not.toBe("");
    expect(validateAbsenceSettings({ ...DEFAULT_ABSENCE_SETTINGS, window: "0" })).not.toBe("");
    expect(validateAbsenceSettings(DEFAULT_ABSENCE_SETTINGS)).toBe("");
    expect(absencePreset({ createdSort: "", nameSort: "", window: "5", missed: "3", minimum: "2", sort: "name", filter: "all" })).toBe("all");
  });
  it("keeps deterministic member tie-breaks and excludes future-only or pre-registration history", () => {
    const tied = buildAttendanceSequence([member("zoe"), member("amy")], sessions, [], now);
    expect(filterAbsenceRows(tied, { ...RECENTLY_ABSENT_SETTINGS, nameSort: "desc" }, now).map(row => row.member.id)).toEqual(["zoe", "amy"]);
    const ineligible = buildAttendanceSequence([member("new", "2026-11-17")], sessions, [], now);
    expect(filterAbsenceRows(ineligible, { ...DEFAULT_ABSENCE_SETTINGS, filter: "none" }, now)).toHaveLength(0);
    const future = buildAttendanceSequence([member("future")], [{ ...sessions[0]!, startsAt: "2026-11-18T00:00:00Z" }], [], now);
    expect(filterAbsenceRows(future, RECENTLY_ABSENT_SETTINGS, now)).toHaveLength(0);
  });
});