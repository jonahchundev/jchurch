import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, churchPath, memberImageUrl, useAll, useDebounce, useList } from "../api/hooks";
import { ApiError, message } from "../api/client";
import type { Church, CustomField, Group, Member } from "../api/types";
import { createdOnLabel, guardianIncomplete, isNewMember, memberAge, memberInput, memberSchema, normalizeScanCode, type MemberFormValues } from "../domain";
import { generateScanCode, ScanCard, ScanInput } from "../ScanCode";
import { registrationBaseUrl } from "../api/api-url";
import { RegistrationCode } from "../RegistrationCode";
import MemberPhoto, { type PendingPhoto } from "../MemberPhoto";
import MembersImportExport from "./MembersImportExport";
import {
  Avatar,
  Button,
  DateField,
  Field,
  Heading,
  IconButton,
  Label,
  Notice,
  NewMemberMark,
  Page,
  QueryState,
  Row,
  SearchBox,
  Select,
  SegmentedControl,
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
  const assignedGroupIds = member.groupIds ?? [];
  return assignedGroupIds
    .map((id) => {
      const group = groups.find((candidate) => candidate.id === id);
      if (!group) return "Archived group";
      if (!group.parentGroupId) return group.name;
      if (assignedGroupIds.includes(group.parentGroupId)) return group.name;
      const parent = groups.find(
        (candidate) => candidate.id === group.parentGroupId,
      );
      return `${parent?.name ?? "Group"} / ${group.name}`;
    })
    .join(" / ");
}

export function sortedGroupsByName(groups: Group[]) {
  return [...groups]
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
}

export function sortedActiveGroups(groups: Group[]) {
  return sortedGroupsByName(groups.filter((group) => group.active));
}

