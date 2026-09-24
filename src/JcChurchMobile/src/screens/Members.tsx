import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, churchPath, useAll, useDebounce, useList } from "../api/hooks";
import { ApiError, message } from "../api/client";
import type { Church, CustomField, Group, Member } from "../api/types";
import { memberInput, memberSchema, normalizeScanCode, type MemberFormValues } from "../domain";
import { generateScanCode, ScanCard, ScanInput } from "../ScanCode";
import MembersImportExport from "./MembersImportExport";
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
  ViewTabs,
} from "../ui";

export const memberName = (member: Member) =>
  [member.firstName, member.middleName, member.lastName]
    .filter(Boolean)
    .join(" ");
export function groupNames(member: Member, groups: Group[]) {
  return (member.groupIds ?? [])
    .map((id) => {
      const group = groups.find((candidate) => candidate.id === id);
      if (!group) return "Archived group";
      if (!group.parentGroupId) return group.name;
      const parent = groups.find(
        (candidate) => candidate.id === group.parentGroupId,
      );
      return `${parent?.name ?? "Group"} / ${group.name}`;
    })
    .join(" / ");
}

export default function Members() {
  const { churchId, search: focusSearch } = useLocalSearchParams<{
    churchId: string;
    search?: string;
  }>();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState("");
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [importExportOpen, setImportExportOpen] = useState(false);
  useFocusEffect(useCallback(() => () => setNotice(""), []));
  const path = churchPath(churchId, "members");
  const query = useList<Member>(path, {
    search: useDebounce(search),
    groupId: groupId || undefined,
  });
  const groups = useAll<Group>(churchPath(churchId, "groups"), {
    includeArchived: true,
  });
  const fields = useAll<CustomField>(churchPath(churchId, "custom-fields"), {
    includeArchived: true,
  });
  const members = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Page
      title="Members"
      eyebrow="Directory"
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
            icon="person-add-outline"
            label="Add member"
            onPress={() => setEditing("new")}
          />
        </>
      }
    >
      <SearchBox
        key={focusSearch}
        autoFocus={focusSearch === "1"}
        value={search}
        onChange={setSearch}
        placeholder="Search members"
      />
      <Select
        label="Group or subgroup"
        value={groupId}
        onChange={setGroupId}
        options={[
          { value: "", label: "All groups" },
          ...(groups.data ?? [])
            .filter((group) => group.active)
            .map((group) => ({
              value: group.id,
              label: group.parentGroupId
                ? `${groups.data?.find((parent) => parent.id === group.parentGroupId)?.name ?? "Group"} / ${group.name}`
                : group.name,
            })),
        ]}
      />
      {!!notice && <Notice>{notice}</Notice>}
      {(groups.error || fields.error) && (
        <Notice error>{message(groups.error ?? fields.error)}</Notice>
      )}
      <QueryState
        pending={query.isPending}
        error={query.error}
        empty={!members.length}
        emptyText="No members found."
        onRetry={() => void query.refetch()}
      />
      <View>
        {members.map((member) => (
          <Row
            key={member.id}
            title={memberName(member)}
            subtitle={
              groupNames(member, groups.data ?? []) ||
              member.school ||
              undefined
            }
            icon="person-outline"
            onPress={() => setEditing(member)}
          />
        ))}
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
      {editing && (
        <MemberDetails
          member={editing === "new" ? undefined : editing}
          churchId={churchId}
          onClose={() => setEditing(null)}
          onSaved={async (archived) => {
            setEditing(null);
            setNotice(archived ? "Member archived." : "Member saved.");
            await client.invalidateQueries({ queryKey: [path] });
          }}
        />
      )}
      {importExportOpen && (
        <MembersImportExport
          churchId={churchId}
          onClose={() => setImportExportOpen(false)}
          onImported={() => void client.invalidateQueries({ queryKey: [path] })}
        />
      )}
    </Page>
  );
}

