import { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { api, churchPath } from "../api/hooks";
import type { Attendance, Member } from "../api/types";
import { useEventOccurrences, useEvents, useGroups, useSummary } from "../reports/api";
import { ExportMenu } from "../reports/export";
import { StatGrid } from "../reports/StatGrid";
import { SvgBars } from "../reports/SvgBars";
import { AttendanceRoster } from "../reports/AttendanceRoster";
import { sessionTime } from "../domain";
import { memberName } from "./Members";
import { Heading, IconButton, Notice, Page, QueryState, Select, styles } from "../ui";

// Session-level report: totals, per-group breakdown, and the read-only checked-in roster.
export default function SessionReport() {
  const params = useLocalSearchParams<{
    churchId: string;
    eventId?: string;
    occurrenceId?: string;
  }>();
  const router = useRouter();
  const [eventId, setEventId] = useState(params.eventId ?? "");
  const [occurrenceId, setOccurrenceId] = useState(params.occurrenceId ?? "");
  useEffect(() => {
    setEventId(params.eventId ?? "");
    setOccurrenceId(params.occurrenceId ?? "");
  }, [params.eventId, params.occurrenceId]);

  const events = useEvents(params.churchId);
  const occurrences = useEventOccurrences(params.churchId, eventId);
  const groups = useGroups(params.churchId);
  const totals = useSummary(params.churchId, "occurrence", { occurrenceId }, !!occurrenceId);
  const byGroup = useSummary(params.churchId, "group", { occurrenceId }, !!occurrenceId);
  // Full roster for CSV/PDF export (display roster pages itself via AttendanceRoster).
  const roster = useQuery({
    queryKey: [churchPath(params.churchId, "attendance"), "all", { occurrenceId }],
    queryFn: ({ signal }) =>
      api.all<Attendance>(churchPath(params.churchId, "attendance"), signal, { occurrenceId }),
    enabled: !!occurrenceId,
  });
  const members = useQuery({
    queryKey: [churchPath(params.churchId, "members"), "all"],
    queryFn: ({ signal }) => api.all<Member>(churchPath(params.churchId, "members"), signal),
    enabled: !!occurrenceId,
  });

  const event = (events.data ?? []).find((candidate) => candidate.id === eventId);
  const occurrence = (occurrences.data ?? []).find((candidate) => candidate.id === occurrenceId);
  const groupName = (id: string) =>
    (groups.data ?? []).find((group) => group.id === id)?.name ?? id;
  const total = totals.data?.[0];
  const groupRows = (byGroup.data ?? [])
    .slice()
    .sort((left, right) => right.checkedInCount - left.checkedInCount);

  const memberById = new Map((members.data ?? []).map((member) => [member.id, member]));
  const stats = [
    { label: "Checked in", value: String(total?.checkedInCount ?? 0) },
    { label: "Unique members", value: String(total?.uniqueMemberCount ?? 0) },
    { label: "Groups represented", value: String(groupRows.length) },
  ];
  const bars = groupRows.map((row) => ({
    label: groupName(row.key),
    value: row.checkedInCount,
  }));
  const exportTable = {
    filename: `attendance-session-${occurrenceId}`,
    title: `Session attendance — ${event?.name ?? "Event"} ${
      occurrence ? sessionTime(occurrence.startsAt, event?.timeZone ?? "UTC") : ""
    }`,
    headers: ["Event", "Session", "Member", "Groups", "Checked in"],
    rows: (roster.data ?? [])
      .slice()
      .sort((left, right) => left.checkedInAt.localeCompare(right.checkedInAt))
      .map((receipt) => [
        event?.name ?? "",
        occurrence ? sessionTime(occurrence.startsAt, event?.timeZone ?? "UTC") : "",
        memberById.has(receipt.memberId)
          ? memberName(memberById.get(receipt.memberId)!)
          : receipt.memberId,
        receipt.inclusiveGroupIds.map(groupName).join(", "),
        DateTime.fromISO(receipt.checkedInAt).toLocal().toFormat("LLL d, yyyy h:mm a"),
      ]),
  };

  const pending =
    events.isPending ||
    (!!eventId && occurrences.isPending) ||
    (!!occurrenceId && (totals.isPending || byGroup.isPending));
  const failure = events.error ?? occurrences.error ?? totals.error ?? byGroup.error;

  return (
    <Page
      title="By Session"
      eyebrow="Reports"
      actions={
        <>
          <ExportMenu
            table={exportTable}
            extras={{ stats, bars, barsTitle: "By group" }}
            disabled={!occurrenceId || !(roster.data ?? []).length}
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
        onChange={(next) => {
          setEventId(next);
          setOccurrenceId("");
        }}
        options={[
          { label: "Choose an event", value: "" },
          ...(events.data ?? [])
            .slice()
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((candidate) => ({ label: candidate.name, value: candidate.id })),
        ]}
      />
      {!!eventId && (
        <Select
          label="Session"
          value={occurrenceId}
          onChange={setOccurrenceId}
          options={[
            { label: "Choose a session", value: "" },
            ...(occurrences.data ?? [])
              .slice()
              .sort((left, right) => right.startsAt.localeCompare(left.startsAt))
              .map((candidate) => ({
                label: sessionTime(candidate.startsAt, event?.timeZone ?? "UTC"),
                value: candidate.id,
              })),
          ]}
        />
      )}
      {!eventId && !events.isPending && (
        <Notice>Choose an event, then a session, to see who checked in.</Notice>
      )}
      <QueryState
        pending={pending}
        error={failure}
        empty={false}
        onRetry={() => {
          void events.refetch();
          void occurrences.refetch();
          void totals.refetch();
          void byGroup.refetch();
        }}
      />
      {!!occurrenceId && !pending && !failure && (
        <>
          <StatGrid stats={stats} />
          {!!groupRows.length && (
            <View style={styles.stack}>
              <Heading>By group</Heading>
              <SvgBars items={bars} />
            </View>
          )}
          <View style={styles.stack}>
            <Heading>Roster</Heading>
            <AttendanceRoster churchId={params.churchId} occurrenceId={occurrenceId} readOnly />
          </View>
        </>
      )}
    </Page>
  );
}