export default function Members() {
  const { churchId, search: focusSearch } = useLocalSearchParams<{
    churchId: string;
    search?: string;
  }>();
  const client = useQueryClient();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [nameSort, setNameSort] = useState("asc");
  const [createdOnSort, setCreatedOnSort] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [importExportOpen, setImportExportOpen] = useState(false);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  useFocusEffect(useCallback(() => () => setNotice(""), []));
  const path = churchPath(churchId, "members");
  const church = useQuery({
    queryKey: [churchPath(churchId)],
    queryFn: ({ signal }) => api.get<Church>(churchPath(churchId), signal),
  });
  const query = useList<Member>(path, {
    search: useDebounce(search),
    groupIds: groupIds.length ? groupIds.join(",") : undefined,
    nameSort,
    createdOnSort: createdOnSort || undefined,
    pageSize: 200,
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
            icon="cloud-download-outline"
            label="Import or export CSV"
            onPress={() => setImportExportOpen(true)}
          />
          <IconButton
            icon="person-add-outline"
            label="Add member"
            onPress={() => setEditing("new")}
          />
          <IconButton
            icon="qr-code-outline"
            label="New registration"
            onPress={() => setRegistrationOpen(true)}
          />
        </>
      }
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <SearchBox
            key={focusSearch}
            autoFocus={focusSearch === "1"}
            value={search}
            onChange={setSearch}
            placeholder="Search members"
          />
        </View>
        <IconButton icon="swap-vertical-outline" label="Sort and filter members" onPress={() => setSortOpen(true)} />
      </View>
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
        {members.map((member) => {
          const details = [
            memberAge(member.birthDate) === null
              ? ""
              : `Age ${memberAge(member.birthDate)}`,
            member.school ?? "",
            groupNames(member, groups.data ?? []),
          ].filter(Boolean).join(" · ");
          return (
            <Row
              key={member.id}
              avatar={<Avatar uri={memberImageUrl(churchId, member.id, member.imageVersion)} />}
              title={memberName(member)}
              titleAccessory={isNewMember(member.createdOn, church.data?.newMemberDays) ? <NewMemberMark createdOn={member.createdOn} /> : undefined}
              subtitle={details || undefined}
              badge={guardianIncomplete(member) ? "Guardian info incomplete" : undefined}
              badgeTone="danger"
              onPress={() => setEditing(member)}
            />
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
      {editing && (
        <MemberDetails
          member={editing === "new" ? undefined : editing}
          churchId={churchId}
          onClose={() => setEditing(null)}
          onSaved={async (archived, savedNotice) => {
            setEditing(null);
            setNotice(savedNotice ?? (archived ? "Member archived." : "Member saved."));
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
      {registrationOpen && (
        <RegistrationCode
          title="Member registration"
          subtitle="Scan or share to register a new member."
          url={`${registrationBaseUrl()}/register/${churchId}`}
          onClose={() => setRegistrationOpen(false)}
        />
      )}
      {sortOpen && (
        <Sheet title="Member sort and filter" onClose={() => setSortOpen(false)}>
          <View style={styles.stack}>
            <Label small>Group or subgroup</Label>
            <Label small muted>Leave all unchecked to show every group.</Label>
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
    </Page>
  );
}

function guardianDefaults(guardian: Member["guardian1"]): MemberFormValues["guardian1"] {
  if (!guardian) return undefined;
  return {
    firstName: guardian.firstName ?? "",
    middleName: guardian.middleName ?? "",
    lastName: guardian.lastName ?? "",
    relationship: guardian.relationship ?? "Mother",
    otherRelationship: guardian.otherRelationship ?? "",
    phone: guardian.phone ?? "",
    email: guardian.email ?? "",
  };
}

function defaults(member?: Member): MemberFormValues {
  return {
    memberType: member?.memberType ?? "child",
    allergyDetail: member?.allergyDetail ?? "",
    scanCode: member?.scanCode ?? "",
    scanCodeFormat: member?.scanCodeFormat ?? "qr",
    firstName: member?.firstName ?? "",
    lastName: member?.lastName ?? "",
    // Select requires a plain string; cast covers members that predate this field.
    gender: (member?.gender ?? "") as MemberFormValues["gender"],
    middleName: member?.middleName ?? "",
    birthDate: member?.birthDate ?? "",
    school: member?.school ?? "",
    phone: member?.phone ?? "",
    email: member?.email ?? "",
    guardian1:
      guardianDefaults(member?.guardian1) ??
      (member?.memberType === "adult"
        ? undefined
        : { firstName: "", middleName: "", lastName: "", relationship: "Mother", otherRelationship: "", phone: "", email: "" }),
    guardian2: guardianDefaults(member?.guardian2),
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
  onSaved: (archived: boolean, notice?: string) => void;
}) {
  const [current, setCurrent] = useState(member);
  const [editing, setEditing] = useState(!member);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const [guardian2Enabled, setGuardian2Enabled] = useState(!!member?.guardian2);
  const [replacement, setReplacement] = useState<MemberFormValues | null>(null);
  const [updateLinkOpen, setUpdateLinkOpen] = useState(false);
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
    onSuccess: async (saved) => {
      // A photo picked before the member existed is uploaded now, under the created id.
      if (pendingPhoto) {
        try {
          await api.uploadMemberImage(churchId, saved.id, {
            contentType: pendingPhoto.contentType,
            data: pendingPhoto.data,
          });
          setPendingPhoto(null);
        } catch {
          onSaved(false, "Member saved, but the photo upload failed. Edit the member to add it.");
          return;
        }
      }
      onSaved(false);
    },
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
      titleAccessory={current ? <Label small muted>{createdOnLabel(current.createdOn)}</Label> : undefined}
      dirty={form.formState.isDirty}
      busy={busy}
      onClose={onClose}
    >
      <View style={styles.stack}>
        <MemberPhoto
          churchId={churchId}
          member={current}
          disabled={locked}
          onMemberChange={setCurrent}
          pending={pendingPhoto}
          onPendingChange={setPendingPhoto}
        />
        {current && !editing && (
          <Button
            icon="create-outline"
            disabled={!current.active}
            onPress={() => setEditing(true)}
          >
            Edit member
          </Button>
        )}
        {current && (
          <Button
            secondary
            icon="qr-code-outline"
            onPress={() => setUpdateLinkOpen(true)}
          >
            Update link
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
                  }[name]
                }
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                editable={!locked}
                autoCapitalize="words"
                error={fieldState.error?.message}
                required={name === "firstName" || name === "lastName"}
              />
            )}
          />
        ))}
        <Controller control={form.control} name="gender" render={({ field, fieldState }) => (
          <View>
            <Select label="Gender" value={field.value ?? ""} onChange={field.onChange} disabled={locked} required
              options={[{ value: "", label: "" }, { value: "Male", label: "Male" }, { value: "Female", label: "Female" }]} />
            {!!fieldState.error && <Notice error>{fieldState.error.message}</Notice>}
          </View>
        )} />
        {(
          [
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
          <Heading>Guardian 1 (optional)</Heading>
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
              {sortedGroupsByName(
                (groups.data ?? []).filter(
                  (group) => group.active || field.value.includes(group.id),
                ),
              ).map((group) => (
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
      {updateLinkOpen && current && (
        <RegistrationCode
          title="Update details"
          subtitle={memberName(current)}
          url={`${registrationBaseUrl()}/update/${churchId}/${current.id}`}
          onClose={() => setUpdateLinkOpen(false)}
        />
      )}
    </Sheet>
  );
}
