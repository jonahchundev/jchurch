import { useEffect, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { api, churchPath, useAll, useDebounce, useList } from "../api/hooks";
import { ApiError, message } from "../api/client";
import type {
  Attendance,
  Church,
  ChurchEvent,
  Group,
  Member,
  Occurrence,
} from "../api/types";
import { memberAge, sessionTime } from "../domain";
import {
  Button,
  Heading,
  IconButton,
  Label,
  Notice,
  Page,
  QueryState,
  Row,
  SearchBox,
  styles,
  ViewTabs,
} from "../ui";
import { SessionList } from "./Events";
import { groupNames, memberName } from "./Members";
import ScanCheckIn from "./ScanCheckIn";

export default function CheckIn() {
  const params = useLocalSearchParams<{
    churchId: string;
    eventId?: string;
    occurrenceId?: string;
  }>();
  const router = useRouter();
  const [eventId, setEventId] = useState(params.eventId ?? "");
  const [occurrenceId, setOccurrenceId] = useState(params.occurrenceId ?? "");
  const [active, setActive] = useState(false);
  useEffect(() => {
    setEventId(params.eventId ?? "");
    setOccurrenceId(params.occurrenceId ?? "");
    setActive(false);
  }, [params.eventId, params.occurrenceId, params.churchId]);
  const event = useQuery({
    queryKey: [churchPath(params.churchId, `events/${eventId}`)],
    queryFn: ({ signal }) =>
      api.get<ChurchEvent>(
        churchPath(params.churchId, `events/${eventId}`),
        signal,
      ),
    enabled: !!eventId,
    refetchInterval: 30000,
  });
  const occurrence = useQuery({
    queryKey: [churchPath(params.churchId, `occurrences/${occurrenceId}`)],
    queryFn: ({ signal }) =>
      api.get<Occurrence>(
        churchPath(params.churchId, `occurrences/${occurrenceId}`),
        signal,
      ),
    enabled: !!occurrenceId,
    refetchInterval: 30000,
  });
  function changeEvent() {
    setActive(false);
    setEventId("");
    setOccurrenceId("");
    router.setParams({ eventId: "", occurrenceId: "" });
  }
  function changeSession() {
    setActive(false);
    setOccurrenceId("");
    router.setParams({ eventId, occurrenceId: "" });
  }
  if (!eventId)
    return (
      <ChooseEvent
        churchId={params.churchId}
        onSelect={(selected) => {
          setEventId(selected.id);
          setOccurrenceId("");
          setActive(false);
        }}
      />
    );
  if (!event.data || event.error)
    return (
      <Page title="Choose session">
        <QueryState
          pending={event.isPending}
          error={event.error}
          empty={false}
          onRetry={() => void event.refetch()}
        />
        <Button secondary onPress={changeEvent}>
          Change event
        </Button>
      </Page>
    );
  if (!occurrenceId)
    return (
      <Page title={event.data.name} eyebrow="Check-in / Choose session">
        <Label muted>{event.data.timeZone}</Label>
        <Button secondary icon="swap-horizontal-outline" onPress={changeEvent}>
          Change event
        </Button>
        {!event.data.active && <Notice error>This event is archived.</Notice>}
        <SessionList
          churchId={params.churchId}
          event={event.data}
          checkIn
          onSelect={(selected) => {
            setOccurrenceId(selected.id);
            setActive(false);
          }}
        />
      </Page>
    );
  if (!occurrence.data || occurrence.error)
    return (
      <Page title="Confirm session">
        <QueryState
          pending={occurrence.isPending}
          error={occurrence.error}
          empty={false}
          onRetry={() => void occurrence.refetch()}
        />
        <Button secondary onPress={changeSession}>
          Change session
        </Button>
      </Page>
    );
  const valid =
    event.data.active &&
    occurrence.data.active &&
    !occurrence.data.cancelled &&
    occurrence.data.eventId === event.data.id;
  if (!active || !valid)
    return (
      <Page title="Ready for check-in" eyebrow="Confirm session">
        <Heading>{event.data.name}</Heading>
        <Label>
          {sessionTime(occurrence.data.startsAt, event.data.timeZone)}
        </Label>
        <Label muted>{event.data.timeZone}</Label>
        {!valid && (
          <Notice error>
            This session is cancelled, archived, or does not belong to the
            selected event.
          </Notice>
        )}
        <Button
          icon="checkmark-circle-outline"
          disabled={!valid}
          onPress={() => setActive(true)}
        >
          Begin check-in
        </Button>
        <Button secondary onPress={changeSession}>
          Change session
        </Button>
        <Button secondary onPress={changeEvent}>
          Change event
        </Button>
      </Page>
    );
  return (
    <ActiveCheckIn
      key={`${params.churchId}/${occurrenceId}`}
      event={event.data}
      occurrence={occurrence.data}
      onChange={changeSession}
    />
  );
}

function ChooseEvent({
  churchId,
  onSelect,
}: {
  churchId: string;
  onSelect: (event: ChurchEvent) => void;
}) {
  const [search, setSearch] = useState("");
  const query = useList<ChurchEvent>(churchPath(churchId, "events"), {
    search: useDebounce(search),
  });
  const events = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Page
      title="Choose an event"
      eyebrow="Check-in / Step 1"
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
    >
      <SearchBox
        value={search}
        onChange={setSearch}
        placeholder="Search events"
      />
      <QueryState
        pending={query.isPending}
        error={query.error}
        empty={!events.length}
        emptyText="No events available."
        onRetry={() => void query.refetch()}
      />
      <View>
        {events.map((event) => (
          <Row
            key={event.id}
            title={event.name}
            subtitle={event.timeZone}
            icon="calendar-outline"
            onPress={() => onSelect(event)}
          />
        ))}
      </View>
      {query.hasNextPage && (
        <Button
          secondary
          busy={query.isFetchingNextPage}
          onPress={() => void query.fetchNextPage()}
        >
          Load more events
        </Button>
      )}
    </Page>
  );
}

