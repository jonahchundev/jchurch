import { useLocalSearchParams } from "expo-router";
import PublicRegister from "../../../../src/screens/PublicRegister";

export default function RegisterSession() {
  const { churchId, eventId, occurrenceId } = useLocalSearchParams<{
    churchId: string;
    eventId: string;
    occurrenceId: string;
  }>();
  return <PublicRegister churchId={churchId} session={{ eventId, occurrenceId }} />;
}
