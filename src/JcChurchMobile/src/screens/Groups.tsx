import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, churchPath, useAll } from "../api/hooks";
import { ApiError, message } from "../api/client";
import type { Group } from "../api/types";
import { nameSchema } from "../domain";
import GroupsImportExport from "./GroupsImportExport";
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
  styles,
} from "../ui";

type Editing =
  | { mode: "new"; parent?: Group }
  | { mode: "edit"; group: Group }
  | null;
type GroupFormValues = { name: string };

function groupLabel(group: Group, groups: Group[]) {
  if (!group.parentGroupId) return group.name;
  const parent = groups.find((candidate) => candidate.id === group.parentGroupId);
  return `${parent?.name ?? "Group"} / ${group.name}`;
}

export default function Groups() {
  const { churchId } = useLocalSearchParams<{ churchId: string }>();
  return <ChurchGroups key={churchId} churchId={churchId} />;
}

function ChurchGroups({ churchId }: { churchId: string }) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState("");
  const [importExportOpen, setImportExportOpen] = useState(false);
  const path = churchPath(churchId, "groups");
  const query = useAll<Group>(path, { includeArchived: true });
  const groups = query.isSuccess ? query.data : [];
  const term = search.trim().toLocaleLowerCase();
  const matches = (group: Group) => group.name.toLocaleLowerCase().includes(term);
  const byName = (a: Group, b: Group) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const childrenByParent = new Map<string, Group[]>();
  for (const group of groups) {
    if (!group.parentGroupId) continue;
    const children = childrenByParent.get(group.parentGroupId) ?? [];
    children.push(group);
    childrenByParent.set(group.parentGroupId, children);
  }
  for (const children of childrenByParent.values()) children.sort(byName);
  const topLevel = groups.filter(group => !group.parentGroupId &&
    (matches(group) || childrenByParent.get(group.id)?.some(matches))).sort(byName);
  return (
    <Page
      title="Groups"
      eyebrow="Settings"
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      actions={
        <>
        <IconButton
          icon="swap-vertical-outline"
          label="Import or export CSV"
          onPress={() => setImportExportOpen(true)}
        />
        <IconButton
          icon="refresh-outline"
          label="Refresh groups"
          disabled={query.isFetching}
          onPress={() => { setNotice(""); void query.refetch(); }}
        />
        <IconButton
          icon="add-outline"
          label="Add group"
          onPress={() => setEditing({ mode: "new" })}
        />
        </>
      }
    >
      <SearchBox value={search} onChange={setSearch} placeholder="Search groups" />
      {!!notice && <Notice>{notice}</Notice>}
      <QueryState
        pending={query.isPending}
        error={query.error}
        empty={!topLevel.length}
        emptyText={term ? "No groups found." : "No groups defined."}
        onRetry={() => void query.refetch()}
      />
      <View>
        {topLevel.map((group) => {
          const children = (childrenByParent.get(group.id) ?? [])
            .filter(child => matches(group) || matches(child));
          return (
            <View key={group.id}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Row
                    title={group.name}
                    subtitle={group.active ? "Top-level group" : "Archived group"}
                    icon="albums-outline"
                    badge={group.active ? undefined : "Archived"}
                    onPress={() => setEditing({ mode: "edit", group })}
                  />
                </View>
                {group.active && (
                    <IconButton
                      icon="add-circle-outline"
                      label={`Add subgroup under ${group.name}`}
                      onPress={() => setEditing({ mode: "new", parent: group })}
                    />
                )}
              </View>
              {children.map((child) => (
                <View key={child.id} style={{ paddingLeft: 32 }}>
                  <Row
                    title={child.name}
                    subtitle={child.active ? group.name : `${group.name} · Archived subgroup`}
                    icon="return-down-forward-outline"
                    badge={child.active ? undefined : "Archived"}
                    onPress={() => setEditing({ mode: "edit", group: child })}
                  />
                </View>
              ))}
            </View>
          );
        })}
      </View>
      <Button icon="add-outline" onPress={() => setEditing({ mode: "new" })}>
        Add group
      </Button>
      {editing && (
        <GroupEditor
          churchId={churchId}
          editing={editing}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={async (archived) => {
            setEditing(null);
            setNotice(archived ? "Group archived." : "Group saved.");
            await client.invalidateQueries({ queryKey: [path] });
          }}
        />
      )}
      {importExportOpen && (
        <GroupsImportExport
          churchId={churchId}
          onClose={() => setImportExportOpen(false)}
          onImported={() => void client.invalidateQueries({ queryKey: [path] })}
        />
      )}
    </Page>
  );
}

