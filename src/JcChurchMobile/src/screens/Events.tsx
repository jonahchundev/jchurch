import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DateTime } from "luxon";
import { api, churchPath, useAll, useDebounce, useList } from "../api/hooks";
import { ApiError, message } from "../api/client";
import type { ChurchEvent, EventInput, Occurrence } from "../api/types";
import {
  eventSchema,
  localToUtc,
  sessionTime,
  type EventFormValues,
} from "../domain";
import {
  Button,
  DateField,
  Field,
  Heading,
  IconButton,
  Label,
  Notice,
  Page,
  QueryState,
  Row,
  SearchBox,
  Select,
  Sheet,
  styles,
  Toggle,
} from "../ui";

export default function Events() {
  const { churchId } = useLocalSearchParams<{ churchId: string }>();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ChurchEvent | "new" | null>(null);
  const query = useList<ChurchEvent>(churchPath(churchId, "events"), {
    search: useDebounce(search),
  });
  const events = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Page
      title="Events"
      eyebrow="Gather together"
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      actions={
        <IconButton
          icon="add-outline"
          label="Add event"
          onPress={() => setEditing("new")}
        />
      }
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
        emptyText="No events found."
        onRetry={() => void query.refetch()}
      />
      <View>
        {events.map((event) => (
          <Row
            key={event.id}
            title={event.name}
            subtitle={`${event.recurrenceRule ? "Recurring" : "One-time"} · ${event.durationMinutes} min · ${event.timeZone}`}
            icon="calendar-outline"
            onPress={() => setEditing(event)}
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
      {editing && (
        <EventEditor
          event={editing === "new" ? undefined : editing}
          churchId={churchId}
          onClose={() => setEditing(null)}
        />
      )}
    </Page>
  );
}

function defaults(event?: ChurchEvent): EventFormValues {
  return {
    name: event?.name ?? "",
    localStart:
      event?.localStart.slice(0, 16) ??
      DateTime.local()
        .plus({ days: 1 })
        .set({ hour: 9, minute: 0 })
        .toFormat("yyyy-MM-dd'T'HH:mm"),
    timeZone:
      event?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    durationMinutes: String(event?.durationMinutes ?? 60),
    recurrenceRule: event?.recurrenceRule ?? "",
  };
}

function EventEditor({
  event,
  churchId,
  onClose,
}: {
  event?: ChurchEvent;
  churchId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [current, setCurrent] = useState(event);
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [notice, setNotice] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: defaults(event),
  });
  const save = useMutation({
    mutationFn: (values: EventFormValues) => {
      const input: EventInput = current
        ? {
            name: values.name,
            localStart: current.localStart,
            timeZone: current.timeZone,
            durationMinutes: current.durationMinutes,
            recurrenceRule: current.recurrenceRule,
          }
        : {
            name: values.name,
            localStart: `${values.localStart}:00`,
            timeZone: values.timeZone,
            durationMinutes: Number(values.durationMinutes),
            recurrenceRule: values.recurrenceRule || null,
          };
      return api.save<ChurchEvent>(
        churchPath(churchId, `events${current ? `/${current.id}` : ""}`),
        input,
        current?._etag,
      );
    },
    onSuccess: async (result) => {
      setCurrent(result);
      form.reset(defaults(result));
      setNotice("Event saved.");
      await client.invalidateQueries({
        queryKey: [churchPath(churchId, "events")],
      });
    },
  });
  const reload = useMutation({
    mutationFn: () =>
      api.get<ChurchEvent>(churchPath(churchId, `events/${current!.id}`)),
    onSuccess: (result) => {
      setCurrent(result);
      form.reset(defaults(result));
      save.reset();
      archive.reset();
      setConfirmArchive(false);
    },
  });
  const archive = useMutation({
    mutationFn: () =>
      api.archive(
        churchPath(churchId, `events/${current!.id}`),
        current!._etag,
      ),
    onSuccess: async () => {
      await client.invalidateQueries();
      onClose();
    },
  });
  const generate = useMutation({
    mutationFn: () =>
      api.request<{ created: number }>(
        churchPath(churchId, `events/${current!.id}/occurrences`),
        { method: "POST" },
      ),
    onSuccess: async (result) => {
      setNotice(
        result.data.created
          ? `${result.data.created} sessions created.`
          : "Sessions are already up to date.",
      );
      await client.invalidateQueries({
        queryKey: [churchPath(churchId, `events/${current!.id}/occurrences`)],
      });
    },
  });
  const error = save.error ?? archive.error ?? reload.error ?? generate.error;
  const busy =
    save.isPending ||
    archive.isPending ||
    reload.isPending ||
    generate.isPending;
  const stale = error instanceof ApiError && error.status === 412;
  function begin(occurrence: Occurrence) {
    onClose();
    router.navigate({
      pathname: "/church/[churchId]/check-in",
      params: { churchId, eventId: current!.id, occurrenceId: occurrence.id },
    });
  }
  if (selected && current)
    return (
      <SessionEditor
        event={current}
        occurrence={selected}
        onClose={() => setSelected(null)}
        onBegin={begin}
      />
    );
  return (
    <Sheet
      title={current ? "Event & sessions" : "Add event"}
      dirty={form.formState.isDirty}
      busy={busy}
      onClose={onClose}
    >
      <View style={styles.stack}>
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field
              label="Event name"
              value={field.value}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
              editable={!busy && (!current || current.active)}
              maxLength={200}
            />
          )}
        />
        <Controller
          control={form.control}
          name="localStart"
          render={({ field, fieldState }) => (
            <DateField
              label="Local start"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              time
              disabled={!!current || busy}
            />
          )}
        />
        <Controller
          control={form.control}
          name="timeZone"
          render={({ field, fieldState }) => (
            <Field
              label="Timezone"
              value={field.value}
              onChangeText={field.onChange}
              autoCapitalize="none"
              placeholder="America/New_York"
              error={fieldState.error?.message}
              editable={!current && !busy}
            />
          )}
        />
        <Controller
          control={form.control}
          name="durationMinutes"
          render={({ field, fieldState }) => (
            <Field
              label="Duration (minutes)"
              value={field.value}
              onChangeText={field.onChange}
              keyboardType="number-pad"
              error={fieldState.error?.message}
              editable={!current && !busy}
            />
          )}
        />
        <Controller
          control={form.control}
          name="recurrenceRule"
          render={({ field }) =>
            current ? (
              <Field
                label="Recurrence"
                value={field.value || "One-time"}
                editable={false}
              />
            ) : (
              <Select
                label="Repeat"
                value={field.value}
                onChange={field.onChange}
                disabled={busy}
                options={[
                  { value: "", label: "Does not repeat" },
                  ...["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].map(
                    (frequency) => ({
                      value: `FREQ=${frequency}`,
                      label: frequency[0] + frequency.slice(1).toLowerCase(),
                    }),
                  ),
                ]}
              />
            )
          }
        />
        {error && <Notice error>{message(error)}</Notice>}
        {stale && (
          <>
            <Label muted>
              Reloading replaces your draft with the latest event.
            </Label>
            <Button
              secondary
              busy={reload.isPending}
              onPress={() => reload.mutate()}
            >
              Reload latest version
            </Button>
          </>
        )}
        {!!notice && <Notice>{notice}</Notice>}
        <Button
          icon="save-outline"
          busy={save.isPending}
          disabled={busy || stale || (!!current && !current.active)}
          onPress={() =>
            void form.handleSubmit((value) => save.mutate(value))()
          }
        >
          Save event
        </Button>
        {current && (
          <>
            <Heading>Sessions</Heading>
            <Label muted>{current.timeZone}</Label>
            <Button
              icon="add-circle-outline"
              busy={generate.isPending}
              disabled={busy || !current.active}
              onPress={() => generate.mutate()}
            >
              Generate occurrences
            </Button>
            <SessionList
              churchId={churchId}
              event={current}
              onSelect={setSelected}
              disabled={busy || form.formState.isDirty}
            />
            {!confirmArchive ? (
              <Button
                danger
                disabled={busy || !current.active}
                icon="archive-outline"
                onPress={() => setConfirmArchive(true)}
              >
                Archive event
              </Button>
            ) : (
              <>
                <Notice
                  error
                >{`Archive ${current.name}? New check-ins will be blocked. Attendance history is retained.`}</Notice>
                <Button
                  danger
                  busy={archive.isPending}
                  disabled={busy || stale}
                  onPress={() => archive.mutate()}
                >
                  Confirm archive
                </Button>
                <Button
                  secondary
                  disabled={busy}
                  onPress={() => setConfirmArchive(false)}
                >
                  Keep event
                </Button>
              </>
            )}
          </>
        )}
      </View>
    </Sheet>
  );
}

