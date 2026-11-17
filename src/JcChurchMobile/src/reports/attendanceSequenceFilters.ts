import type { SequenceCell, SequenceRow } from "./attendanceSequence";
import { compareRosterMembers } from "./rosterSort";

export type AbsenceFilter = "all" | "latest" | "consecutive" | "recent" | "none";
export type AbsenceSort = "name" | "absence" | "recent" | "last-attended";
export type AbsenceSettings = {
  filter: AbsenceFilter; sort: AbsenceSort; minimum: string; missed: string; window: string;
  nameSort: string; createdSort: string;
};
export const DEFAULT_ABSENCE_SETTINGS: AbsenceSettings = {
  filter: "all", sort: "name", minimum: "2", missed: "3", window: "5", nameSort: "", createdSort: "",
};
export const RECENTLY_ABSENT_SETTINGS: AbsenceSettings = {
  ...DEFAULT_ABSENCE_SETTINGS, filter: "latest", sort: "absence",
};
export const absenceFilterOptions: { value: AbsenceFilter; label: string }[] = [
  { value: "all", label: "All members" }, { value: "latest", label: "Absent at latest eligible session" },
  { value: "consecutive", label: "Consecutive absences" }, { value: "recent", label: "Missed recently" },
  { value: "none", label: "No attendance in selected dates" },
];
export const absenceSortOptions: { value: AbsenceSort; label: string }[] = [
  { value: "name", label: "Member order" }, { value: "absence", label: "Longest current absence streak" },
  { value: "recent", label: "Most absences in recent sessions" },
  { value: "last-attended", label: "Longest since last attendance (selected dates)" },
];

export function validateAbsenceSettings(settings: AbsenceSettings) {
  const positive = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  if (!positive(settings.window)) return "Recent session count must be a positive whole number.";
  if (settings.filter === "consecutive" && !positive(settings.minimum)) return "Minimum consecutive absences must be a positive whole number.";
  if (settings.filter === "recent" && (!positive(settings.missed) || Number(settings.missed) > Number(settings.window)))
    return "Missed sessions must be a positive whole number no greater than the recent session count.";
  return "";
}

export function absencePreset(settings: AbsenceSettings) {
  const matches = (preset: AbsenceSettings) => (Object.keys(preset) as (keyof AbsenceSettings)[]).every(key => settings[key] === preset[key]);
  if (matches(DEFAULT_ABSENCE_SETTINGS)) return "all";
  if (matches(RECENTLY_ABSENT_SETTINGS)) return "recently-absent";
  return "custom";
}

export function absenceSettingsLabel(settings: AbsenceSettings) {
  const filter = settings.filter === "consecutive" ? `${settings.minimum}+ consecutive absences`
    : settings.filter === "recent" ? `Missed ${settings.missed}+ of last ${settings.window} eligible sessions`
    : absenceFilterOptions.find(option => option.value === settings.filter)!.label;
  const sort = settings.sort === "recent" ? `Most absences in last ${settings.window} eligible sessions`
    : absenceSortOptions.find(option => option.value === settings.sort)!.label;
  return `${filter} · ${sort}${settings.nameSort ? ` · Name ${settings.nameSort === "desc" ? "Z-A" : "A-Z"}` : ""}${settings.createdSort ? ` · Registration ${settings.createdSort}` : ""}`;
}

export function sessionInProgress(cell: SequenceCell, now: number) {
  return Date.parse(cell.session.startsAt) <= now && now < Date.parse(cell.session.endsAt);
}

export function getAbsenceMetrics(row: SequenceRow, window: number, now: number) {
  const eligible = row.cells.filter(cell => Date.parse(cell.session.startsAt) <= now && (cell.status === "attended" || cell.status === "absent"));
  const latest = eligible.at(-1);
  const recent = eligible.slice(-window);
  let currentAbsences = 0;
  for (let index = eligible.length - 1; index >= 0 && eligible[index]?.status === "absent"; index--) currentAbsences++;
  const lastAttended = eligible.slice().reverse().find(cell => cell.status === "attended")?.session.startsAt ?? null;
  return {
    eligibleCount: eligible.length, latestAbsent: latest?.status === "absent", currentAbsences,
    recentMissed: recent.filter(cell => cell.status === "absent").length, recentCount: recent.length,
    lastAttended, latestInProgress: latest ? sessionInProgress(latest, now) : false,
  };
}

export type AbsenceRow = SequenceRow & { absenceMetrics: ReturnType<typeof getAbsenceMetrics> };

export function filterAbsenceRows(rows: SequenceRow[], settings: AbsenceSettings, now: number): AbsenceRow[] {
  if (validateAbsenceSettings(settings)) return [];
  return rows.map(row => ({ ...row, absenceMetrics: getAbsenceMetrics(row, Number(settings.window), now) }))
    .filter(row => {
      const metrics = row.absenceMetrics;
      if (settings.filter === "all") return true;
      if (!metrics.eligibleCount) return false;
      if (settings.filter === "latest") return metrics.latestAbsent;
      if (settings.filter === "consecutive") return metrics.currentAbsences >= Number(settings.minimum);
      if (settings.filter === "recent") return metrics.recentMissed >= Number(settings.missed);
      return metrics.lastAttended === null;
    }).sort((left, right) => {
      const leftMetrics = left.absenceMetrics;
      const rightMetrics = right.absenceMetrics;
      if (settings.sort !== "name") {
        const eligibility = Number(rightMetrics.eligibleCount > 0) - Number(leftMetrics.eligibleCount > 0);
        if (eligibility) return eligibility;
      }
      if (settings.sort === "absence") {
        const difference = rightMetrics.currentAbsences - leftMetrics.currentAbsences || rightMetrics.recentMissed - leftMetrics.recentMissed;
        if (difference) return difference;
      }
      if (settings.sort === "recent") {
        const difference = rightMetrics.recentMissed - leftMetrics.recentMissed || rightMetrics.currentAbsences - leftMetrics.currentAbsences;
        if (difference) return difference;
      }
      if (settings.sort === "last-attended") {
        if (!leftMetrics.lastAttended && rightMetrics.lastAttended) return -1;
        if (leftMetrics.lastAttended && !rightMetrics.lastAttended) return 1;
        if (leftMetrics.lastAttended && rightMetrics.lastAttended) {
          const difference = Date.parse(leftMetrics.lastAttended) - Date.parse(rightMetrics.lastAttended);
          if (difference) return difference;
        }
      }
      return compareRosterMembers(left.member, right.member, settings.nameSort || "asc", settings.createdSort);
    });
}