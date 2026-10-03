import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, useAll, useDebounce } from "../api/hooks";
import { message } from "../api/client";
import type { AppRole, Church, User } from "../api/types";
import { useRole } from "../auth/RoleContext";
import { assignableChurches, canManageUsers, filterManagedUsers } from "../auth/roles";
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
  Select,
  Sheet,
  styles,
  Toggle,
} from "../ui";

const userSchema = z
  .object({
    email: z.string().trim().email("Enter a valid email address."),
    displayName: z.string().trim().max(200).optional().or(z.literal("")),
    role: z.enum(["global-admin", "church-admin", "user"]),
    churchIds: z.array(z.string()),
  })
  .superRefine((values, ctx) => {
    // Global admins are implicitly associated with all churches; others need at least one.
    if (values.role !== "global-admin" && values.churchIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["churchIds"], message: "Assign at least one church." });
    }
  });
type UserFormValues = z.infer<typeof userSchema>;

function roleLabel(role: AppRole) {
  return role === "global-admin" ? "Global admin" : role === "church-admin" ? "Church admin" : "User";
}

export default function Users() {
  const router = useRouter();
  const client = useQueryClient();
  const { roleReady, roleInfo } = useRole();
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const usersQuery = useAll<User>("/users", includeArchived ? { includeArchived: true } : {});
  const churchesQuery = useAll<Church>("/churches");
  const churches = churchesQuery.data ?? [];
  const churchName = (id: string) => churches.find((church) => church.id === id)?.name ?? "Archived church";
  const debounced = useDebounce(search).toLowerCase();
  const visible = filterManagedUsers(usersQuery.data ?? [], roleInfo)
    .filter((user) =>
      debounced
        ? user.email.toLowerCase().includes(debounced) || (user.displayName ?? "").toLowerCase().includes(debounced)
        : true,
    )
    .toSorted((left, right) => {
      const byName = (left.displayName || left.email).localeCompare(right.displayName || right.email);
      return byName || left.email.localeCompare(right.email);
    });

  if (roleReady && !canManageUsers(roleInfo)) {
    return (
      <Page title="Users" eyebrow="Settings">
        <Notice>You need to be a global or church administrator to manage users.</Notice>
        <Button secondary onPress={() => router.back()}>
          Go back
        </Button>
      </Page>
    );
  }

  const singleChurchAdmin = roleInfo.kind === "provisioned" && roleInfo.churchIds.length === 1;
  return (
    <Page
      title="Users"
      eyebrow="Settings"
      onRefresh={() => void usersQuery.refetch()}
      refreshing={usersQuery.isRefetching}
      actions={
        <IconButton icon="add-outline" label="Invite user" onPress={() => setEditing("new")} />
      }
    >
      {!singleChurchAdmin && <SearchBox value={search} onChange={setSearch} placeholder="Search users" />}
      <Toggle
        compact
        label="Show archived"
        value={includeArchived}
        onChange={setIncludeArchived}
      />
      {!!notice && <Notice>{notice}</Notice>}
      <QueryState
        pending={!roleReady || usersQuery.isPending}
        error={usersQuery.error}
        empty={!visible.length}
        emptyText="No users yet. Invite one to get started."
        onRetry={() => void usersQuery.refetch()}
      />
      <View>
        {visible.map((user) => (
          <Row
            key={user.id}
            title={user.displayName || user.email}
            subtitle={`${user.email} · ${roleLabel(user.role)}${user.churchIds?.length ? ` · ${user.churchIds.map(churchName).join(", ")}` : ""}`}
            icon="person-outline"
            badge={user.active === false ? "Archived" : user.status === "invited" ? "Invited" : undefined}
            onPress={() => setEditing(user)}
          />
        ))}
      </View>
      {editing && (
        <UserEditor
          user={editing === "new" ? undefined : editing}
          churches={assignableChurches(churches, roleInfo)}
          invitedBy={roleInfo.kind === "global-admin" ? "admin" : (roleInfo.kind === "provisioned" ? roleInfo.user.email : "admin")}
          allowGlobalAdmin={roleInfo.kind === "global-admin"}
          onClose={() => setEditing(null)}
          onSaved={async (archived) => {
            setEditing(null);
            await client.invalidateQueries({ queryKey: ["/users"] });
            setNotice(archived ? "User archived." : "User saved.");
          }}
        />
      )}
    </Page>
  );
}

