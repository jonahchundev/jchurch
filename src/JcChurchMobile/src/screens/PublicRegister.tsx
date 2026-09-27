import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, churchPath } from "../api/hooks";
import { message } from "../api/client";
import type { Church, Member } from "../api/types";
import {
  publicMemberInput,
  publicRegistrationDefaults,
  publicRegistrationSchema,
  type PublicRegistrationFormValues,
} from "../domain";
import { Button, Heading, Notice, Page, QueryState } from "../ui";
import { PublicMemberForm } from "./PublicMemberForm";

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
    defaultValues: publicRegistrationDefaults(),
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
      form.reset(publicRegistrationDefaults());
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
      <Page title="Thank you!" eyebrow={church.data.name}>
        <Heading>Thank you for registering{done.name ? ` ${done.name}` : ""}!</Heading>
        <Notice>
          {done.name} is registered{done.checkedIn ? " and checked in for this session. " : ". "}
          We're so glad to have you with us — see you soon!
        </Notice>
      </Page>
    );
  return (
    <Page title={session ? "Session registration" : "Registration"} eyebrow={church.data.name}>
      <PublicMemberForm form={form} churchId={churchId} guardian2Enabled={guardian2Enabled} setGuardian2Enabled={setGuardian2Enabled} />
      {!!submit.error && <Notice error>{message(submit.error)}</Notice>}
      <Button
        icon="checkmark-circle-outline"
        busy={submit.isPending}
        onPress={form.handleSubmit((values) => submit.mutate(values))}
      >
        {session ? "Register and check in" : "Register"}
      </Button>
    </Page>
  );
}

