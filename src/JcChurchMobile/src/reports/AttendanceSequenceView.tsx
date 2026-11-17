import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DateTime } from "luxon";
import { Heading, Icon, Label, Notice, Sheet, colors, styles } from "../ui";
import { latestStreakLabel, sequenceColumns, statusLabel, type SequenceCell, type SequenceRow, type SequenceStatus } from "./attendanceSequence";
import { sessionInProgress, type AbsenceRow } from "./attendanceSequenceFilters";

const palette: Record<SequenceStatus, string> = {
  attended: "#2463C5", absent: "#BF354A", upcoming: "#647875",
  "not-applicable": "#647875", unknown: "#647875",
};

export const sequenceMemberName = (row: SequenceRow) => [row.member.firstName, row.member.middleName, row.member.lastName].filter(Boolean).join(" ");

export function sequenceDate(value: string, zone: string) {
  return DateTime.fromISO(value).setZone(zone).toFormat("LLL d, yyyy h:mm a");
}

function StatusSquare({ status }: { status: SequenceStatus }) {
  const filled = status === "attended" || status === "absent";
  return (
    <View style={[local.square, { borderColor: palette[status], backgroundColor: filled ? palette[status] : colors.paper }]}>
      <Icon name={status === "attended" ? "checkmark" : status === "absent" ? "remove" : status === "upcoming" ? "time-outline" : status === "unknown" ? "help" : "close"}
        size={16} color={filled ? colors.paper : palette[status]} />
    </View>
  );
}

export function AttendanceSequence({ rows, eventName, timeZone, rangeLabel, sessionCount, recentWindow, now }: {
  rows: AbsenceRow[]; eventName: string; timeZone: string; rangeLabel: string; sessionCount: number; recentWindow: number; now: number;
}) {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<{ row: SequenceRow; cell: SequenceCell } | null>(null);
  const columns = sequenceColumns(width);
  return (
    <View style={styles.stack} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <Heading>Attendance sequence</Heading>
      <Label>{rangeLabel} · {sessionCount} sessions</Label>
      <View style={local.legend}>
        {(["attended", "absent", "upcoming", "not-applicable", "unknown"] as const).map(status => (
          <View key={status} style={local.legendItem}><StatusSquare status={status} /><Label small>{statusLabel[status]}</Label></View>
        ))}
      </View>
      <Label muted small>Current group members · Streaks within selected dates · {timeZone}</Label>
      {!rows.length && <Notice>No members match this search and attendance filters.</Notice>}
      {rows.map(row => (
        <View key={row.member.id} style={local.member} testID={`sequence-member-${row.member.id}`}>
          <Text style={[styles.text, local.name]}>{sequenceMemberName(row)}</Text>
          <Text style={[styles.text, local.streak, { color: row.streak ? palette[row.streak.status] : colors.muted }]}>{latestStreakLabel(row.streak)}</Text>
          {row.absenceMetrics.eligibleCount > 0 ? <>
            <Label muted small>Missed {row.absenceMetrics.recentMissed} of last {row.absenceMetrics.recentCount} eligible sessions{row.absenceMetrics.recentCount < recentWindow ? ` (last ${recentWindow} requested)` : ""}</Label>
            <Label muted small>{row.absenceMetrics.lastAttended
              ? `Last attended ${DateTime.fromISO(row.absenceMetrics.lastAttended).setZone(timeZone).toFormat("LLL d, yyyy")} · within selected dates`
              : "No attendance in selected dates"}</Label>
          </> : <Label muted small>No eligible started sessions</Label>}
          {row.absenceMetrics.latestInProgress && <Label small>Latest eligible session in progress</Label>}
          <View style={{ gap: 4 }} testID={`sequence-grid-${row.member.id}`}>
            {Array.from({ length: Math.ceil(row.cells.length / columns) }, (_, index) => (
              <View key={index} style={local.squareRow} testID={`sequence-row-${row.member.id}-${index}`}>
                {row.cells.slice(index * columns, (index + 1) * columns).map(cell => (
                  <Pressable key={cell.session.id} accessibilityRole="button"
                    accessibilityLabel={`${sequenceMemberName(row)}, ${sequenceDate(cell.session.startsAt, timeZone)}, ${statusLabel[cell.status]}`}
                    onPress={() => setSelected({ row, cell })}
                    style={({ pressed }) => [local.target, pressed && { backgroundColor: colors.pale }]}>
                    <StatusSquare status={cell.status} />
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
          <Label muted>{row.attended} attended · {row.absent} absent</Label>
        </View>
      ))}
      {selected && (
        <Sheet title="Attendance details" onClose={() => setSelected(null)}>
          <View style={styles.stack}>
            <Heading>{sequenceMemberName(selected.row)}</Heading>
            <Label>{eventName}</Label>
            <Label>{sequenceDate(selected.cell.session.startsAt, timeZone)} ({timeZone})</Label>
            <Label>{statusLabel[selected.cell.status]}</Label>
            {sessionInProgress(selected.cell, now) && <Label>Session in progress</Label>}
            {selected.cell.receipt && <Label>Checked in: {sequenceDate(selected.cell.receipt.checkedInAt, timeZone)}</Label>}
            {selected.cell.status === "absent" && <Notice>No active check-in recorded for this started session.</Notice>}
          </View>
        </Sheet>
      )}
    </View>
  );
}

const local = StyleSheet.create({
  member: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 16, gap: 8, minWidth: 0 },
  name: { fontFamily: "Manrope_600SemiBold", fontSize: 16 },
  streak: { fontSize: 14 },
  squareRow: { flexDirection: "row", gap: 4 },
  target: { width: 44, height: 44, justifyContent: "center", alignItems: "center", borderRadius: 4 },
  square: { width: 24, height: 24, borderRadius: 3, borderWidth: 1, justifyContent: "center", alignItems: "center" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
});