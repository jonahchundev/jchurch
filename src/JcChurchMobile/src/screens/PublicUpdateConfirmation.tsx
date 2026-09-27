import { useQuery } from "@tanstack/react-query";
import { api, churchPath } from "../api/hooks";
import type { Church, Member } from "../api/types";
import { Heading, Notice, Page, QueryState } from "../ui";

export default function PublicUpdateConfirmation({
  churchId,
  memberId,
}: {
  churchId: string;
  memberId: string;
}) {
  const church = useQuery({
    queryKey: [churchPath(churchId)],
    queryFn: ({ signal }) => api.get<Church>(churchPath(churchId), signal),
  });
  const memberPath = churchPath(churchId, `members/${memberId}`);
  const member = useQuery({
    queryKey: [memberPath],
    queryFn: ({ signal }) => api.get<Member>(memberPath, signal),
  });
  if (!church.data || church.error || !member.data || member.error)
    return (
      <Page title="Update complete">
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
  const name = [member.data.firstName, member.data.lastName]
    .filter(Boolean)
    .join(" ");
  return (
    <Page title="Thank you!" eyebrow={church.data.name}>
      <Heading>Thank you{name ? `, ${name}` : ""}!</Heading>
      <Notice>Your information has been updated. Thanks for keeping your details up to date with us.</Notice>
    </Page>
  );
}