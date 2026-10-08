import { useMemo, useState } from "react";
import { View } from "react-native";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { api, churchPath, memberImageUrl, useAll, useDebounce } from "../api/hooks";
import { message } from "../api/client";
import type { Attendance, Group, Member } from "../api/types";
import {
  Avatar,
  Button,
  IconButton,
  Label,
  Notice,
  QueryState,
  Row,
  SearchBox,
  SegmentedControl,
  Sheet,
  styles,
  Toggle,
} from "../ui";
import { memberName, sortedActiveGroups } from "../screens/Members";
import { compareRosterMembers } from "./rosterSort";

// Shared checked-in roster for an occurrence. Used by the Check-In screen (with undo)
// and by the Session report (readOnly: no undo affordances).
// Sort/filter mirrors the Members list: the group filter is applied server-side against the
// check-in-time group snapshot (groupIds query param); name and creation-date ordering are
// client-side because receipts do not denormalize member names, so the occurrence-bounded
// roster and its member details are fully loaded before rows are ordered.
export function AttendanceRoster({
  churchId,
  occurrenceId,
  readOnly = false,
  onUndo,
}: {
  churchId: string;
  occurrenceId: string;
  readOnly?: boolean;
  onUndo?: (memberId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [nameSort, setNameSort] = useState("asc");
  const [createdOnSort, setCreatedOnSort] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const query = useAll<Attendance>(churchPath(churchId, "attendance"), {
    occurrenceId,
    search: useDebounce(search),
    groupIds: groupIds.length ? groupIds.join(",") : undefined,
  });
  const groups = useAll<Group>(churchPath(churchId, "groups"), {
    includeArchived: true,
  });
  const receipts = useMemo(() => query.data ?? [], [query.data]);
  const memberQueries = useQueries({
    queries: receipts.map((receipt) => ({
      queryKey: [churchPath(receipt.churchId, `members/${receipt.memberId}`)],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.get<Member>(
          churchPath(receipt.churchId, `members/${receipt.memberId}`),
          signal,
        ),
    })),
  });
  const pending = query.isPending || memberQueries.some((entry) => entry.isPending);
  const rows = useMemo(() => {
    const combined = receipts.map((receipt, index) => ({
      receipt,
      member: memberQueries[index]?.data,
    }));
    combined.sort((left, right) =>
      compareRosterMembers(left.member, right.member, nameSort, createdOnSort),
    );
    return combined;
  }, [receipts, memberQueries, nameSort, createdOnSort]);
  return (
    <View style={styles.stack}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search checked-in members"
          />
        </View>
        <IconButton icon="swap-vertical-outline" label="Sort and filter checked-in members" onPress={() => setSortOpen(true)} />
      </View>
      <View style={styles.actions}>
        <Button
          secondary
          icon="refresh-outline"
          busy={query.isRefetching}
          onPress={() => void query.refetch()}
        >
          Refresh
        </Button>
      </View>
      <QueryState
        pending={pending}
        error={query.error}
        empty={!rows.length}
        emptyText={search || groupIds.length ? "No checked-in members found." : "No members checked in."}
        onRetry={() => void query.refetch()}
      />
      {!pending && (
        <View>
          {rows.map(({ receipt, member }) => (
            <RosterRow
              key={receipt.id}
              receipt={receipt}
              member={member}
              readOnly={readOnly}
              onUndo={onUndo}
            />
          ))}
        </View>
      )}
      {sortOpen && (
        <Sheet title="Checked-in sort and filter" onClose={() => setSortOpen(false)}>
          <View style={styles.stack}>
            <Label small>Group or subgroup</Label>
            <Label small muted>Leave all unchecked to show every checked-in member.</Label>
            {sortedActiveGroups(groups.data ?? [])
              .map((group) => (
                <Toggle
                  key={group.id}
                  compact
                  label={
                    group.parentGroupId
                      ? `${groups.data?.find((parent) => parent.id === group.parentGroupId)?.name ?? "Group"} / ${group.name}`
                      : group.name
                  }
                  value={groupIds.includes(group.id)}
                  onChange={(checked) =>
                    setGroupIds((current) =>
                      checked ? [...current, group.id] : current.filter((id) => id !== group.id),
                    )
                  }
                />
              ))}
            <SegmentedControl label="Name order" value={nameSort} onChange={setNameSort} options={[
              { value: "asc", label: "A-Z" },
              { value: "desc", label: "Z-A" },
            ]} />
            <SegmentedControl label="Created date" value={createdOnSort} onChange={setCreatedOnSort} options={[
              { value: "", label: "Off" },
              { value: "newest", label: "Newest" },
              { value: "oldest", label: "Oldest" },
            ]} />
          </View>
        </Sheet>
      )}
    </View>
  );
}

function RosterRow({
  receipt,
  member,
  readOnly,
  onUndo,
}: {
  receipt: Attendance;
  member?: Member;
  readOnly: boolean;
  onUndo?: (memberId: string) => void;
}) {
  const client = useQueryClient();
  const [confirmUndo, setConfirmUndo] = useState(false);
  const undo = useMutation({
    mutationFn: () =>
      api.undoCheckIn(receipt.churchId, receipt.occurrenceId, receipt.memberId),
    onSuccess: async () => {
      onUndo?.(receipt.memberId);
      await client.invalidateQueries({
        queryKey: [churchPath(receipt.churchId, "attendance")],
      });
      await client.invalidateQueries({
        queryKey: [
          churchPath(receipt.churchId, `events/${receipt.eventId}/occurrence-check-in-counts`),
        ],
      });
    },
  });
  return (
    <View style={{ paddingBottom: 8, gap: 8 }}>
      <Row
        avatar={
          member ? (
            <Avatar
              uri={memberImageUrl(receipt.churchId, receipt.memberId, member.imageVersion)}
            />
          ) : undefined
        }
        title={member ? memberName(member) : "Member unavailable"}
        subtitle={DateTime.fromISO(receipt.checkedInAt).toLocal().toFormat("LLL d, yyyy · h:mm a")}
        icon="checkmark-circle-outline"
        trailing={
          !readOnly ? (
            <Button
              danger
              busy={undo.isPending}
              disabled={undo.isPending}
              onPress={() => setConfirmUndo(true)}
            >
              Undo
            </Button>
          ) : undefined
        }
      />
      {!readOnly && confirmUndo && (
        <>
          <Notice error>
            Undo this check-in? The attendance record is retained in the audit
            history.
          </Notice>
          {undo.error && <Notice error>{message(undo.error)}</Notice>}
          <View style={styles.actions}>
            <Button danger busy={undo.isPending} onPress={() => undo.mutate()}>
              Confirm undo
            </Button>
            <Button
              secondary
              disabled={undo.isPending}
              onPress={() => setConfirmUndo(false)}
            >
              Keep check-in
            </Button>
          </View>
        </>
      )}
    </View>
  );
}
