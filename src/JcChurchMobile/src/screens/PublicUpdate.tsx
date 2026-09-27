import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, churchPath } from "../api/hooks";
import { ApiError, message } from "../api/client";
import type { Church, Member } from "../api/types";
import {
  publicMemberInput,
  publicRegistrationDefaults,
  publicRegistrationSchema,
  type PublicRegistrationFormValues,
} from "../domain";
import { Button, Notice, Page, QueryState } from "../ui";
import { PublicMemberForm } from "./PublicMemberForm";

export default function PublicUpdate({
  churchId,
  memberId,
}: {
  churchId: string;
  memberId: string;
}) {
  const router = useRouter();
  const church = useQuery({
    queryKey: [churchPath(churchId)],
    queryFn: ({ signal }) => api.get<Church>(churchPath(churchId), signal),
  });
  const memberPath = churchPath(churchId, `members/${memberId}`);
  const member = useQuery({
    queryKey: [memberPath],
    queryFn: ({ signal }) => api.get<Member>(memberPath, signal),
  });
  const [guardian2Enabled, setGuardian2Enabled] = useState(false);
  const form = useForm<PublicRegistrationFormValues>({
    resolver: zodResolver(publicRegistrationSchema),
    defaultValues: publicRegistrationDefaults(),
    values: member.data ? publicRegistrationDefaults(member.data) : undefined,
  });
  useEffect(() => {
    if (member.data) setGuardian2Enabled(!!member.data.guardian2);
  }, [member.data]);
  const submit = useMutation({
    mutationFn: (values: PublicRegistrationFormValues) =>
      api.save<Member>(memberPath, publicMemberInput(values), member.data!._etag),
    onSuccess: () =>
      router.replace({
        pathname: "/update/[churchId]/[memberId]/confirmation",
        params: { churchId, memberId },
      }),
  });
  const stale = submit.error instanceof ApiError && submit.error.status === 412;
  if (!church.data || church.error || !member.data || member.error)
    return (
      <Page title="Update your information">
        <QueryState
          pending={church.isPending || member.isPending}
          error={church.error ?? member.error}
          empty={false}
          onRetry={() => {
            void church.refetch();
            void member.refetch();
          }}
        />
      </Page>
    );
  return (
    <Page title="Update your information" eyebrow={church.data.name}>
      {!member.data.active && (
        <Notice error>
          This record is archived. You can still review or update it, but contact the church
          office if you have questions.
        </Notice>
      )}
      <PublicMemberForm form={form} guardian2Enabled={guardian2Enabled} setGuardian2Enabled={setGuardian2Enabled} />
      {!!submit.error && (
        <Notice error>
          {stale
            ? "This record changed since you opened this page. Reload the latest information and try again."
            : message(submit.error)}
        </Notice>
      )}
      {stale ? (
        <Button
          secondary
          icon="refresh-outline"
          onPress={() => {
            submit.reset();
            void member.refetch();
          }}
        >
          Reload latest information
        </Button>
      ) : (
        <Button
          icon="checkmark-circle-outline"
          busy={submit.isPending}
          onPress={form.handleSubmit((values) => submit.mutate(values))}
        >
          Save updates
        </Button>
      )}
    </Page>
  );
}
