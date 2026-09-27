import { View } from "react-native";
import { Controller, type Control, type UseFormReturn } from "react-hook-form";
import { churchPath, useAll } from "../api/hooks";
import type { Group } from "../api/types";
import type { PublicRegistrationFormValues } from "../domain";
import { Button, DateField, Field, Heading, Label, Notice, QueryState, Select, styles, Toggle } from "../ui";

const blankGuardian = {
  firstName: "",
  middleName: "",
  lastName: "",
  relationship: "Mother" as const,
  otherRelationship: "",
  phone: "",
  email: "",
};

function GuardianFields({
  control,
  prefix,
  relationship,
  required,
}: {
  control: Control<PublicRegistrationFormValues>;
  prefix: "guardian1" | "guardian2";
  relationship?: string;
  required: boolean;
}) {
  const fields = [
    ["firstName", "First name"],
    ["middleName", "Middle name"],
    ["lastName", "Last name"],
    ["phone", "Phone number"],
    ["email", "Email address"],
  ] as const;
  return (
    <>
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
              autoCapitalize={name === "email" ? "none" : "words"}
              keyboardType={name === "email" ? "email-address" : name === "phone" ? "phone-pad" : "default"}
              error={fieldState.error?.message}
              required={required && name !== "middleName"}
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
              onChange={field.onChange}
              required={required}
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
      {relationship === "Others" && (
        <Controller
          control={control}
          name={`${prefix}.otherRelationship` as "guardian1.otherRelationship"}
          render={({ field, fieldState }) => (
            <Field
              label="Other relationship"
              value={field.value ?? ""}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              maxLength={50}
              error={fieldState.error?.message}
            />
          )}
        />
      )}
    </>
  );
}

// Shared by PublicRegister (blank form) and PublicUpdate (prefilled from a fetched member).
export function PublicMemberForm({
  form,
  churchId,
  guardian2Enabled,
  setGuardian2Enabled,
}: {
  form: UseFormReturn<PublicRegistrationFormValues>;
  churchId: string;
  guardian2Enabled: boolean;
  setGuardian2Enabled: (value: boolean) => void;
}) {
  const memberType = form.watch("memberType");
  const assignedGroups = form.watch("groupIds");
  const groups = useAll<Group>(churchPath(churchId, "groups"), {
    includeArchived: true,
  });
  const hasArchivedGroups = groups.data?.some(
    (group) => !group.active && assignedGroups.includes(group.id),
  );
  return (
    <View style={styles.stack}>
      <Controller
        control={form.control}
        name="memberType"
        render={({ field }) => (
          <Select
            label="Registering as"
            value={field.value}
            required
            onChange={(value) => {
              field.onChange(value);
              if (value === "adult") {
                form.setValue("school", "", { shouldDirty: true });
                form.setValue("guardian1", undefined, { shouldDirty: true });
                form.setValue("guardian2", undefined, { shouldDirty: true });
                setGuardian2Enabled(false);
              } else if (!form.getValues("guardian1")) {
                form.setValue("guardian1", { ...blankGuardian }, { shouldDirty: true });
              }
            }}
            options={[
              { value: "child", label: "Child" },
              { value: "adult", label: "Adult" },
            ]}
          />
        )}
      />
      <Heading>Personal details</Heading>
      {(["firstName", "middleName", "lastName"] as const).map((name) => (
        <Controller
          key={name}
          control={form.control}
          name={name}
          render={({ field, fieldState }) => (
            <Field
              label={{ firstName: "First name", middleName: "Middle name", lastName: "Last name" }[name]}
              value={field.value ?? ""}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              autoCapitalize="words"
              error={fieldState.error?.message}
              required={name !== "middleName"}
            />
          )}
        />
      ))}
      <Controller
        control={form.control}
        name="gender"
        render={({ field, fieldState }) => (
          <View>
            <Select
              label="Gender"
              value={field.value ?? ""}
              onChange={field.onChange}
              required
              options={[
                { value: "", label: "" },
                { value: "Male", label: "Male" },
                { value: "Female", label: "Female" },
              ]}
            />
            {!!fieldState.error && <Notice error>{fieldState.error.message}</Notice>}
          </View>
        )}
      />
      <Controller
        control={form.control}
        name="birthDate"
        render={({ field, fieldState }) => (
          <DateField label="Birth date" value={field.value ?? ""} onChange={field.onChange} error={fieldState.error?.message} />
        )}
      />
      {memberType === "child" && (
        <Controller
          control={form.control}
          name="school"
          render={({ field, fieldState }) => (
            <Field label="School" value={field.value ?? ""} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} />
          )}
        />
      )}
      <Controller
        control={form.control}
        name="allergyDetail"
        render={({ field, fieldState }) => (
          <Field label="Allergy detail" value={field.value ?? ""} onChangeText={field.onChange} onBlur={field.onBlur} multiline error={fieldState.error?.message} />
        )}
      />
      <Heading>Groups</Heading>
      {hasArchivedGroups && (
        <Notice error>
          Archived group assignments must be removed or replaced before saving.
        </Notice>
      )}
      <QueryState
        pending={groups.isPending}
        error={groups.error}
        empty={!groups.data?.some((group) => group.active || assignedGroups.includes(group.id))}
        emptyText="No groups available."
        onRetry={() => void groups.refetch()}
      />
      <Controller
        control={form.control}
        name="groupIds"
        render={({ field }) => (
          <View style={{ gap: 2 }}>
            {(groups.data ?? [])
              .filter((group) => group.active || field.value.includes(group.id))
              .map((group) => (
                <Toggle
                  key={group.id}
                  label={`${group.parentGroupId ? `${groups.data?.find((parent) => parent.id === group.parentGroupId)?.name ?? "Group"} / ` : ""}${group.name}${!group.active ? " (archived)" : ""}`}
                  value={field.value.includes(group.id)}
                  compact
                  disabled={!group.active && !field.value.includes(group.id)}
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
      {memberType === "child" && (
        <>
          <Heading>Guardian 1</Heading>
          <Label muted small>Guardian name, phone, and email are required for a child.</Label>
          <GuardianFields control={form.control} prefix="guardian1" required relationship={form.watch("guardian1.relationship")} />
          <Heading>Guardian 2 (optional)</Heading>
          {!guardian2Enabled && (
            <Button
              icon="add-outline"
              onPress={() => {
                setGuardian2Enabled(true);
                form.setValue("guardian2", { ...blankGuardian }, { shouldDirty: true });
              }}
            >
              Add Guardian 2
            </Button>
          )}
          {guardian2Enabled && (
            <>
              <GuardianFields control={form.control} prefix="guardian2" relationship={form.watch("guardian2.relationship")} required={false} />
              <Button
                icon="close-outline"
                onPress={() => {
                  setGuardian2Enabled(false);
                  form.setValue("guardian2", undefined, { shouldDirty: true });
                }}
              >
                Remove Guardian 2
              </Button>
            </>
          )}
        </>
      )}
    </View>
  );
}