export function SessionList({
  churchId,
  event,
  onSelect,
  disabled = false,
  checkIn = false,
}: {
  churchId: string;
  event: ChurchEvent;
  onSelect: (session: Occurrence) => void;
  disabled?: boolean;
  checkIn?: boolean;
}) {
  const [range, setRange] = useState("upcoming");
  const query = useAll<Occurrence>(
    churchPath(churchId, `events/${event.id}/occurrences`),
  );
  const today = DateTime.now()
    .setZone(event.timeZone)
    .startOf("day")
    .toMillis();
  const sessions = [...(query.data ?? [])]
    .filter(
      (session) => range === "all" || Date.parse(session.startsAt) >= today,
    )
    .sort(
      (first, second) =>
        Date.parse(first.startsAt) - Date.parse(second.startsAt),
    );
  return (
    <View style={styles.stack}>
      <Select
        label="Session dates"
        value={range}
        onChange={setRange}
        options={[
          { value: "upcoming", label: "Today & upcoming" },
          { value: "all", label: "All dates" },
        ]}
      />
      <QueryState
        pending={query.isPending}
        error={query.error}
        empty={!sessions.length}
        emptyText="No sessions in this range."
        onRetry={() => void query.refetch()}
      />
      <View>
        {sessions.map((session) => (
          <Row
            key={session.id}
            title={sessionTime(session.startsAt, event.timeZone)}
            subtitle={`Ends ${DateTime.fromISO(session.endsAt).setZone(event.timeZone).toFormat("h:mm a")} · ${event.timeZone}`}
            badge={
              session.cancelled
                ? "Cancelled"
                : session.overridden
                  ? "Rescheduled"
                  : undefined
            }
            icon="calendar-number-outline"
            disabled={
              disabled || (checkIn && (session.cancelled || !event.active))
            }
            onPress={() => onSelect(session)}
          />
        ))}
      </View>
    </View>
  );
}