function defaults(member?: Member): MemberFormValues {
  return {
    memberType: member?.memberType ?? "child",
    allergyDetail: member?.allergyDetail ?? "",
    scanCode: member?.scanCode ?? "",
    scanCodeFormat: member?.scanCodeFormat ?? "qr",
    firstName: member?.firstName ?? "",
    lastName: member?.lastName ?? "",
    middleName: member?.middleName ?? "",
    birthDate: member?.birthDate ?? "",
    school: member?.school ?? "",
    phone: member?.phone ?? "",
    email: member?.email ?? "",
    guardian1: member?.guardian1
      ? { ...member.guardian1, middleName: member.guardian1.middleName ?? "", otherRelationship: member.guardian1.otherRelationship ?? "" }
      : member?.memberType === "adult"
        ? undefined
        : { firstName: "", middleName: "", lastName: "", relationship: "Mother", otherRelationship: "", phone: "", email: "" },
    guardian2: member?.guardian2 ? { ...member.guardian2, middleName: member.guardian2.middleName ?? "", otherRelationship: member.guardian2.otherRelationship ?? "" } : undefined,
    groupIds: member?.groupIds ?? [],
    customFields: member?.customFields ?? {},
  };
}

function MemberDetails(props: Parameters<typeof MemberEditor>[0]) {
  const detail = useQuery({
    queryKey: [churchPath(props.churchId, `members/${props.member?.id}`)],
    queryFn: ({ signal }) => api.get<Member>(churchPath(props.churchId, `members/${props.member!.id}`), signal),
    enabled: !!props.member,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  if (props.member && (!detail.data || detail.error || detail.isFetching))
    return <Sheet title="Member" onClose={props.onClose}>
      <QueryState pending={detail.isFetching} error={detail.error} empty={false} onRetry={() => void detail.refetch()} />
    </Sheet>;
  return <MemberEditor {...props} member={props.member ? detail.data : undefined} />;
}

function GuardianFields({
  control,
  prefix,
  relationship,
  disabled,
}: {
  control: Control<MemberFormValues>;
  prefix: "guardian1" | "guardian2";
  relationship?: string;
  disabled: boolean;
}) {
  const fields = [
    ["firstName", "First name"],
    ["middleName", "Middle name"],
    ["lastName", "Last name"],
    ["phone", "Phone number"],
    ["email", "Email address"],
  ] as const;
  return <>
    {fields.map(([name, label]) => (
      <Controller
        key={`${prefix}.${name}`}
        control={control}
        name={`${prefix}.${name}` as "guardian1.firstName"}
        render={({ field, fieldState }) => (
          <Field
            label={label}
            value={field.value ?? ""}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            editable={!disabled}
            autoCapitalize={name === "email" ? "none" : "words"}
            keyboardType={name === "email" ? "email-address" : name === "phone" ? "phone-pad" : "default"}
            error={fieldState.error?.message}
            required={name !== "middleName"}
          />
        )}
      />
    ))}
    <Controller
      control={control}
      name={`${prefix}.relationship` as "guardian1.relationship"}
      render={({ field, fieldState }) => (
        <View>
          <Select
            label="Relationship to child"
            value={field.value ?? "Mother"}
            disabled={disabled}
            onChange={field.onChange}
            required
            options={[
              { value: "Mother", label: "Mother" },
              { value: "Father", label: "Father" },
              { value: "Grandmother", label: "Grandmother" },
              { value: "Grandfather", label: "Grandfather" },
              { value: "Others", label: "Others" },
            ]}
          />
          {!!fieldState.error && <Notice error>{fieldState.error.message}</Notice>}
        </View>
      )}
    />
    {relationship === "Others" && <Controller
      control={control}
      name={`${prefix}.otherRelationship` as "guardian1.otherRelationship"}
      render={({ field, fieldState }) => (
        <Field label="Other relationship" value={field.value ?? ""} onChangeText={field.onChange} onBlur={field.onBlur} editable={!disabled} maxLength={50} error={fieldState.error?.message} />
      )}
    />}
  </>;
}

function MemberEditor({
  member,
  churchId,
  onClose,
  onSaved,
}: {
  member?: Member;
  churchId: string;
  onClose: () => void;
  onSaved: (archived: boolean) => void;
}) {
  const [current, setCurrent] = useState(member);
  const [editing, setEditing] = useState(!member);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [guardian2Enabled, setGuardian2Enabled] = useState(!!member?.guardian2);
  const [replacement, setReplacement] = useState<MemberFormValues | null>(null);
  const church = useQuery({
    queryKey: [churchPath(churchId)],
    queryFn: ({ signal }) => api.get<Church>(churchPath(churchId), signal),
  });
  const churchScanFormat = church.data?.scanCodeFormat ?? "qr";
  const churchScanEnabled = church.data?.scanCodesEnabled ?? true;
  const groups = useAll<Group>(churchPath(churchId, "groups"), {
    includeArchived: true,
  });
  const definitions = useAll<CustomField>(
    churchPath(churchId, "custom-fields"),
    { includeArchived: true },
  );
  const form = useForm<MemberFormValues>({
    resolver: zodResolver(memberSchema),
    defaultValues: defaults(member),
  });
  useEffect(() => {
    if (church.data) form.setValue("scanCodeFormat", churchScanFormat, { shouldDirty: false });
  }, [church.data, churchScanFormat, form]);
  const save = useMutation({
    mutationFn: (values: MemberFormValues) =>
      api.save<Member>(
        churchPath(churchId, `members${current ? `/${current.id}` : ""}`),
        memberInput(values, definitions.data ?? []),
        current?._etag,
      ),
    onSuccess: () => onSaved(false),
  });
  const archive = useMutation({
    mutationFn: () =>
      api.archive(
        churchPath(churchId, `members/${current!.id}`),
        current!._etag,
      ),
    onSuccess: () => onSaved(true),
  });
  const reload = useMutation({
    mutationFn: () =>
      api.get<Member>(churchPath(churchId, `members/${current!.id}`)),
    onSuccess: (result) => {
      setCurrent(result);
      form.reset(defaults(result));
      save.reset();
      archive.reset();
      setConfirmArchive(false);
      setReplacement(null);
      setScanning(false);
    },
  });
  const error = save.error ?? archive.error ?? reload.error;
  const busy = save.isPending || archive.isPending || reload.isPending;
  const uncertain = error instanceof ApiError && error.uncertain;
  const locked = !editing || busy || uncertain || !!replacement || (!current?.active && !!current);
  const stale = error instanceof ApiError && error.status === 412;
  const assignedGroups = form.watch("groupIds");
  const hasArchivedGroups = groups.isSuccess && assignedGroups.some(id =>
    !groups.data?.find(group => group.id === id)?.active);
  const showGroups = groups.isPending || groups.isError || (groups.data?.some(group => group.active || assignedGroups.includes(group.id)) ?? false);
  const customValues = form.watch("customFields");
  const showAdditionalDetails = definitions.isPending || definitions.isError || (definitions.data?.some(definition => definition.active || customValues[definition.id] !== undefined) ?? false);
  return (
    <Sheet
      title={current ? memberName(current) : "Add member"}
      dirty={form.formState.isDirty}
      busy={busy}
      onClose={onClose}
    >
      <View style={styles.stack}>
        {current && !editing && (
          <Button
            icon="create-outline"
            disabled={!current.active}
            onPress={() => setEditing(true)}
          >
            Edit member
          </Button>
        )}
        {!current?.active && current && (
          <Notice>This member is archived.</Notice>
        )}
        <Controller control={form.control} name="memberType" render={({ field, fieldState }) => (
          <View>
            <Select label="Member type" value={field.value} disabled={locked} required onChange={(value) => {
              field.onChange(value);
              if (value === "adult") {
                form.setValue("school", "", { shouldDirty: true });
                form.setValue("guardian1", undefined, { shouldDirty: true });
                form.setValue("guardian2", undefined, { shouldDirty: true });
              } else if (!form.getValues("guardian1")) {
                form.setValue("guardian1", { firstName: "", middleName: "", lastName: "", relationship: "Mother", otherRelationship: "", phone: "", email: "" }, { shouldDirty: true });
              }
            }} options={[{ value: "child", label: "Child" }, { value: "adult", label: "Adult" }]} />
            {!!fieldState.error && <Notice error>{fieldState.error.message}</Notice>}
          </View>
        )} />
        {churchScanEnabled && <Heading>Scan code</Heading>}
        {churchScanEnabled && <>
        <Controller control={form.control} name="scanCode" render={({ field, fieldState }) => (
          <Field label="Member scan code" value={field.value ?? ""} onChangeText={field.onChange}
            editable={!locked} autoCapitalize="characters" autoCorrect={false} maxLength={128}
            error={fieldState.error?.message} />
        )} />
        <Controller control={form.control} name="scanCodeFormat" render={({ field }) => (
          <Label>{churchScanFormat === "code128" ? "Barcode (Code 128)" : "QR code"}</Label>
        )} />
        {editing && <View style={{ flexDirection: "row", gap: 8 }}>
          <IconButton icon="scan-outline" label={scanning ? "Close code scanner" : "Scan member code"}
            disabled={locked} onPress={() => setScanning(value => !value)} />
          <IconButton icon="refresh-outline" label={current?.scanCode ? "Generate replacement code" : "Generate scan code"}
            disabled={locked} onPress={() => {
              form.setValue("scanCode", generateScanCode(), { shouldDirty: true, shouldValidate: true });
              setScanning(false);
            }} />
        </View>}
        {scanning && !locked && <ScanInput format={churchScanFormat} onScan={code => {
          form.setValue("scanCode", code, { shouldDirty: true, shouldValidate: true });
          setScanning(false);
        }} />}
        {!!current?.scanCode && !form.formState.isDirty && !uncertain && church.data && <ScanCard
          code={current.scanCode} format={churchScanFormat}
          memberName={memberName(current)} churchName={church.data.name} />}
        </>}
        <Heading>Personal details</Heading>
        {(
          [
            "firstName",
            "middleName",
            "lastName",
            "phone",
            "email",
          ] as const
        ).map((name) => (
          <Controller
            key={name}
            control={form.control}
            name={name}
            render={({ field, fieldState }) => (
              <Field
                label={
                  {
                    firstName: "First name",
                    middleName: "Middle name",
                    lastName: "Last name",
                    phone: "Phone",
                    email: "Email",
                  }[name]
                }
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                editable={!locked}
                autoCapitalize={name === "email" ? "none" : "words"}
                keyboardType={
                  name === "email"
                    ? "email-address"
                    : name === "phone"
                      ? "phone-pad"
                      : "default"
                }
                error={fieldState.error?.message}
                required={name === "firstName" || name === "lastName"}
              />
            )}
          />
        ))}
        <Controller
          control={form.control}
          name="birthDate"
          render={({ field, fieldState }) => (
            <DateField
              label="Birth date"
              value={field.value}
              onChange={field.onChange}
              disabled={locked}
              error={fieldState.error?.message}
            />
          )}
        />
        {form.watch("memberType") === "child" && <>
          <Controller control={form.control} name="school" render={({ field, fieldState }) => (
            <Field label="School" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} editable={!locked} error={fieldState.error?.message} />
          )} />
          <Controller control={form.control} name="allergyDetail" render={({ field, fieldState }) => (
            <Field label="Allergy detail" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} editable={!locked} multiline error={fieldState.error?.message} />
          )} />
          <Heading>Guardian 1</Heading>
          <GuardianFields control={form.control} prefix="guardian1" disabled={locked} relationship={form.watch("guardian1.relationship")} />
          <Heading>Guardian 2 (optional)</Heading>
          {!guardian2Enabled && <Button icon="add-outline" disabled={locked} onPress={() => {
            setGuardian2Enabled(true);
            form.setValue("guardian2", { firstName: "", middleName: "", lastName: "", relationship: "Mother", otherRelationship: "", phone: "", email: "" }, { shouldDirty: true });
          }}>Add Guardian 2</Button>}
          {guardian2Enabled && <>
            <GuardianFields control={form.control} prefix="guardian2" disabled={locked} relationship={form.watch("guardian2.relationship")} />
            <Button icon="close-outline" disabled={locked} onPress={() => {
              setGuardian2Enabled(false);
              form.setValue("guardian2", undefined, { shouldDirty: true });
            }}>Remove Guardian 2</Button>
          </>}
        </>}
        {form.watch("memberType") === "adult" && <Controller control={form.control} name="allergyDetail" render={({ field, fieldState }) => (
          <Field label="Allergy detail" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} editable={!locked} multiline error={fieldState.error?.message} />
        )} />}
        {showGroups && <>
        <Heading>Groups</Heading>
        {editing && hasArchivedGroups && (
          <Notice error>Archived group assignments must be removed or replaced with active groups before saving this member.</Notice>
        )}
        <QueryState
          pending={groups.isPending}
          error={groups.error}
          empty={!groups.data?.length}
          emptyText="No groups defined."
          onRetry={() => void groups.refetch()}
        />
        <Controller
          control={form.control}
          name="groupIds"
          render={({ field }) => (
            <View style={{ gap: 2 }}>
              {(groups.data ?? [])
                .filter(
                  (group) => group.active || field.value.includes(group.id),
                )
                .map((group) => (
                  <Toggle
                    key={group.id}
                    label={`${group.parentGroupId ? `${groups.data?.find((parent) => parent.id === group.parentGroupId)?.name ?? "Group"} / ` : ""}${group.name}${!group.active ? " (archived)" : ""}`}
                    value={field.value.includes(group.id)}
                    compact
                    disabled={
                      locked ||
                      (!group.active && !field.value.includes(group.id))
                    }
                    onChange={(checked) =>
                      field.onChange(
                        checked
                          ? [...field.value, group.id]
                          : field.value.filter((id) => id !== group.id),
                      )
                    }
                  />
                ))}
            </View>
          )}
        />
        </>}
        {showAdditionalDetails && <>
        <Heading>Additional details</Heading>
        <QueryState
          pending={definitions.isPending}
          error={definitions.error}
          empty={!definitions.data?.length}
          emptyText="No custom fields defined."
          onRetry={() => void definitions.refetch()}
        />
        </>}
        <Controller
          control={form.control}
          name="customFields"
          render={({ field }) => (
            <View style={{ gap: 8 }}>
              {(definitions.data ?? [])
                .filter(
                  (definition) =>
                    definition.active ||
                    field.value[definition.id] !== undefined,
                )
                .map((definition) => {
                  const value = field.value[definition.id];
                  const label = `${definition.name}${definition.active ? "" : " (archived)"}`;
                  const change = (next: unknown) =>
                    field.onChange({ ...field.value, [definition.id]: next });
                  if (definition.fieldType === "boolean")
                    return (
                      <Select
                        key={definition.id}
                        label={label}
                        value={
                          value === undefined || value === ""
                            ? ""
                            : String(value)
                        }
                        disabled={locked}
                        onChange={(next) =>
                          change(next === "" ? "" : next === "true")
                        }
                        options={[
                          { value: "", label: "Not specified" },
                          { value: "true", label: "Yes" },
                          { value: "false", label: "No" },
                        ]}
                      />
                    );
                  if (definition.fieldType === "date")
                    return (
                      <DateField
                        key={definition.id}
                        label={label}
                        value={String(value ?? "")}
                        onChange={change}
                        disabled={locked}
                      />
                    );
                  return (
                    <Field
                      key={definition.id}
                      label={label}
                      value={String(value ?? "")}
                      onChangeText={change}
                      editable={!locked}
                      keyboardType={
                        definition.fieldType === "number"
                          ? "numbers-and-punctuation"
                          : "default"
                      }
                      maxLength={1000}
                    />
                  );
                })}
            </View>
          )}
        />
        {error && <Notice error>{message(error)}</Notice>}
        {(stale || uncertain) && current && (
          <>
            <Label muted>
              Reloading replaces your draft with the latest saved details.
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
        {uncertain && <Notice error>Save confirmation is pending. Reload this member before issuing a card. For a new member, close this form and search the directory before creating another record.</Notice>}
        {replacement && <View style={styles.stack}>
          <Notice error>The old card will stop working after this save. Replace the current scan code?</Notice>
          <Button disabled={busy} onPress={() => { save.mutate(replacement); setReplacement(null); }}>Confirm replacement</Button>
          <Button secondary disabled={busy} onPress={() => setReplacement(null)}>Keep editing</Button>
        </View>}
        {editing && (
          <Button
            icon="save-outline"
            busy={save.isPending}
            disabled={
              busy ||
              uncertain ||
              !!replacement ||
              stale ||
              hasArchivedGroups ||
              !groups.isSuccess ||
              !definitions.isSuccess ||
              (!!current && !current.active)
            }
            onPress={() =>
              void form.handleSubmit((value) => {
                const nextCode = value.scanCode?.trim() ? normalizeScanCode(value.scanCode) : null;
                setScanning(false);
                if (current?.scanCode && nextCode !== current.scanCode) setReplacement(value);
                else save.mutate(value);
              })()
            }
          >
            Save member
          </Button>
        )}
        {current?.active && !confirmArchive && (
          <Button
            danger
            disabled={busy}
            icon="archive-outline"
            onPress={() => setConfirmArchive(true)}
          >
            Archive member
          </Button>
        )}
        {confirmArchive && (
          <>
            <Notice
              error
            >{`Archive ${memberName(current!)}? Attendance history will be retained. This cannot be undone.`}</Notice>
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
              Keep member
            </Button>
          </>
        )}
      </View>
    </Sheet>
  );
}
