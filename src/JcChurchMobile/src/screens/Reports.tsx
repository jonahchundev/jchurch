import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api, churchPath } from "../api/hooks";
import type { Church } from "../api/types";
import { Page, Row } from "../ui";

// Reports hub: entry point for the four attendance report levels. Read-only for all roles.
export default function Reports() {
  const { churchId } = useLocalSearchParams<{ churchId: string }>();
  const router = useRouter();
  const church = useQuery({
    queryKey: [churchPath(churchId)],
    queryFn: ({ signal }) => api.get<Church>(churchPath(churchId), signal),
  });
  return (
    <Page title="Reports" eyebrow={church.data?.name ?? "Attendance"}>
      <Row
        icon="calendar-outline"
        title="By Event"
        subtitle="Totals and per-session trend"
        onPress={() =>
          router.push({ pathname: "/church/[churchId]/report-event", params: { churchId } })
        }
      />
      <Row
        icon="time-outline"
        title="By Session"
        subtitle="Who checked in, broken down by group"
        onPress={() =>
          router.push({ pathname: "/church/[churchId]/report-session", params: { churchId } })
        }
      />
      <Row
        icon="person-outline"
        title="By Member"
        subtitle="One person's attendance history"
        onPress={() =>
          router.push({ pathname: "/church/[churchId]/report-member", params: { churchId } })
        }
      />
      <Row
        icon="people-outline"
        title="By Group"
        subtitle="Coverage, trend, and per-member totals"
        onPress={() =>
          router.push({ pathname: "/church/[churchId]/report-group", params: { churchId } })
        }
      />
    </Page>
  );
}
