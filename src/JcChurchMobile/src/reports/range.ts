import { DateTime } from "luxon";

// A report date range as UTC ISO bounds; undefined means unbounded ("All time").
export type ReportRange = { from?: string; to?: string };

// All ranges cover whole local days as [from, to): `from` is the start of the first day and
// `to` is the start of the day AFTER the last day (the API treats `to` as exclusive), so an
// event or session at any time on the end date — including later today — is included.
export function presetRange(
  preset: string,
  customFrom = "",
  customTo = "",
): ReportRange {
  const now = DateTime.local();
  const dayStart = (value: DateTime) =>
    value.startOf("day").toUTC().toISO() ?? undefined;
  const endOfToday = now.plus({ days: 1 });
  switch (preset) {
    case "30d":
      return { from: dayStart(now.minus({ days: 30 })), to: dayStart(endOfToday) };
    case "ytd":
      return { from: dayStart(now.startOf("year")), to: dayStart(endOfToday) };
    case "all":
      return {};
    case "custom": {
      const from = DateTime.fromISO(customFrom);
      const to = DateTime.fromISO(customTo);
      return {
        from: from.isValid ? dayStart(from) : undefined,
        to: to.isValid ? dayStart(to.plus({ days: 1 })) : undefined,
      };
    }
    case "90d":
    default:
      return { from: dayStart(now.minus({ days: 90 })), to: dayStart(endOfToday) };
  }
}
