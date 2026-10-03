import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { DateTime } from "luxon";
import {
  useEventOccurrences,
  useEvents,
  useOccurrenceCounts,
  useSummary,
} from "../reports/api";
import { ExportMenu } from "../reports/export";
import { presetRange, ReportFilters, type ReportRange } from "../reports/ReportFilters";
import { StatGrid } from "../reports/StatGrid";
import { SvgBars } from "../reports/SvgBars";
import { sessionTime } from "../domain";
import { Heading, IconButton, Label, Notice, Page, QueryState, Row, Select, styles } from "../ui";

const BAR_WINDOW = 30;

// Event-level report: totals, per-session bars, and a session table that drills into the Session report.
export default function EventReport() {
  const params = useLocalSearchParams<{ churchId: string; eventId?: string }>();
  const router = useRouter();
  const [eventId, setEventId] = useState(params.eventId ?? "");
  useEffect(() => setEventId(params.eventId ?? ""), [params.eventId]);
  const [range, setRange] = useState<ReportRange>(() => presetRange("90d"));

  const events = useEvents(params.churchId);
  const occurrences = useEventOccurrences(params.churchId, eventId);
  const counts = useOccurrenceCounts(params.churchId, eventId);
  const members = useSummary(
    params.churchId,
    "member",
    { eventId, from: range.from, to: range.to },
    !!eventId,
  );

  const event = (events.data ?? []).find((candidate) => candidate.id === eventId);
  const countByOccurrence = useMemo(
    () => new Map((counts.data ?? []).map((count) => [count.occurrenceId, count.checkedInCount])),
    [counts.data],
  );
  // Sessions within the selected range, oldest first, with their check-in counts joined in.
  const sessions = useMemo(
    () =>
      (occurrences.data ?? [])
        .filter(
          (occurrence) =>
            (!range.from || occurrence.startsAt >= range.from) &&
            (!range.to || occurrence.startsAt < range.to),
        )
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
        .map((occurrence) => ({
          occurrence,
          checkedIn: countByOccurrence.get(occurrence.id) ?? 0,
        })),
    [occurrences.data, range.from, range.to, countByOccurrence],
  );
  const total = sessions.reduce((sum, session) => sum + session.checkedIn, 0);
  const attended = sessions.filter((session) => session.checkedIn > 0).length;
  const unique = members.data?.length ?? 0;
  const pending =
    events.isPending || (!!eventId && (occurrences.isPending || counts.isPending || members.isPending));
  const failure = events.error ?? occurrences.error ?? counts.error ?? members.error;

  const eventName = event?.name ?? "Event";
  // `to` is the exclusive day-after boundary; display the inclusive last day instead.
  const inclusiveEnd = range.to ? DateTime.fromISO(range.to).minus({ days: 1 }).toFormat("yyyy-MM-dd") : "";
  const rangeLabel = range.from ? `${range.from.slice(0, 10)} to ${inclusiveEnd}` : "All time";
  const stats = [
    { label: "Check-ins", value: String(total) },
    { label: "Sessions with check-ins", value: String(attended) },
    { label: "Unique attendees", value: String(unique) },
    { label: "Average per session", value: attended ? (total / attended).toFixed(1) : "0" },
  ];
  const bars = sessions.slice(-BAR_WINDOW).map(({ occurrence, checkedIn }) => ({
    label: DateTime.fromISO(occurrence.startsAt).toFormat("LLL d"),
    value: checkedIn,
  }));
  const exportTable = {
    filename: `attendance-by-event-${eventId}`,
    title: `Attendance by event — ${eventName} (${rangeLabel})`,
    headers: ["Event", "Session", "Checked in"],
    rows: sessions.map(({ occurrence, checkedIn }) => [
      eventName,
      sessionTime(occurrence.startsAt, event?.timeZone ?? "UTC"),
      checkedIn,
    ]),
  };

  return (
    <Page
      title="By Event"
      eyebrow="Reports"
      actions={
        <>
          <ExportMenu
            table={exportTable}
            extras={{ stats, bars, barsTitle: "Per session" }}
            disabled={!eventId || !sessions.length}
          />
          <IconButton
            icon="close-outline"
            label="Back to reports"
            onPress={() => router.push({ pathname: "/church/[churchId]/reports", params: { churchId: params.churchId } })}
          />
        </>
      }
    >
      <Select
        label="Event"
        value={eventId}
        onChange={setEventId}
        options={[
          { label: "Choose an event", value: "" },
          ...(events.data ?? [])
            .slice()
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((candidate) => ({ label: candidate.name, value: candidate.id })),
        ]}
      />
      <ReportFilters onChange={setRange} />
      {!eventId && !events.isPending && (
        <Notice>Choose an event to see its attendance report.</Notice>
      )}
      <QueryState
        pending={pending}
        error={failure}
        empty={!!eventId && !sessions.length}
        emptyText="No sessions with check-ins in this date range."
        onRetry={() => {
          void events.refetch();
          void occurrences.refetch();
          void counts.refetch();
          void members.refetch();
        }}
      />
      {!!eventId && !!sessions.length && (
        <>
          <StatGrid stats={stats} />
          <View style={styles.stack}>
            <Heading>Per session</Heading>
            {sessions.length > BAR_WINDOW && (
              <Label muted small>
                Showing the most recent {BAR_WINDOW} of {sessions.length} sessions.
              </Label>
            )}
            <SvgBars items={bars} />
          </View>
          <View style={styles.stack}>
            <Heading>Sessions</Heading>
            <View>
              {sessions
                .slice()
                .reverse()
                .map(({ occurrence, checkedIn }) => (
                  <View key={occurrence.id} style={{ paddingBottom: 8 }}>
                    <Row
                      icon="time-outline"
                      title={sessionTime(occurrence.startsAt, event?.timeZone ?? "UTC")}
                      subtitle={`${checkedIn} checked in`}
                      badge={occurrence.cancelled ? "Cancelled" : undefined}
                      badgeTone={occurrence.cancelled ? "danger" : "default"}
                      onPress={() =>
                        router.push({
                          pathname: "/church/[churchId]/report-session",
                          params: { churchId: params.churchId, eventId, occurrenceId: occurrence.id },
                        })
                      }
                    />
                  </View>
                ))}
            </View>
          </View>
        </>
      )}
    </Page>
  );
}
