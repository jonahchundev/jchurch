import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, churchPath, useAll } from "../api/hooks";
import { ApiError, message } from "../api/client";
import type { CustomField } from "../api/types";
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
} from "../ui";

const fieldSchema = z.object({
  name: z.string().trim().min(1, "Field name is required.").max(200),
  fieldType: z.enum(["text", "number", "boolean", "date"]),
});
type FieldValues = z.infer<typeof fieldSchema>;
const typeLabels: Record<FieldValues["fieldType"], string> = {
  text: "Text",
  number: "Number",
  boolean: "Yes / No",
  date: "Date",
};

export default function CustomFields() {
  const { churchId } = useLocalSearchParams<{ churchId: string }>();
  return <ChurchCustomFields key={churchId} churchId={churchId} />;
}

function ChurchCustomFields({ churchId }: { churchId: string }) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CustomField | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const path = churchPath(churchId, "custom-fields");
  const query = useAll<CustomField>(path, { includeArchived: true });
  const fields = query.data ?? [];
  const visible = fields.filter((field) =>
    field.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <Page
      title="Custom fields"
      eyebrow="Settings"
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      actions={
        <IconButton
          icon="add-outline"
          label="Add custom field"
          onPress={() => setEditing("new")}
        />
      }
    >
      <SearchBox
        value={search}
        onChange={setSearch}
        placeholder="Search custom fields"
      />
      {!!notice && <Notice>{notice}</Notice>}
      <QueryState
        pending={query.isPending}
        error={query.error}
        empty={!visible.length}
        emptyText={search ? "No custom fields found." : "No custom fields defined."}
        onRetry={() => void query.refetch()}
      />
      <View>
        {visible.map((field) => (
          <Row
            key={field.id}
            title={field.name}
            subtitle={typeLabels[field.fieldType]}
            icon="document-text-outline"
            badge={field.active ? undefined : "Archived"}
            onPress={() => setEditing(field)}
          />
        ))}
      </View>
      <Button icon="add-outline" onPress={() => setEditing("new")}>
        Add custom field
      </Button>
      {editing && (
        <CustomFieldEditor
          churchId={churchId}
          field={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={async (archived) => {
            setEditing(null);
            setNotice(archived ? "Custom field archived." : "Custom field saved.");
            await client.invalidateQueries({
              queryKey: [churchPath(churchId, "custom-fields")],
            });
          }}
        />
      )}
    </Page>
  );
}

function CustomFieldEditor({
  churchId,
  field,
  onClose,
  onSaved,
}: {
  churchId: string;
  field?: CustomField;
  onClose: () => void;
  onSaved: (archived: boolean) => void;
}) {
  const [current, setCurrent] = useState(field);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const form = useForm<FieldValues>({
    resolver: zodResolver(fieldSchema),
    defaultValues: { name: field?.name ?? "", fieldType: field?.fieldType ?? "text" },
  });
  const save = useMutation({
    mutationFn: (values: FieldValues) =>
      api.save<CustomField>(
        churchPath(churchId, `custom-fields${current ? `/${current.id}` : ""}`),
        {
          name: values.name,
          fieldType: current?.fieldType ?? values.fieldType,
        },
        current?._etag,
      ),
    onSuccess: () => onSaved(false),
  });
  const archive = useMutation({
    mutationFn: () =>
      api.archive(churchPath(churchId, `custom-fields/${current!.id}`), current!._etag),
    onSuccess: () => onSaved(true),
  });
  const reload = useMutation({
    mutationFn: () => api.get<CustomField>(churchPath(churchId, `custom-fields/${current!.id}`)),
    onSuccess: (result) => {
      setCurrent(result);
      form.reset({ name: result.name, fieldType: result.fieldType });
      save.reset();
      archive.reset();
      setConfirmArchive(false);
    },
  });
  const error = save.error ?? archive.error ?? reload.error;
  const busy = save.isPending || archive.isPending || reload.isPending;
  const stale = error instanceof ApiError && error.status === 412;
  const locked = busy || stale || !!current && !current.active;
  return (
    <Sheet
      title={current ? "Edit custom field" : "Add custom field"}
      dirty={form.formState.isDirty}
      busy={busy}
      onClose={onClose}
    >
      <View style={styles.stack}>
        <Controller
          control={form.control}
          name="name"
          render={({ field: input, fieldState }) => (
            <Field
              label="Field name"
              value={input.value}
              onChangeText={input.onChange}
              onBlur={input.onBlur}
              editable={!locked}
              maxLength={200}
              error={fieldState.error?.message}
              required
            />
          )}
        />
        <Controller
          control={form.control}
          name="fieldType"
          render={({ field: input }) => (
            <Select
              label="Field type"
              value={input.value}
              onChange={input.onChange}
              disabled={!!current || locked}
              required
              options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))}
            />
          )}
        />
        {current && <Label muted>Field type cannot change after creation.</Label>}
        {current && !current.active && <Notice>This custom field is archived.</Notice>}
        {error && <Notice error>{message(error)}</Notice>}
        {stale && current && (
          <>
            <Label muted>Reloading replaces your draft with the latest saved field.</Label>
            <Button secondary busy={reload.isPending} onPress={() => reload.mutate()}>
              Reload latest version
            </Button>
          </>
        )}
        <Button
          icon="save-outline"
          busy={save.isPending}
          disabled={locked}
          onPress={() => void form.handleSubmit((values) => save.mutate(values))()}
        >
          Save custom field
        </Button>
        {current?.active && !confirmArchive && (
          <Button danger icon="archive-outline" disabled={locked} onPress={() => setConfirmArchive(true)}>
            Archive custom field
          </Button>
        )}
        {confirmArchive && current && (
          <>
            <Notice error>Archive {current.name}? Existing member values are retained, but this field will no longer appear for new entry. This cannot be undone.</Notice>
            <Button danger busy={archive.isPending} disabled={busy} onPress={() => archive.mutate()}>
              Confirm archive
            </Button>
            <Button secondary disabled={busy} onPress={() => setConfirmArchive(false)}>
              Keep custom field
            </Button>
          </>
        )}
      </View>
    </Sheet>
  );
}