function UserEditor({
  user,
  churches,
  invitedBy,
  allowGlobalAdmin,
  onClose,
  onSaved,
}: {
  user?: User;
  churches: Church[];
  invitedBy: string;
  allowGlobalAdmin: boolean;
  onClose: () => void;
  onSaved: (archived: boolean) => void;
}) {
  const [confirmArchive, setConfirmArchive] = useState(false);
  const form = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      email: user?.email ?? "",
      displayName: user?.displayName ?? "",
      role: user?.role === "global-admin" || user?.role === "church-admin" ? user.role : "user",
      churchIds: user?.churchIds ?? [],
    },
  });
  const save = useMutation({
    mutationFn: (values: UserFormValues) =>
      api.save<User>(
        user ? `/users/${encodeURIComponent(user.email)}` : "/users",
        {
          email: values.email,
          role: values.role,
          churchIds: values.role === "global-admin" ? [] : values.churchIds,
          displayName: values.displayName || null,
          invitedBy: user?.invitedBy ?? invitedBy,
        },
        user?._etag,
      ),
    onSuccess: () => onSaved(false),
  });
  const archive = useMutation({
    mutationFn: () => api.archive(`/users/${encodeURIComponent(user!.email)}`, user!._etag),
    onSuccess: () => onSaved(true),
  });
  const error = save.error ?? archive.error;
  const busy = save.isPending || archive.isPending;
  const assigned = form.watch("churchIds");
  return (
    <Sheet
      title={user ? user.displayName || user.email : "Invite user"}
      dirty={form.formState.isDirty}
      busy={busy}
      onClose={onClose}
    >
      <View style={styles.stack}>
        {user?.active === false && <Notice>This user is archived.</Notice>}
        {user && (
          <Label small muted>
            Status: {user.status === "invited" ? "Invited (not yet signed in)" : "Active"}
          </Label>
        )}
        {!!error && <Notice error>{message(error)}</Notice>}
        <Controller control={form.control} name="email" render={({ field, fieldState }) => (
          <Field
            label="Email"
            required
            value={field.value}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            editable={!user && !busy}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        )} />
        <Controller control={form.control} name="displayName" render={({ field, fieldState }) => (
          <Field
            label="Display name"
            value={field.value ?? ""}
            onChangeText={field.onChange}
            error={fieldState.error?.message}
            editable={!busy}
          />
        )} />
        <Controller control={form.control} name="role" render={({ field }) => (
          <Select
            label="Role"
            required
            value={field.value}
            disabled={busy}
            onChange={(value) => {
              const role = value as UserFormValues["role"];
              field.onChange(role);
              if (role === "global-admin") form.setValue("churchIds", []);
            }}
            options={[
              { label: "User", value: "user" },
              { label: "Church admin", value: "church-admin" },
              ...(allowGlobalAdmin ? [{ label: "Global admin (all churches)", value: "global-admin" }] : []),
            ]}
          />
        )} />
        {form.watch("role") !== "global-admin" && (
          <Controller control={form.control} name="churchIds" render={({ field, fieldState }) => (
            <View>
              <Label small>Churches <Label small muted>(assign at least one)</Label></Label>
              {fieldState.error && <Label small muted>{fieldState.error.message}</Label>}
              {churches.map((church) => (
                <Toggle
                  key={church.id}
                  compact
                  label={church.name}
                  value={field.value.includes(church.id)}
                  disabled={busy}
                  onChange={(on) =>
                    field.onChange(on ? [...field.value, church.id] : field.value.filter((id) => id !== church.id))
                  }
                />
              ))}
            </View>
          )} />
        )}
        <Button busy={busy} onPress={form.handleSubmit((values) => save.mutate(values))}>
          {user ? "Save changes" : "Send invite"}
        </Button>
        {user?.active !== false && user && !confirmArchive && (
          <Button secondary onPress={() => setConfirmArchive(true)}>
            Archive user
          </Button>
        )}
        {confirmArchive && (
          <View style={styles.stack}>
            <Notice>Archive this user? Their record is retained but they lose access.</Notice>
            <Button danger busy={busy} onPress={() => archive.mutate()}>
              Confirm archive
            </Button>
            <Button secondary onPress={() => setConfirmArchive(false)}>
              Cancel
            </Button>
          </View>
        )}
      </View>
    </Sheet>
  );
}