type ReceiptState = {
  receipt?: Attendance;
  already?: boolean;
  error?: string;
  uncertain?: boolean;
};
function ActiveCheckIn({
  event,
  occurrence,
  onChange,
}: {
  event: ChurchEvent;
  occurrence: Occurrence;
  onChange: () => void;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const church = useQuery({
    queryKey: [churchPath(event.churchId)],
    queryFn: ({ signal }) => api.get<Church>(churchPath(event.churchId), signal),
  });
  const scanEnabled = church.data?.scanCodesEnabled ?? true;
  const scanFormat = church.data?.scanCodeFormat ?? "qr";
  const [view, setView] = useState("members");
  const [scanLocked, setScanLocked] = useState(false);
  const [search, setSearch] = useState("");
  const [receipts, setReceipts] = useState<Record<string, ReceiptState>>({});
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!scanEnabled && view === "scan") setView("members");
  }, [scanEnabled, view]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const query = useList<Member>(churchPath(event.churchId, "members"), {
    search: useDebounce(search),
    groupIds: occurrence.groupIds?.join(",") ?? "",
  });
  const groups = useAll<Group>(churchPath(event.churchId, "groups"), {
    includeArchived: true,
  });
  const members = query.data?.pages.flatMap((page) => page.items) ?? [];
  const checkIn = useMutation({
    mutationFn: (memberId: string) =>
      api.checkIn(event.churchId, occurrence.id, memberId),
    onSuccess: async (result, memberId) => {
      setReceipts((previous) => ({ ...previous, [memberId]: result }));
      await client.invalidateQueries({
        queryKey: [churchPath(event.churchId, "attendance")],
      });
      await client.invalidateQueries({
        queryKey: [churchPath(event.churchId, `events/${event.id}/occurrence-check-in-counts`)],
      });
    },
    onError: (error, memberId) => {
      setReceipts((previous) => ({
        ...previous,
        [memberId]: {
          error: message(error),
          uncertain: error instanceof ApiError && error.uncertain,
        },
      }));
      if (error instanceof ApiError && error.retryAfter)
        setRetryAt(Date.now() + error.retryAfter * 1000);
    },
  });
  const blocked = checkIn.isPending || now < retryAt;
  return (
    <View style={{ flex: 1 }}>
      <View
        style={[
          styles.notice,
          {
            borderRadius: 0,
            paddingHorizontal: 12,
            paddingVertical: 8,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          },
        ]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Heading>{event.name}</Heading>
          <Label small>{sessionTime(occurrence.startsAt, event.timeZone)} · {event.timeZone}</Label>
          <Label small muted>{occurrence.groupIds?.length ? `Groups: ${occurrence.groupIds.map(id => groups.data?.find(group => group.id === id)?.name ?? id).join(", ")}` : "Groups: All members"}</Label>
        </View>
        <IconButton icon="swap-horizontal-outline" label="Change session" disabled={checkIn.isPending || scanLocked} onPress={onChange} />
        <IconButton icon="create-outline" label="Edit session" disabled={checkIn.isPending || scanLocked} onPress={() => router.navigate({ pathname: "/church/[churchId]/events", params: { churchId: event.churchId, eventId: event.id, occurrenceId: occurrence.id, returnTo: "check-in" } })} />
      </View>
      <Page title="Check-in" compact>
        <ViewTabs
          value={view}
          onChange={next => { if (!scanLocked && !checkIn.isPending) setView(next); }}
          options={[
            { value: "members", label: "Find members" },
            ...(scanEnabled ? [{ value: "scan", label: "Scan" }] : []),
            { value: "attendance", label: "Checked in" },
          ]}
        />
        {view === "scan" ? (
          <ScanCheckIn churchId={event.churchId} eventId={event.id} occurrenceId={occurrence.id} timeZone={event.timeZone} format={scanFormat} onLocked={setScanLocked} />
        ) : view === "attendance" ? (
          <AttendanceList
            churchId={event.churchId}
            occurrenceId={occurrence.id}
            onUndo={(memberId) =>
              setReceipts((previous) => {
                const { [memberId]: _, ...remaining } = previous;
                return remaining;
              })
            }
          />
        ) : (
          <>
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Search members to check in"
            />
            {now < retryAt && (
              <Notice>
                Service is busy. Retry in {Math.ceil((retryAt - now) / 1000)}{" "}
                seconds.
              </Notice>
            )}
            <QueryState
              pending={query.isPending}
              error={query.error}
              empty={!members.length}
              emptyText="No members found."
              onRetry={() => void query.refetch()}
            />
            <View>
              {members.map((member) => {
                const state = receipts[member.id];
                const details = [
                  memberAge(member.birthDate) === null
                    ? ""
                    : `Age ${memberAge(member.birthDate)}`,
                  member.school ?? "",
                  groupNames(member, groups.data ?? []),
                ].filter(Boolean).join(" · ");
                return (
                  <View key={member.id} style={{ paddingBottom: 14, gap: 8 }}>
                    <Row
                      title={memberName(member)}
                      subtitle={details || undefined}
                      icon="person-outline"
                      badge={
                        state?.receipt
                          ? `${state.already ? "Already checked in" : "Checked in"} · ${DateTime.fromISO(state.receipt.checkedInAt).setZone(event.timeZone).toFormat("LLL d, h:mm a")}`
                          : undefined
                      }
                      trailing={
                        !state?.receipt ? (
                          <Button
                            icon="checkmark-outline"
                            busy={checkIn.isPending && checkIn.variables === member.id}
                            disabled={blocked}
                            onPress={() => checkIn.mutate(member.id)}
                          >
                            {state?.error ? "Retry" : "Check in"}
                          </Button>
                        ) : undefined
                      }
                    />
                    {state?.error && (
                      <Notice error>
                        {state.uncertain
                          ? "Confirmation pending. Retry this same member to recover the receipt. "
                          : ""}
                        {state.error}
                      </Notice>
                    )}
                  </View>
                );
              })}
            </View>
            {query.hasNextPage && (
              <Button
                secondary
                busy={query.isFetchingNextPage}
                onPress={() => void query.fetchNextPage()}
              >
                Load more members
              </Button>
            )}
          </>
        )}
      </Page>
    </View>
  );
}

