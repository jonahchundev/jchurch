import { describe, expect, it } from "vitest";
import type { Attendance, Member, Occurrence } from "../src/api/types";
import { buildAttendanceSequence, latestStreakLabel, sequenceColumns, validSequenceRange } from "../src/reports/attendanceSequence";
import { loadAttendanceSequence } from "../src/reports/attendanceSequenceData";

const member = { id: "member", active: true, createdOn: "2026-01-01T00:00:00Z" } as Member;
const session = (id: string, day: number) => ({ id, startsAt: `2026-11-${String(day).padStart(2, "0")}T10:00:00Z`, cancelled: false } as Occurrence);
const receipt = (id: string, active = true) => ({ occurrenceId: id, memberId: member.id, active } as Attendance);
const now = Date.parse("2026-11-16T10:00:00Z");

describe("attendance sequence", () => {
  it("loads zero-attendance sessions with bounded requests and no receipt date/group filter", async () => {
    let inFlight = 0;
    let maximum = 0;
    const calls: unknown[] = [];
    const sessions = Array.from({ length: 10 }, (_, index) => session(`session_${index}`, index + 1));
    const reader = {
      async all<T>(path: string, signal?: AbortSignal, filters?: Record<string, unknown>): Promise<T[]> {
        calls.push({ path, filters });
        if (path.endsWith("/occurrences")) return sessions as T[];
        inFlight++;
        maximum = Math.max(maximum, inFlight);
        await Promise.resolve();
        inFlight--;
        return [];
      },
    };
    const result = await loadAttendanceSequence(reader, "/churches/test", "event", "2026-11-01", "2026-11-16", new AbortController().signal);
    expect(result.sessions).toHaveLength(10);
    expect(result.receipts).toEqual([]);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(calls[1]).toEqual({ path: "/churches/test/attendance", filters: { occurrenceId: "session_0" } });
  });

  it("rejects incomplete receipt loads instead of producing false absences", async () => {
    const reader = { async all<T>(path: string): Promise<T[]> {
      if (path.endsWith("/occurrences")) return [session("first", 1)] as T[];
      throw new Error("Unavailable");
    } };
    await expect(loadAttendanceSequence(reader, "/churches/test", "event", "2026-11-01", "2026-11-16", new AbortController().signal)).rejects.toThrow("Unavailable");
  });

  it("includes zero-attendance members and computes trailing absences across row breaks", () => {
    const sessions = Array.from({ length: 16 }, (_, index) => session(`session_${index}`, index + 1));
    const [row] = buildAttendanceSequence([member], sessions.reverse(), [receipt("session_0"), receipt("session_12")], now);
    expect(row!.attended).toBe(2);
    expect(row!.absent).toBe(14);
    expect(latestStreakLabel(row!.streak)).toBe("Latest streak: Absent 3 in a row");
    const [absent] = buildAttendanceSequence([member], sessions, [], now);
    expect(absent!.absent).toBe(16);
    expect(absent!.streak?.count).toBe(16);
  });

  it("uses session start, excludes cancellations, and ignores future cells in streaks", () => {
    const sessions = [session("today", 16), session("tomorrow", 17), { ...session("cancelled", 15), cancelled: true }];
    const [row] = buildAttendanceSequence([member], sessions, [receipt("tomorrow")], now);
    expect(row!.cells.map(cell => cell.status)).toEqual(["absent", "attended"]);
    expect(row!.streak).toEqual({ status: "absent", count: 1 });
    expect(row!.attended).toBe(0);
    expect(buildAttendanceSequence([member], [session("today", 16)], [], now - 1)[0]!.cells[0]!.status).toBe("upcoming");
  });

  it("handles registration boundaries, legacy unknown eligibility, undo and late attendance", () => {
    const sessions = [session("first", 1), session("second", 2), session("third", 3)];
    const [recent] = buildAttendanceSequence([{ ...member, createdOn: "2026-11-02T10:00:00Z" }], sessions, [], now);
    expect(recent!.cells.map(cell => cell.status)).toEqual(["not-applicable", "absent", "absent"]);
    const [legacy] = buildAttendanceSequence([{ ...member, createdOn: undefined }], sessions, [receipt("second"), receipt("third", false)], now);
    expect(legacy!.cells.map(cell => cell.status)).toEqual(["unknown", "attended", "absent"]);
    expect(buildAttendanceSequence([{ ...member, createdOn: undefined }], sessions, [], now)[0]!.absent).toBe(0);
    expect(buildAttendanceSequence([member], sessions, [receipt("third"), receipt("third")], now)[0]!.attended).toBe(1);
  });

  it("keeps distinct same-day sessions and supports archived historical sessions", () => {
    const [row] = buildAttendanceSequence([member], [{ ...session("second", 1), archived: true }, session("first", 1)], [receipt("first")], now);
    expect(row!.cells.map(cell => cell.session.id)).toEqual(["first", "second"]);
    expect(row!.streak).toEqual({ status: "absent", count: 1 });
    expect(buildAttendanceSequence([{ ...member, active: false }], [], [], now)).toEqual([]);
  });

  it("adapts columns to container width and rejects unbounded or excessive ranges", () => {
    expect(sequenceColumns(320)).toBe(6);
    expect(sequenceColumns(480)).toBe(10);
    expect(sequenceColumns(0)).toBe(1);
    expect(validSequenceRange()).toBe(false);
    expect(validSequenceRange("2026-01-01", "2026-01-01")).toBe(false);
    expect(validSequenceRange("2026-01-01", "2026-04-04")).toBe(true);
    expect(validSequenceRange("2026-01-01", "2026-04-05")).toBe(false);
  });
});