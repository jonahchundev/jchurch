import { useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, churchPath } from "../api/hooks";
import { message } from "../api/client";
import type { Church, Member } from "../api/types";
import {
  publicMemberInput,
  publicRegistrationSchema,
  type PublicRegistrationFormValues,
} from "../domain";
import {
  Button,
  DateField,
  Field,
  Heading,
  Label,
  Notice,
  Page,
  QueryState,
  Select,
  styles,
} from "../ui";

function defaults(): PublicRegistrationFormValues {
  return {
    memberType: "child",
    allergyDetail: "",
    firstName: "",
    lastName: "",
    middleName: "",
    school: "",
    birthDate: "",
    guardian1: {
      firstName: "",
      middleName: "",
      lastName: "",
      relationship: "Mother",
      otherRelationship: "",
      phone: "",
      email: "",
    },
    guardian2: undefined,
  };
}

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

export default function PublicRegister({
  churchId,
  session,
}: {
  churchId: string;
  session?: { eventId: string; occurrenceId: string };
}) {
  const church = useQuery({
    queryKey: [churchPath(churchId)],
    queryFn: ({ signal }) => api.get<Church>(churchPath(churchId), signal),
  });
  const [guardian2Enabled, setGuardian2Enabled] = useState(false);
  const [done, setDone] = useState<{ name: string; checkedIn: boolean } | null>(null);
  const form = useForm<PublicRegistrationFormValues>({
    resolver: zodResolver(publicRegistrationSchema),
    defaultValues: defaults(),
  });
  const submit = useMutation({
    mutationFn: async (values: PublicRegistrationFormValues) => {
      const created = await api.save<Member>(
        churchPath(churchId, "members"),
        publicMemberInput(values),
      );
      if (session) await api.checkIn(churchId, session.occurrenceId, created.id);
      return created;
    },
    onSuccess: (created) => {
      setDone({
        name: [created.firstName, created.lastName].filter(Boolean).join(" "),
        checkedIn: !!session,
      });
      form.reset(defaults());
      setGuardian2Enabled(false);
    },
  });
  if (!church.data || church.error)
    return (
      <Page title="Registration">
        <QueryState
          pending={church.isPending}
          error={church.error}
          empty={false}
          onRetry={() => void church.refetch()}
        />
      </Page>
    );
  if (done)
    return (
      <Page title="Registration complete" eyebrow={church.data.name}>
        <Notice>
          {done.name} is registered{done.checkedIn ? " and checked in for this session." : "."}
        </Notice>
        <Button onPress={() => setDone(null)}>Register another</Button>
      </Page>
    );
  const memberType = form.watch("memberType");
  return (
    <Page title={session ? "Session registration" : "Registration"} eyebrow={church.data.name}>
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
                  form.setValue(
                    "guardian1",
                    { firstName: "", middleName: "", lastName: "", relationship: "Mother", otherRelationship: "", phone: "", email: "" },
                    { shouldDirty: true },
                  );
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
                value={field.value}
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
          name="birthDate"
          render={({ field, fieldState }) => (
            <DateField label="Birth date" value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
          )}
        />
        {memberType === "child" && (
          <Controller
            control={form.control}
            name="school"
            render={({ field, fieldState }) => (
              <Field label="School" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} error={fieldState.error?.message} />
            )}
          />
        )}
        <Controller
          control={form.control}
          name="allergyDetail"
          render={({ field, fieldState }) => (
            <Field label="Allergy detail" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} multiline error={fieldState.error?.message} />
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
                  form.setValue(
                    "guardian2",
                    { firstName: "", middleName: "", lastName: "", relationship: "Mother", otherRelationship: "", phone: "", email: "" },
                    { shouldDirty: true },
                  );
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
        {!!submit.error && <Notice error>{message(submit.error)}</Notice>}
        <Button
          icon="checkmark-circle-outline"
          busy={submit.isPending}
          onPress={form.handleSubmit((values) => submit.mutate(values))}
        >
          {session ? "Register and check in" : "Register"}
        </Button>
      </View>
    </Page>
  );
}
