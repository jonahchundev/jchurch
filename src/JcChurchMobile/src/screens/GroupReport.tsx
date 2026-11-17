import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { api, churchPath, useDebounce } from "../api/hooks";
import type { Member } from "../api/types";
import { useAttendanceSequence, useEvents, useGroups, useSummary } from "../reports/api";
import { AttendanceSequence, sequenceDate, sequenceMemberName } from "../reports/AttendanceSequenceView";
import { buildAttendanceSequence, latestStreakLabel, statusLabel, validSequenceRange } from "../reports/attendanceSequence";
import { AbsenceFilterSheet } from "../reports/AbsenceFilterSheet";
import { absencePreset, absenceSettingsLabel, DEFAULT_ABSENCE_SETTINGS, filterAbsenceRows, type AbsenceSettings } from "../reports/attendanceSequenceFilters";
import { ExportMenu } from "../reports/export";
import { presetRange, ReportFilters, type ReportRange } from "../reports/ReportFilters";
import { compareRosterMembers } from "../reports/rosterSort";
import { StatGrid } from "../reports/StatGrid";
import { SvgBars } from "../reports/SvgBars";
import { memberName } from "./Members";
import {
  Heading,
  Button,
  Label,
  IconButton,
  Notice,
  Page,
  QueryState,
  Row,
  SearchBox,
  SegmentedControl,
  Select,
  Sheet,
  styles,
  Toggle,
  colors,
} from "../ui";

const TREND_WINDOW = 30;

