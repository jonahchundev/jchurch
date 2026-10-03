import { useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { api, churchPath, memberImageUrl, useDebounce, useList } from "../api/hooks";
import { message } from "../api/client";
import type { Attendance, Member } from "../api/types";
import {
  Avatar,
  Button,
  Notice,
  QueryState,
  Row,
  SearchBox,
  styles,
} from "../ui";
import { memberName } from "../screens/Members";

// Shared checked-in roster for an occurrence. Used by the Check-In screen (with undo)
// and by the Session report (readOnly: no undo affordances).
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
  const query = useList<Attendance>(churchPath(churchId, "attendance"), {
    occurrenceId,
    search: useDebounce(search),
  });
  const receipts = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <View style={styles.stack}>
      <SearchBox
        value={search}
        onChange={setSearch}
        placeholder="Search checked-in members"
      />
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
        pending={query.isPending}
        error={query.error}
        empty={!receipts.length}
        emptyText={search ? "No checked-in members found." : "No members checked in."}
        onRetry={() => void query.refetch()}
      />
      <View>
        {receipts.map((receipt) => (
          <RosterRow
            key={receipt.id}
            receipt={receipt}
            readOnly={readOnly}
            onUndo={onUndo}
          />
        ))}
      </View>
      {query.hasNextPage && (
        <Button
          secondary
          busy={query.isFetchingNextPage}
          onPress={() => void query.fetchNextPage()}
        >
          Load more check-ins
        </Button>
      )}
    </View>
  );
}

function RosterRow({
  receipt,
  readOnly,
  onUndo,
}: {
  receipt: Attendance;
  readOnly: boolean;
  onUndo?: (memberId: string) => void;
}) {
  const client = useQueryClient();
  const [confirmUndo, setConfirmUndo] = useState(false);
  const member = useQuery({
    queryKey: [churchPath(receipt.churchId, `members/${receipt.memberId}`)],
    queryFn: ({ signal }) =>
      api.get<Member>(
        churchPath(receipt.churchId, `members/${receipt.memberId}`),
        signal,
      ),
  });
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
          member.data ? (
            <Avatar
              uri={memberImageUrl(receipt.churchId, receipt.memberId, member.data.imageVersion)}
            />
          ) : undefined
        }
        title={
          member.data
            ? memberName(member.data)
            : member.isPending
              ? "Loading member..."
              : "Member unavailable"
        }
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