function AttendanceList({
  churchId,
  occurrenceId,
  onUndo,
}: {
  churchId: string;
  occurrenceId: string;
  onUndo: (memberId: string) => void;
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
          <AttendanceRow key={receipt.id} receipt={receipt} onUndo={onUndo} />
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

function AttendanceRow({
  receipt,
  onUndo,
}: {
  receipt: Attendance;
  onUndo: (memberId: string) => void;
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
    mutationFn: () => api.undoCheckIn(receipt.churchId, receipt.occurrenceId, receipt.memberId),
    onSuccess: async () => {
      onUndo(receipt.memberId);
      await client.invalidateQueries({
        queryKey: [churchPath(receipt.churchId, "attendance")],
      });
      await client.invalidateQueries({
        queryKey: [churchPath(receipt.churchId, `events/${receipt.eventId}/occurrence-check-in-counts`)],
      });
    },
  });
  return (
    <View style={{ paddingBottom: 8, gap: 8 }}>
      <Row
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
          <Button
            danger
            busy={undo.isPending}
            disabled={undo.isPending}
            onPress={() => setConfirmUndo(true)}
          >
            Undo
          </Button>
        }
      />
      {confirmUndo && (
        <>
          <Notice error>Undo this check-in? The attendance record is retained in the audit history.</Notice>
          {undo.error && <Notice error>{message(undo.error)}</Notice>}
          <View style={styles.actions}>
            <Button danger busy={undo.isPending} onPress={() => undo.mutate()}>
              Confirm undo
            </Button>
            <Button secondary disabled={undo.isPending} onPress={() => setConfirmUndo(false)}>
              Keep check-in
            </Button>
          </View>
        </>
      )}
    </View>
  );
}
