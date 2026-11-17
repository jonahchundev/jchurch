import type { Attendance, Member, Occurrence } from "../api/types";

export type SequenceStatus = "attended" | "absent" | "upcoming" | "not-applicable" | "unknown";
export type SequenceCell = { session: Occurrence; status: SequenceStatus; receipt?: Attendance };
export type SequenceRow = {
  member: Member;
  cells: SequenceCell[];
  attended: number;
  absent: number;
  streak: { status: "attended" | "absent"; count: number } | null;
};

export const statusLabel: Record<SequenceStatus, string> = {
  attended: "Checked in", absent: "Absent", upcoming: "Upcoming",
  "not-applicable": "Before registration", unknown: "Eligibility unknown",
};

export function sequenceColumns(width: number) {
  return Math.max(1, Math.floor((width + 4) / 48));
}

export function validSequenceRange(from?: string, to?: string) {
  const duration = Date.parse(to ?? "") - Date.parse(from ?? "");
  return Number.isFinite(duration) && duration > 0 && duration <= 93 * 86400000;
}

export function latestStreakLabel(streak: SequenceRow["streak"]) {
  return streak
    ? `Latest streak: ${streak.status === "attended" ? "Attended" : "Absent"} ${streak.count} in a row`
    : "Latest streak: No eligible started sessions";
}

export function buildAttendanceSequence(members: Member[], occurrences: Occurrence[], receipts: Attendance[], now: number): SequenceRow[] {
  const sessions = occurrences.filter(session => !session.cancelled)
    .slice().sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt) || left.id.localeCompare(right.id));
  const active = new Map<string, Attendance>();
  for (const receipt of receipts) {
    if (receipt.active) active.set(JSON.stringify([receipt.memberId, receipt.occurrenceId]), receipt);
  }
  return members.filter(member => member.active).map(member => {
    const attendedSessions = sessions.filter(session => active.has(JSON.stringify([member.id, session.id])));
    const created = Date.parse(member.createdOn ?? "");
    const firstKnown = attendedSessions[0] ? Date.parse(attendedSessions[0].startsAt) : Infinity;
    const cells = sessions.map(session => {
      const start = Date.parse(session.startsAt);
      const receipt = active.get(JSON.stringify([member.id, session.id]));
      const status: SequenceStatus = receipt ? "attended"
        : start > now ? "upcoming"
        : Number.isFinite(created) && start < created ? "not-applicable"
        : !Number.isFinite(created) && start < firstKnown ? "unknown"
        : "absent";
      return { session, receipt, status };
    });
    let streakStatus: "attended" | "absent" | null = null;
    let streakCount = 0;
    let attended = 0;
    let absent = 0;
    for (const cell of cells) {
      if (Date.parse(cell.session.startsAt) > now) continue;
      if (cell.status !== "attended" && cell.status !== "absent") continue;
      if (cell.status === "attended") attended++;
      else absent++;
      streakCount = streakStatus === cell.status ? streakCount + 1 : 1;
      streakStatus = cell.status;
    }
    const streak = streakStatus ? { status: streakStatus, count: streakCount } : null;
    return { member, cells, attended, absent, streak };
  });
}