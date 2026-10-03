import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { api, churchPath, useDebounce, useList } from "../api/hooks";
import type { Attendance, Member, Occurrence } from "../api/types";
import { useEvents, useSummary } from "../reports/api";
import { ExportMenu } from "../reports/export";
import { presetRange, ReportFilters, type ReportRange } from "../reports/ReportFilters";
import { StatGrid } from "../reports/StatGrid";
import { SvgBars } from "../reports/SvgBars";
import { sessionTime } from "../domain";
import { memberName } from "./Members";
import {
  Heading,
  IconButton,
  Label,
  Notice,
  Page,
  QueryState,
  Row,
  SearchBox,
  styles,
} from "../ui";

// Member-level report: totals, per-event bars, and the full chronological history.
export default function MemberReport() {
  const params = useLocalSearchParams<{ churchId: string; memberId?: string }>();
  const router = useRouter();
  const [memberId, setMemberId] = useState(params.memberId ?? "");
  useEffect(() => setMemberId(params.memberId ?? ""), [params.memberId]);
  const [range, setRange] = useState<ReportRange>(() => presetRange("90d"));
  const [search, setSearch] = useState("");

  const picker = useList<Member>(churchPath(params.churchId, "members"), {
    search: useDebounce(search),
    pageSize: 5,
  });
  const member = useQuery({
    queryKey: [churchPath(params.churchId, `members/${memberId}`)],
    queryFn: ({ signal }) =>
      api.get<Member>(churchPath(params.churchId, `members/${memberId}`), signal),
    enabled: !!memberId,
  });
  const events = useEvents(params.churchId);
  const filters = { memberId, from: range.from, to: range.to };
  const byEvent = useSummary(params.churchId, "event", filters, !!memberId);
  const history = useQuery({
    queryKey: [churchPath(params.churchId, "attendance"), "all", filters],
    queryFn: ({ signal }) =>
      api.all<Attendance>(churchPath(params.churchId, "attendance"), signal, filters),
    enabled: !!memberId,
  });
  // Occurrences across events, for "session start" labels on history rows.
  const occurrences = useQuery({
    queryKey: [churchPath(params.churchId, "occurrences"), "all", { from: range.from, to: range.to }],
    queryFn: ({ signal }) =>
      api.all<Occurrence>(churchPath(params.churchId, "occurrences"), signal, {
        from: range.from,
        to: range.to,
      }),
    enabled: !!memberId,
  });

  const eventName = (id: string) =>
    (events.data ?? []).find((candidate) => candidate.id === id)?.name ?? id;
  const occurrenceById = useMemo(
    () => new Map((occurrences.data ?? []).map((occurrence) => [occurrence.id, occurrence])),
    [occurrences.data],
  );
  const receipts = useMemo(
    () =>
      (history.data ?? [])
        .slice()
        .sort((left, right) => right.checkedInAt.localeCompare(left.checkedInAt)),
    [history.data],
  );
  const eventRows = (byEvent.data ?? [])
    .slice()
    .sort((left, right) => right.checkedInCount - left.checkedInCount);
  const first = receipts.length ? receipts[receipts.length - 1]!.checkedInAt : null;
  const last = receipts.length ? receipts[0]!.checkedInAt : null;
  const day = (value: string) =>
    DateTime.fromISO(value).toLocal().toFormat("LLL d, yyyy");

  const stats = [
    { label: "Check-ins", value: String(receipts.length) },
    { label: "Events attended", value: String(eventRows.length) },
    { label: "First seen", value: first ? day(first) : "—" },
    { label: "Last seen", value: last ? day(last) : "—" },
  ];
  const bars = eventRows.map((row) => ({
    label: eventName(row.key),
    value: row.checkedInCount,
  }));
  const exportTable = {
    filename: `attendance-member-${memberId}`,
    title: `Member attendance — ${member.data ? memberName(member.data) : memberId}`,
    headers: ["Event", "Session", "Checked in"],
    rows: receipts
      .slice()
      .reverse()
      .map((receipt) => [
        eventName(receipt.eventId),
        occurrenceById.has(receipt.occurrenceId)
          ? sessionTime(
              occurrenceById.get(receipt.occurrenceId)!.startsAt,
              (events.data ?? []).find((candidate) => candidate.id === receipt.eventId)?.timeZone ?? "UTC",
            )
          : receipt.occurrenceId,
        DateTime.fromISO(receipt.checkedInAt).toLocal().toFormat("LLL d, yyyy h:mm a"),
      ]),
  };

  const pending = !!memberId && (byEvent.isPending || history.isPending);
  const failure = byEvent.error ?? history.error ?? member.error;
  const candidates = memberId ? [] : (picker.data?.pages.flatMap((page) => page.items) ?? []).slice(0, 5);

  return (
    <Page
      title="By Member"
      eyebrow="Reports"
      actions={
        <>
          <ExportMenu
            table={exportTable}
            extras={{ stats, bars, barsTitle: "By event" }}
            disabled={!memberId || !receipts.length}
          />
          <IconButton
            icon="close-outline"
            label="Back to reports"
            onPress={() => router.push({ pathname: "/church/[churchId]/reports", params: { churchId: params.churchId } })}
          />
        </>
      }
    >
      {memberId ? (
        <Row
          icon="person-outline"
          title={
            member.data
              ? memberName(member.data)
              : member.isPending
                ? "Loading member..."
                : "Member unavailable"
          }
          subtitle="Selected for this report"
          trailing={
            <IconButton icon="close-outline" label="Clear member" onPress={() => setMemberId("")} />
          }
        />
      ) : (
        <>
          <SearchBox value={search} onChange={setSearch} placeholder="Search members" />
          <QueryState
            pending={picker.isPending}
            error={picker.error}
            empty={!candidates.length}
            emptyText="No members found."
            onRetry={() => void picker.refetch()}
          />
          <View>
            {candidates.map((candidate) => (
              <View key={candidate.id} style={{ paddingBottom: 8 }}>
                <Row
                  icon="person-outline"
                  title={memberName(candidate)}
                  onPress={() => setMemberId(candidate.id)}
                />
              </View>
            ))}
          </View>
        </>
      )}
      {!!memberId && (
        <>
          <ReportFilters onChange={setRange} />
          <QueryState
            pending={pending}
            error={failure}
            empty={!receipts.length}
            emptyText="No check-ins in this date range."
            onRetry={() => {
              void byEvent.refetch();
              void history.refetch();
              void occurrences.refetch();
            }}
          />
          {!!receipts.length && (
            <>
              <StatGrid stats={stats} />
              <View style={styles.stack}>
                <Heading>By event</Heading>
                <SvgBars items={bars} />
              </View>
              <View style={styles.stack}>
                <Heading>History</Heading>
                <View>
                  {receipts.map((receipt) => {
                    const occurrence = occurrenceById.get(receipt.occurrenceId);
                    const timeZone =
                      (events.data ?? []).find((candidate) => candidate.id === receipt.eventId)
                        ?.timeZone ?? "UTC";
                    return (
                      <View key={receipt.id} style={{ paddingBottom: 8 }}>
                        <Row
                          icon="checkmark-circle-outline"
                          title={eventName(receipt.eventId)}
                          subtitle={`${
                            occurrence ? sessionTime(occurrence.startsAt, timeZone) : "Session unavailable"
                          } · Checked in ${DateTime.fromISO(receipt.checkedInAt).toLocal().toFormat("h:mm a")}`}
                          onPress={() =>
                            router.push({
                              pathname: "/church/[churchId]/report-session",
                              params: {
                                churchId: params.churchId,
                                eventId: receipt.eventId,
                                occurrenceId: receipt.occurrenceId,
                              },
                            })
                          }
                        />
                      </View>
                    );
                  })}
                </View>
              </View>
            </>
          )}
        </>
      )}
      {!memberId && !picker.isPending && <Label muted>Select a member to see their attendance.</Label>}
    </Page>
  );
}
