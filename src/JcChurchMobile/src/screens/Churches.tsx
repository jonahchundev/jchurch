import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, churchPath, useAll, useDebounce, useList } from "../api/hooks";
import { ApiError, message } from "../api/client";
import type { Church } from "../api/types";
import { churchSchema } from "../domain";
import { useAuth } from "../auth/AuthContext";
import { useRole } from "../auth/RoleContext";
import { canManageUsers, filterChurches } from "../auth/roles";
import {
  Button,
  Field,
  IconButton,
  Label,
  Notice,
  Page,
  QueryState,
  Row,
  SearchBox,
  Sheet,
  Select,
  styles,
  Toggle,
  UserChip,
} from "../ui";

const lastKey = "jchurch:last-church-id";
export default function Churches({ manage = false }: { manage?: boolean }) {
  const router = useRouter();
  const { logout, user } = useAuth();
  const { roleReady, roleInfo } = useRole();
  const { selected } = useLocalSearchParams<{ selected?: string }>();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const [editing, setEditing] = useState<Church | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const isGlobalAdmin = roleInfo.kind === "global-admin";
  const debouncedSearch = useDebounce(search);
  // Global admins keep the paginated directory; other roles load all and filter client-side.
  const listQuery = useList<Church>("/churches", {
    search: debouncedSearch,
    ...(manage ? { includeArchived: true } : {}),
  });
  const allQuery = useAll<Church>("/churches", manage ? { includeArchived: true } : {});
  const usePaged = isGlobalAdmin;
  const baseChurches = usePaged
    ? (listQuery.data?.pages.flatMap((page) => page.items) ?? [])
    : (allQuery.data ?? []);
  const churches = usePaged ? baseChurches : filterChurches(baseChurches, roleInfo).filter((church) =>
    debouncedSearch ? church.name.toLowerCase().includes(debouncedSearch.toLowerCase()) : true,
  );
  const query = usePaged ? listQuery : allQuery;
  const unprovisioned = roleReady && roleInfo.kind === "unprovisioned";
  const singleChurchUser = roleInfo.kind === "provisioned" && roleInfo.churchIds.length === 1;
  const displayName = user?.name ?? user?.email ?? (user?.provider === "google" ? "Google account" : "Admin");
  async function handleLogout() {
    await client.cancelQueries();
    client.clear();
    await logout();
    router.replace("/login");
  }
  const autoSelected = useRef(false);
  useEffect(() => {
    // Users tied to exactly one church skip the chooser entirely.
    if (manage || autoSelected.current || !roleReady || !allQuery.isSuccess) return;
    const assigned = filterChurches(allQuery.data ?? [], roleInfo);
    if (assigned.length === 1 && assigned[0]) {
      autoSelected.current = true;
      void select(assigned[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manage, roleReady, allQuery.isSuccess, allQuery.data, roleInfo]);
  useEffect(() => {
    void AsyncStorage.getItem(lastKey)
      .then(setLast)
      .catch(() => {});
  }, []);
  async function select(church: Church) {
    await client.cancelQueries();
    client.clear();
    void AsyncStorage.setItem(lastKey, church.id).catch(() => {});
    router.push(`/church/${church.id}`);
  }
  // While the single-church auto-select is routing, render a quiet loading page
  // instead of flashing the chooser.
  const autoSelecting = !manage && autoSelected.current;
  return (
    <Page
      title={autoSelecting ? "Loading your church" : manage ? "Manage churches" : "Choose your church"}
      eyebrow={manage ? "Settings" : "Church directory"}
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      actions={
        manage ? (
          isGlobalAdmin ? (
            <IconButton
              icon="add-outline"
              label="Create church"
              onPress={() => setEditing("new")}
            />
          ) : undefined
        ) : (
          <UserChip name={displayName} picture={user?.picture} onPress={() => router.push("/settings")} />
        )
      }
    >
      {!autoSelecting && !(manage && singleChurchUser) && (
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search churches"
        />
      )}
      {manage && user && (
        <Row
          title={displayName}
          subtitle={user.name && user.email ? user.email : user.provider === "google" ? "Signed in with Google" : "Temporary admin login"}
          icon={user.provider === "google" ? "logo-google" : "person-outline"}
          trailing={
            <Button danger onPress={() => void handleLogout()}>
              Log out
            </Button>
          }
        />
      )}
      {manage && selected && (
        <Row
          title="Manage custom fields"
          subtitle="Extra details collected for members"
          icon="document-text-outline"
          onPress={() => router.navigate(`/church/${selected}/custom-fields`)}
        />
      )}
      {manage && selected && canManageUsers(roleInfo) && (
        <Row
          title="Clean up duplicate members"
          subtitle="Find and merge repeated registrations"
          icon="copy-outline"
          onPress={() => router.navigate(`/church/${selected}/duplicates`)}
        />
      )}
      {manage && canManageUsers(roleInfo) && (
        <Row
          title="Manage users"
          subtitle="Invite users and assign church access"
          icon="people-outline"
          onPress={() => router.push("/users")}
        />
      )}
      {!!notice && <Notice>{notice}</Notice>}
      {unprovisioned && (
        <Notice>
          Your account is not associated with any church yet. Ask an administrator to invite you.
        </Notice>
      )}
      <QueryState
        pending={!roleReady || query.isPending || autoSelecting}
        error={query.error}
        empty={!churches.length}
        emptyText={unprovisioned ? "No churches assigned." : manage ? "No churches yet." : "No churches found."}
        onRetry={() => void query.refetch()}
      />
      {!autoSelecting && (
        <View>
          {churches.map((church) => (
            <Row
              key={church.id}
              title={church.name}
              icon="business-outline"
              badge={church.active === false ? "Archived" : last === church.id ? "Last selected" : undefined}
              subtitle={manage ? "Church settings" : undefined}
              onPress={() => (manage ? setEditing(church) : void select(church))}
            />
          ))}
        </View>
      )}
      {!autoSelecting && isGlobalAdmin && listQuery.hasNextPage && (
        <Button
          secondary
          busy={listQuery.isFetchingNextPage}
          onPress={() => void listQuery.fetchNextPage()}
        >
          Load more churches
        </Button>
      )}
      {manage && isGlobalAdmin && (
        <Button icon="add-outline" onPress={() => setEditing("new")}>
          Create church
        </Button>
      )}
      {editing && isGlobalAdmin && (
        <ChurchEditor
          church={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={async (archived, church) => {
            setEditing(null);
            if (archived) {
              if (last === church?.id) {
                setLast(null);
                void AsyncStorage.removeItem(lastKey).catch(() => {});
              }
              if (selected === church?.id) {
                await client.cancelQueries();
                client.clear();
                router.dismissAll();
                router.replace("/");
                return;
              }
              const archivedPath = churchPath(church!.id);
              const filters = {
                predicate: (query: { queryKey: readonly unknown[] }) =>
                  typeof query.queryKey[0] === "string" &&
                  (query.queryKey[0] === archivedPath ||
                    query.queryKey[0].startsWith(`${archivedPath}/`)),
              };
              await client.cancelQueries(filters);
              client.removeQueries(filters);
              await client.invalidateQueries({ queryKey: ["/churches"] });
            } else await client.invalidateQueries();
            setNotice(archived ? "Church archived." : "Church saved.");
          }}
        />
      )}
    </Page>
  );
}

function ChurchEditor({
  church,
  onClose,
  onSaved,
}: {
  church?: Church;
  onClose: () => void;
  onSaved: (archived: boolean, church?: Church) => void;
}) {
  const [current, setCurrent] = useState(church);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const form = useForm<{ name: string; newMemberDays: string; scanCodesEnabled: boolean; scanCodeFormat: "qr" | "code128" }>({
    resolver: zodResolver(churchSchema),
    defaultValues: { name: church?.name ?? "", newMemberDays: String(church?.newMemberDays ?? 6), scanCodesEnabled: church?.scanCodesEnabled ?? true, scanCodeFormat: church?.scanCodeFormat ?? "qr" },
  });
  const save = useMutation({
    mutationFn: (value: { name: string; newMemberDays: string; scanCodesEnabled: boolean; scanCodeFormat: "qr" | "code128" }) =>
      api.save<Church>(
        current ? churchPath(current.id) : "/churches",
        { ...value, newMemberDays: Number(value.newMemberDays) },
        current?._etag,
      ),
    onSuccess: (result) => onSaved(false, result),
  });
  const archive = useMutation({
    mutationFn: () => api.archive(churchPath(current!.id), current!._etag),
    onSuccess: () => onSaved(true, current),
  });
  const purge = useMutation({
    mutationFn: () => api.purge(churchPath(current!.id, "purge"), current!._etag),
    onSuccess: () => onSaved(true, current),
  });
  const reload = useMutation({
    mutationFn: () => api.get<Church>(churchPath(current!.id)),
    onSuccess: (result) => {
      setCurrent(result);
      form.reset({ name: result.name, newMemberDays: String(result.newMemberDays ?? 6), scanCodesEnabled: result.scanCodesEnabled ?? true, scanCodeFormat: result.scanCodeFormat ?? "qr" });
      save.reset();
      archive.reset();
      setConfirmArchive(false);
    },
  });
  const error = save.error ?? archive.error ?? purge.error ?? reload.error;
  const busy = save.isPending || archive.isPending || purge.isPending || reload.isPending;
  return (
    <Sheet
      title={current ? "Church settings" : "Create church"}
      onClose={onClose}
      dirty={form.formState.isDirty}
      busy={busy}
    >
      <View style={styles.stack}>
        <Controller
          control={form.control}
          name="scanCodesEnabled"
          render={({ field }) => (
            <Toggle label="Use QR/barcode scanning and member cards" value={field.value} onChange={field.onChange} disabled={busy} />
          )}
        />
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field
              label="Church name"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              maxLength={200}
              error={fieldState.error?.message}
              editable={!busy}
              required
            />
          )}
        />
        <Controller
          control={form.control}
          name="newMemberDays"
          render={({ field, fieldState }) => (
            <Field
              label="New-member indicator window (days)"
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              keyboardType="number-pad"
              maxLength={4}
              error={fieldState.error?.message}
              editable={!busy}
            />
          )}
        />
        <Controller
          control={form.control}
          name="scanCodeFormat"
          render={({ field, fieldState }) => (
            <Select
              label="Member card and scan format"
              value={field.value}
              onChange={field.onChange}
              disabled={busy}
              required
              options={[{ value: "qr", label: "QR code" }, { value: "code128", label: "Barcode (Code 128)" }]}
            />
          )}
        />
        {error && <Notice error>{message(error)}</Notice>}
        {error instanceof ApiError && error.status === 412 && (
          <>
            <Label muted>
              Reloading replaces your draft with the latest saved name.
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
        <Button
          icon="save-outline"
          busy={save.isPending}
          disabled={busy || (error instanceof ApiError && error.status === 412)}
          onPress={() =>
            void form.handleSubmit((value) => save.mutate(value))()
          }
        >
          Save church
        </Button>
        {current && !confirmArchive && (
          <Button
            danger
            disabled={busy}
            icon="trash-outline"
            onPress={() => setConfirmArchive(true)}
          >
            Delete church
          </Button>
        )}
        {confirmArchive && (
          <>
            <Notice
              error
            >{`Archive ${current?.name}? It will be removed from active selection and new check-ins will be blocked. Records and attendance history are retained. There is no restore operation.`}</Notice>
            <Button
              danger
              busy={archive.isPending}
              disabled={
                busy || (error instanceof ApiError && error.status === 412)
              }
              onPress={() => archive.mutate()}
            >
              Archive church
            </Button>
            <Button
              secondary
              disabled={busy}
              onPress={() => setConfirmArchive(false)}
            >
              Keep church
            </Button>
          </>
        )}
        {current && current.active === false && !confirmPurge && (
          <Button
            danger
            disabled={busy}
            icon="nuclear-outline"
            onPress={() => setConfirmPurge(true)}
          >
            Permanently delete church
          </Button>
        )}
        {confirmPurge && (
          <>
            <Notice
              error
            >{`Permanently delete ${current?.name} and ALL its groups, members, events, and attendance history? This cannot be undone.`}</Notice>
            <Button
              danger
              busy={purge.isPending}
              disabled={
                busy || (error instanceof ApiError && error.status === 412)
              }
              onPress={() => purge.mutate()}
            >
              Permanently delete
            </Button>
            <Button
              secondary
              disabled={busy}
              onPress={() => setConfirmPurge(false)}
            >
              Cancel
            </Button>
          </>
        )}
      </View>
    </Sheet>
  );
}