function SessionEditor({
  event,
  occurrence,
  onClose,
  onBegin,
}: {
  event: ChurchEvent;
  occurrence: Occurrence;
  onClose: () => void;
  onBegin: (session: Occurrence) => void;
}) {
  const client = useQueryClient();
  const [current, setCurrent] = useState(occurrence);
  const initial = (session: Occurrence) => ({
    startsAt: DateTime.fromISO(session.startsAt)
      .setZone(event.timeZone)
      .toFormat("yyyy-MM-dd'T'HH:mm"),
    endsAt: DateTime.fromISO(session.endsAt)
      .setZone(event.timeZone)
      .toFormat("yyyy-MM-dd'T'HH:mm"),
    cancelled: session.cancelled,
  });
  const form = useForm({ defaultValues: initial(occurrence) });
  const editable = Date.parse(current.startsAt) > Date.now() && event.active;
  const save = useMutation({
    mutationFn: (values: ReturnType<typeof initial>) => {
      const startsAt = localToUtc(values.startsAt, event.timeZone);
      const endsAt = localToUtc(values.endsAt, event.timeZone);
      const duration = Date.parse(endsAt) - Date.parse(startsAt);
      if (
        Date.parse(startsAt) <= Date.now() ||
        duration <= 0 ||
        duration > 7 * 86400000
      )
        throw new Error(
          "Choose a future session with an end after its start and a duration of at most seven days.",
        );
      return api.save<Occurrence>(
        churchPath(event.churchId, `occurrences/${current.id}`),
        { startsAt, endsAt, cancelled: values.cancelled },
        current._etag,
      );
    },
    onSuccess: async (result) => {
      setCurrent(result);
      form.reset(initial(result));
      await client.invalidateQueries({
        queryKey: [
          churchPath(event.churchId, `events/${event.id}/occurrences`),
        ],
      });
    },
  });
  const reload = useMutation({
    mutationFn: () =>
      api.get<Occurrence>(
        churchPath(event.churchId, `occurrences/${current.id}`),
      ),
    onSuccess: (result) => {
      setCurrent(result);
      form.reset(initial(result));
      save.reset();
    },
  });
  const stale = save.error instanceof ApiError && save.error.status === 412;
  return (
    <Sheet
      title="Session details"
      dirty={form.formState.isDirty}
      busy={save.isPending || reload.isPending}
      onClose={onClose}
    >
      <View style={styles.stack}>
        <Heading>{event.name}</Heading>
        <Label muted>{event.timeZone}</Label>
        <Controller
          control={form.control}
          name="startsAt"
          render={({ field }) => (
            <DateField
              label="Starts at"
              time
              value={field.value}
              onChange={field.onChange}
              disabled={!editable || save.isPending}
            />
          )}
        />
        <Controller
          control={form.control}
          name="endsAt"
          render={({ field }) => (
            <DateField
              label="Ends at"
              time
              value={field.value}
              onChange={field.onChange}
              disabled={!editable || save.isPending}
            />
          )}
        />
        <Controller
          control={form.control}
          name="cancelled"
          render={({ field }) => (
            <Toggle
              label="Cancelled"
              value={field.value}
              onChange={field.onChange}
              disabled={!editable || save.isPending}
            />
          )}
        />
        {(save.error || reload.error) && (
          <Notice error>{message(save.error ?? reload.error)}</Notice>
        )}
        {stale && (
          <>
            <Label muted>
              Reloading replaces your draft with the latest session.
            </Label>
            <Button
              secondary
              busy={reload.isPending}
              onPress={() => reload.mutate()}
            >
              Reload latest version
            </Button>
          </>
        )}
        {save.isSuccess && <Notice>Session saved.</Notice>}
        {editable && (
          <Button
            icon="save-outline"
            busy={save.isPending}
            disabled={stale || reload.isPending}
            onPress={() =>
              void form.handleSubmit((values) => save.mutate(values))()
            }
          >
            Save session
          </Button>
        )}
        <Button
          icon="checkmark-circle-outline"
          disabled={
            current.cancelled ||
            !event.active ||
            form.formState.isDirty ||
            save.isPending ||
            reload.isPending
          }
          onPress={() => onBegin(current)}
        >
          Start check-in
        </Button>
      </View>
    </Sheet>
  );
}