// Group-level report: coverage vs current group size, daily trend, per-member totals.
// Counts use check-in-time membership snapshots (inclusiveGroupIds), not current rosters.
export default function GroupReport() {
  const params = useLocalSearchParams<{ churchId: string; groupId?: string }>();
  const router = useRouter();
  const [groupId, setGroupId] = useState(params.groupId ?? "");
  useEffect(() => setGroupId(params.groupId ?? ""), [params.groupId]);
  const [includeSubgroups, setIncludeSubgroups] = useState(true);
  const [eventId, setEventId] = useState("");
  const [range, setRange] = useState<ReportRange>(() => presetRange("90d"));
  const [memberSearch, setMemberSearch] = useState("");
  const [memberNameSort, setMemberNameSort] = useState("");
  const [memberCreatedOnSort, setMemberCreatedOnSort] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [view, setView] = useState("totals");
  const [absenceSettings, setAbsenceSettings] = useState<AbsenceSettings>({ ...DEFAULT_ABSENCE_SETTINGS });
  const [now, setNow] = useState(Date.now);
  const isSequence = view === "sequence";
  const rangeValid = validSequenceRange(range.from, range.to);
  const sequence = useAttendanceSequence(params.churchId, eventId, range.from, range.to, !!groupId && isSequence);
  useEffect(() => {
    if (!isSequence) return;
    const nextStart = Math.min(...(sequence.data?.sessions ?? []).map(session => Date.parse(session.startsAt)).filter(start => start > Date.now()));
    const timer = setTimeout(() => setNow(Date.now()), Math.min(30000, Math.max(1, nextStart - Date.now())));
    return () => clearTimeout(timer);
  }, [sequence.data, now, isSequence]);
  useEffect(() => { setNow(Date.now()); }, [sequence.data, isSequence]);

  const groups = useGroups(params.churchId);
  const events = useEvents(params.churchId);
  const filters = {
    groupId,
    includeSubgroups,
    eventId: eventId || undefined,
    from: range.from,
    to: range.to,
  };
  const byMember = useSummary(params.churchId, "member", filters, !!groupId && !isSequence);
  const byDay = useSummary(params.churchId, "day", filters, !!groupId && !isSequence);
  // Current group size = active members of the selected group (+ its subgroups when included).
  const members = useQuery({
    queryKey: [churchPath(params.churchId, "members"), "all"],
    queryFn: ({ signal }) => api.all<Member>(churchPath(params.churchId, "members"), signal),
    enabled: !!groupId,
  });

  const group = (groups.data ?? []).find((candidate) => candidate.id === groupId);
  const sizeIds = useMemo(() => {
    const children = (groups.data ?? [])
      .filter((candidate) => candidate.parentGroupId === groupId)
      .map((candidate) => candidate.id);
    return new Set(includeSubgroups ? [groupId, ...children] : [groupId]);
  }, [groups.data, groupId, includeSubgroups]);
  const activeMembers = useMemo(
    () =>
      (members.data ?? []).filter(
        (candidate) =>
          candidate.active && (candidate.groupIds ?? []).some((id) => sizeIds.has(id)),
      ),
    [members.data, sizeIds],
  );
  const memberById = useMemo(
    () => new Map((members.data ?? []).map((candidate) => [candidate.id, candidate])),
    [members.data],
  );

  const memberRows = (byMember.data ?? [])
    .slice()
    .sort((left, right) => right.checkedInCount - left.checkedInCount);
  // The By member list applies the same search + sort/filter as the By Member screen, but
  // client-side: rows come from the attendance summary, names from the already-loaded members.
  const searchTerm = useDebounce(memberSearch).trim().toLowerCase();
  const allSequenceRows = buildAttendanceSequence(activeMembers, sequence.data?.sessions ?? [], sequence.data?.receipts ?? [], now);
  const sequenceRows = filterAbsenceRows(allSequenceRows.filter(row => sequenceMemberName(row).toLowerCase().includes(searchTerm)), absenceSettings, now);
  const resetAbsenceSettings = () => setAbsenceSettings({ ...DEFAULT_ABSENCE_SETTINGS });
  const filteredMemberRows = useMemo(() => {
    const rows = memberRows.filter((row) => {
      if (!searchTerm) return true;
      const member = memberById.get(row.key);
      return (member ? memberName(member) : row.key).toLowerCase().includes(searchTerm);
    });
    if (memberNameSort || memberCreatedOnSort) {
      rows.sort((left, right) =>
        compareRosterMembers(
          memberById.get(left.key),
          memberById.get(right.key),
          memberNameSort || "asc",
          memberCreatedOnSort,
        ),
      );
    }
    return rows;
  }, [memberRows, memberById, searchTerm, memberNameSort, memberCreatedOnSort]);
  const dayRows = (byDay.data ?? [])
    .slice()
    .sort((left, right) => left.key.localeCompare(right.key));
  const total = memberRows.reduce((sum, row) => sum + row.checkedInCount, 0);
  const unique = memberRows.length;
  const size = activeMembers.length;
  const coverage = size > 0 ? `${Math.round((unique / size) * 100)}%` : "—";

  const groupLabel = group?.name ?? "Group";
  const stats = [
    { label: "Check-ins", value: String(total) },
    { label: "Unique attendees", value: String(unique) },
    { label: "Current group size", value: String(size) },
    { label: "Coverage", value: coverage },
  ];
  const trendBars = dayRows.slice(-TREND_WINDOW).map((row) => ({
    label: DateTime.fromISO(row.key).toFormat("LLL d"),
    value: row.checkedInCount,
  }));
  const totalsExport = {
    filename: `attendance-by-group-${groupId}`,
    title: `Attendance by group — ${groupLabel}${eventId ? ` (${(events.data ?? []).find((candidate) => candidate.id === eventId)?.name ?? eventId})` : ""}`,
    headers: ["Event", "Member", "Check-ins"],
    rows: memberRows.map((row) => [
      eventId ? ((events.data ?? []).find((candidate) => candidate.id === eventId)?.name ?? eventId) : "All events",
      memberById.has(row.key) ? memberName(memberById.get(row.key)!) : row.key,
      row.checkedInCount,
    ]),
  };
  const selectedEvent = (events.data ?? []).find(candidate => candidate.id === eventId);
  const timeZone = selectedEvent?.timeZone ?? "UTC";
  const rangeLabel = range.from && range.to
    ? `${DateTime.fromISO(range.from).toLocal().toFormat("LLL d, yyyy")} - ${DateTime.fromISO(range.to).minus({ milliseconds: 1 }).toLocal().toFormat("LLL d, yyyy")}` : "";
  const exportTable = isSequence ? {
    filename: `attendance-sequence-${groupId}`,
    title: `Attendance sequence - ${groupLabel} - ${selectedEvent?.name ?? ""} - ${rangeLabel} - Current group members - ${absenceSettingsLabel(absenceSettings)} - As of ${sequenceDate(new Date(now).toISOString(), timeZone)} (${timeZone})`,
    headers: ["Member", "Session", "Time zone", "Status", "Checked in", "Attended", "Absent", "Latest streak", "Recent missed", "Recent eligible sessions", "Requested recent window", "Last attended in selected dates", "Filter and sort", "Session in progress"],
    rows: sequenceRows.flatMap(row => row.cells.map(cell => [
      sequenceMemberName(row), sequenceDate(cell.session.startsAt, timeZone), timeZone, statusLabel[cell.status],
      cell.receipt ? sequenceDate(cell.receipt.checkedInAt, timeZone) : "", row.attended, row.absent, latestStreakLabel(row.streak),
      row.absenceMetrics.recentMissed, row.absenceMetrics.recentCount, Number(absenceSettings.window),
      row.absenceMetrics.lastAttended ? sequenceDate(row.absenceMetrics.lastAttended, timeZone) : row.absenceMetrics.eligibleCount ? "No attendance in selected dates" : "No eligible started sessions",
      absenceSettingsLabel(absenceSettings), Date.parse(cell.session.startsAt) <= now && now < Date.parse(cell.session.endsAt) ? "Yes" : "No",
    ])),
  } : totalsExport;

  // Group picker labels show the hierarchy: subgroups are prefixed with their parent.
  const groupOptions = (groups.data ?? [])
    .filter((candidate) => candidate.active)
    .map((candidate) => ({
      label: candidate.parentGroupId
        ? `${(groups.data ?? []).find((parent) => parent.id === candidate.parentGroupId)?.name ?? ""} · ${candidate.name}`
        : candidate.name,
      value: candidate.id,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  const sequenceEnabled = !!groupId && !!eventId && rangeValid;
  const pending = !!groupId && (members.isPending || (isSequence ? sequenceEnabled && sequence.isFetching : byMember.isPending || byDay.isPending));
  const failure = groups.error ?? events.error ?? members.error ?? (isSequence ? sequence.error : byMember.error ?? byDay.error);

  return (
    <Page
      title="By Group"
      eyebrow="Reports"
      onRefresh={() => {
        setNow(Date.now());
        void members.refetch();
        if (isSequence && sequenceEnabled) void sequence.refetch();
        if (!isSequence) { void byMember.refetch(); void byDay.refetch(); }
      }}
      refreshing={isSequence ? sequence.isFetching : byMember.isFetching || byDay.isFetching}
      actions={
        <>
          {isSequence && <IconButton icon="refresh-outline" label="Refresh attendance sequence" disabled={!sequenceEnabled || sequence.isFetching} onPress={() => {
            setNow(Date.now());
            void members.refetch();
            void sequence.refetch();
          }} />}
          <ExportMenu
            table={exportTable}
            extras={isSequence ? {} : { stats, bars: trendBars, barsTitle: "Daily trend" }}
            disabled={!groupId || (isSequence ? !sequenceEnabled || pending || !!failure || !sequenceRows.length || !sequence.data?.sessions.length : !memberRows.length)}
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
        label="Group"
        value={groupId}
        onChange={setGroupId}
        options={[{ label: "Choose a group", value: "" }, ...groupOptions]}
      />
      {!!groupId && (
        <>
          <Select
            label="Event"
            value={eventId}
            onChange={setEventId}
            options={[
              { label: "All events", value: "" },
              ...(events.data ?? [])
                .slice()
                .sort((left, right) => left.name.localeCompare(right.name))
                .map((candidate) => ({ label: candidate.name, value: candidate.id })),
            ]}
          />
          <Toggle
            label="Include subgroups"
            value={includeSubgroups}
            onChange={setIncludeSubgroups}
          />
          <ReportFilters onChange={setRange} />
          <SegmentedControl label="Report view" value={view} onChange={setView} options={[
            { value: "totals", label: "Totals" }, { value: "sequence", label: "Attendance sequence" },
          ]} />
        </>
      )}
      {!groupId && !groups.isPending && (
        <Notice>Choose a group to see its attendance report.</Notice>
      )}
      <QueryState
        pending={pending}
        error={failure}
        empty={!!groupId && !isSequence && !memberRows.length}
        emptyText="No check-ins for this group in this date range."
        onRetry={() => {
          if (isSequence && sequenceEnabled) void sequence.refetch();
          if (!isSequence) { void byMember.refetch(); void byDay.refetch(); }
          void members.refetch();
          void groups.refetch();
          void events.refetch();
        }}
      />
      {!!groupId && isSequence && !eventId && <Notice>Choose one event for the attendance sequence.</Notice>}
      {!!groupId && isSequence && !rangeValid && <Notice>Choose a complete date range of 93 days or fewer for the attendance sequence.</Notice>}
      {isSequence && sequenceEnabled && !pending && !failure && sequence.data && (
        <View style={styles.stack}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1, minWidth: 0 }}><SearchBox value={memberSearch} onChange={setMemberSearch} placeholder="Search members" /></View>
            <IconButton icon="swap-vertical-outline" label="Sort and filter members" onPress={() => setSortOpen(true)} />
          </View>
          <Label muted>{sequenceRows.length} of {activeMembers.length} current members · {absenceSettingsLabel(absenceSettings)}</Label>
          {absencePreset(absenceSettings) !== "all" && <Button secondary icon="refresh-outline" onPress={resetAbsenceSettings}>Clear attendance filters and sort</Button>}
          {sequence.data.sessions.some(session => Date.parse(session.startsAt) <= now && now < Date.parse(session.endsAt)) && <Notice>A session is in progress. Missing check-ins already count toward absence filters.</Notice>}
          {!activeMembers.length ? <Notice>No current members in this group.</Notice>
            : !sequence.data.sessions.length ? <Notice>No sessions for this event in this date range.</Notice>
            : <AttendanceSequence rows={sequenceRows} eventName={selectedEvent?.name ?? "Event"} timeZone={timeZone} rangeLabel={rangeLabel} sessionCount={sequence.data.sessions.length} recentWindow={Number(absenceSettings.window)} now={now} />}
        </View>
      )}
      {!!groupId && !isSequence && !!memberRows.length && (
        <>
          <StatGrid stats={stats} />
          <View style={styles.stack}>
            <Heading>Daily trend</Heading>
            {dayRows.length > TREND_WINDOW && (
              <Text style={[styles.text, styles.small, { color: colors.muted }]}>
                Showing the most recent {TREND_WINDOW} of {dayRows.length} days.
              </Text>
            )}
            <SvgBars items={trendBars} />
          </View>
          <View style={styles.stack}>
            <Heading>By member</Heading>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <SearchBox
                  value={memberSearch}
                  onChange={setMemberSearch}
                  placeholder="Search members"
                />
              </View>
              <IconButton icon="swap-vertical-outline" label="Sort and filter members" onPress={() => setSortOpen(true)} />
            </View>
            {!filteredMemberRows.length && (
              <Notice>No members match this search.</Notice>
            )}
            <View>
              {filteredMemberRows.map((row) => (
                <View key={row.key} style={{ paddingBottom: 8 }}>
                  <Row
                    icon="person-outline"
                    title={memberById.has(row.key) ? memberName(memberById.get(row.key)!) : row.key}
                    trailing={
                      <Text style={[styles.text, { fontFamily: "Manrope_600SemiBold" }]}>
                        {row.checkedInCount}
                      </Text>
                    }
                    onPress={() =>
                      router.push({
                        pathname: "/church/[churchId]/report-member",
                        params: { churchId: params.churchId, memberId: row.key },
                      })
                    }
                  />
                </View>
              ))}
            </View>
          </View>
        </>
      )}
      {sortOpen && isSequence && <AbsenceFilterSheet settings={absenceSettings} onClose={() => setSortOpen(false)} onApply={settings => { setAbsenceSettings(settings); setSortOpen(false); }} />}
      {sortOpen && !isSequence && (
        <Sheet title="Member sort and filter" onClose={() => setSortOpen(false)}>
          <View style={styles.stack}>
            <SegmentedControl label="Name order" value={memberNameSort} onChange={setMemberNameSort} options={[
              { value: "", label: "Off" },
              { value: "asc", label: "A-Z" },
              { value: "desc", label: "Z-A" },
            ]} />
            <SegmentedControl label="Created date" value={memberCreatedOnSort} onChange={setMemberCreatedOnSort} options={[
              { value: "", label: "Off" },
              { value: "newest", label: "Newest" },
              { value: "oldest", label: "Oldest" },
            ]} />
          </View>
        </Sheet>
      )}
    </Page>
  );
}