function GroupEditor({
  churchId,
  editing,
  groups,
  onClose,
  onSaved,
}: {
  churchId: string;
  editing: Exclude<Editing, null>;
  groups: Group[];
  onClose: () => void;
  onSaved: (archived: boolean) => void;
}) {
  const client = useQueryClient();
  const current = editing.mode === "edit" ? editing.group : undefined;
  const parent = editing.mode === "new" ? editing.parent : undefined;
  const [latest, setLatest] = useState(current);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const form = useForm<GroupFormValues>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: current?.name ?? "" },
  });
  const save = useMutation({
    mutationFn: (values: GroupFormValues) =>
      api.save<Group>(
        churchPath(churchId, `groups${latest ? `/${latest.id}` : ""}`),
        {
          name: values.name,
          parentGroupId: latest?.parentGroupId ?? parent?.id ?? null,
        },
        latest?._etag,
      ),
    onSuccess: () => onSaved(false),
  });
  const archive = useMutation({
    mutationFn: () => api.archive(churchPath(churchId, `groups/${latest!.id}`), latest!._etag),
    onSuccess: () => onSaved(true),
  });
  const reload = useMutation({
    mutationFn: () => api.get<Group>(churchPath(churchId, `groups/${latest!.id}`)),
    onSuccess: (result) => {
      setLatest(result);
      form.reset({ name: result.name });
      save.reset();
      archive.reset();
      setConfirmArchive(false);
      void client.invalidateQueries({ queryKey: [churchPath(churchId, "groups")] });
    },
  });
  const error = save.error ?? archive.error ?? reload.error;
  const busy = save.isPending || archive.isPending || reload.isPending;
  const stale = error instanceof ApiError && error.status === 412;
  const uncertain = error instanceof ApiError && error.uncertain;
  const locked = busy || stale || uncertain || (!!latest && !latest.active);
  const groupType = latest?.parentGroupId || parent ? "subgroup" : "group";
  const saveLabel = `Save ${groupType}`;
  const archiveLabel = `Archive ${groupType}`;
  const keepLabel = `Keep ${groupType}`;
  const parentName = latest?.parentGroupId
    ? groups.find(group => group.id === latest.parentGroupId)?.name ?? "Group"
    : parent?.name;
  return (
    <Sheet
      title={latest ? `Edit ${groupType}` : parent ? "Add subgroup" : "Add group"}
      dirty={form.formState.isDirty}
      busy={busy}
      onClose={onClose}
    >
      <View style={styles.stack}>
        {!!parentName && <Label muted>{`Parent group: ${parentName}`}</Label>}
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field
              label={groupType === "subgroup" ? "Subgroup name" : "Group name"}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              editable={!locked}
              maxLength={200}
              error={fieldState.error?.message}
              required
            />
          )}
        />
        {latest && !latest.active && <Notice>This {groupType} is archived.</Notice>}
        {error && <Notice error>{message(error)}</Notice>}
        {(stale || uncertain) && latest && (
          <>
            <Label muted>Reloading replaces your draft with the latest saved group.</Label>
            <Button secondary busy={reload.isPending} onPress={() => reload.mutate()}>
              Reload latest version
            </Button>
          </>
        )}
        {uncertain && (
          <Notice error>{latest
            ? "Confirmation pending. Reload the saved group before making another change."
            : "Creation could not be confirmed. Close this draft and refresh the groups list before creating another group."}</Notice>
        )}
        <Button
          icon="save-outline"
          busy={save.isPending}
          disabled={locked}
          onPress={() => void form.handleSubmit((value) => save.mutate(value))()}
        >
          {saveLabel}
        </Button>
        {latest?.active && !confirmArchive && (
          <Button
            danger
            disabled={locked}
            icon="archive-outline"
            onPress={() => setConfirmArchive(true)}
          >
            {archiveLabel}
          </Button>
        )}
        {confirmArchive && latest && (
          <>
            <Notice error>{`Archive ${groupLabel(latest, groups)}? Existing memberships and attendance history are retained. It will no longer be available for new assignments. Archive active subgroups before their parent. This cannot be undone.`}</Notice>
            <Button
              danger
              busy={archive.isPending}
              disabled={locked}
              onPress={() => archive.mutate()}
            >
              Confirm archive
            </Button>
            <Button
              secondary
              disabled={busy}
              onPress={() => setConfirmArchive(false)}
            >
              {keepLabel}
            </Button>
          </>
        )}
      </View>
    </Sheet>
  );
}